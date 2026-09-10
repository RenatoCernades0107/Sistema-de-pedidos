"use server";

/**
 * Puente server-to-server hacia la Quote Agent API (`docs/API_agent.md`).
 *
 * `X-User-Id` sale de `exigirAgenteCotizacion()`, nunca de un valor que mande el
 * navegador; el transporte y los mensajes de error viven en
 * `lib/agente-cotizaciones.ts`, que comparte con el route handler de los PDFs.
 * El agente no guarda los chats en la base de Plexiacril: la Quote Agent API es
 * la única fuente de verdad, así que aquí no hay tablas ni `refresh()` que
 * llamar, solo traducir su respuesta al idioma de la app.
 */

import { exigirAgenteCotizacion } from "@/lib/sesion";
import { agentFetch, fallo, type Resultado } from "@/lib/agente-cotizaciones";

export type { Resultado };

export interface Cotizacion {
  orderId: number;
  orderName: string;
  totalPen: number;
}

export interface ChatResumen {
  chatId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastQuotation: Cotizacion | null;
  /**
   * Bosquejo de cotización aún no confirmado por el usuario (distinto de
   * `lastQuotation`, que solo se llena cuando ya se creó en Odoo). Forma
   * interna aún no definida por el backend — se trata como opaca.
   */
  newQuotation: Record<string, unknown> | null;
}

export interface Mensaje {
  role: "user" | "assistant";
  text: string;
}

export interface ChatDetalle extends ChatResumen {
  messages: Mensaje[];
  /**
   * Si esta cotización tiene hoja de corte que descargar: solo cuando se cotizó
   * corte a medida, no cuando se vendió la plancha entera. El PDF de la
   * cotización no necesita un campo así — está disponible exactamente cuando
   * `lastQuotation` no es `null`.
   */
  hasCutSheet: boolean;
}

/** El mismo `agentFetch` compartido, pero con la sesión ya exigida. */
async function comoUsuario<T>(path: string, init?: RequestInit): Promise<Resultado<T>> {
  const perfil = await exigirAgenteCotizacion();
  return agentFetch<T>(perfil.id, path, init);
}

function deCotizacion(json: unknown): Cotizacion | null {
  if (!json || typeof json !== "object") return null;
  const c = json as Record<string, unknown>;
  if (
    typeof c.order_id !== "number" ||
    typeof c.order_name !== "string" ||
    typeof c.total_pen !== "number"
  ) {
    return null;
  }
  return {
    orderId: c.order_id,
    orderName: c.order_name,
    totalPen: c.total_pen,
  };
}

/**
 * `new_quotation` todavía no tiene forma final del lado del backend: se trata
 * como un objeto opaco, sin asumir campos internos. Ausente/`null`/no-objeto
 * se normaliza a `null` para que esto no truene contra el backend actual
 * (que ni siquiera manda el campo todavía).
 */
function deNuevaCotizacion(json: unknown): Record<string, unknown> | null {
  if (!json || typeof json !== "object") return null;
  return json as Record<string, unknown>;
}

function deChat(json: Record<string, unknown>): ChatResumen {
  return {
    chatId: json.chat_id as string,
    title: json.title as string,
    createdAt: json.created_at as string,
    updatedAt: json.updated_at as string,
    lastQuotation: deCotizacion(json.last_quotation),
    newQuotation: deNuevaCotizacion(json.new_quotation),
  };
}

export async function listarChats(): Promise<Resultado<ChatResumen[]>> {
  const r = await comoUsuario<Record<string, unknown>[]>("/chats");
  if (!r.ok) return r;
  return { ok: true, data: r.data.map(deChat) };
}

export async function obtenerChat(chatId: string): Promise<Resultado<ChatDetalle>> {
  const r = await comoUsuario<Record<string, unknown>>(`/chats/${encodeURIComponent(chatId)}`);
  if (!r.ok) return r;

  const mensajes = (r.data.messages as Record<string, unknown>[] | undefined) ?? [];
  return {
    ok: true,
    data: {
      ...deChat(r.data),
      messages: mensajes.map((m) => ({ role: m.role as "user" | "assistant", text: m.text as string })),
      hasCutSheet: r.data.has_cut_sheet === true,
    },
  };
}

/**
 * Manda un mensaje. `chatId` viene `null` la primera vez de una cotización
 * nueva (creación diferida): se crea el chat sin título — la propia API lo
 * autocompleta con este mismo mensaje — y recién ahí se manda el mensaje.
 */
export async function enviarMensaje(
  chatId: string | null,
  message: string,
): Promise<
  Resultado<{
    chatId: string;
    reply: string;
    lastQuotation: Cotizacion | null;
    newQuotation: Record<string, unknown> | null;
    hasCutSheet: boolean;
  }>
> {
  let idChat = chatId;

  if (!idChat) {
    const creado = await comoUsuario<Record<string, unknown>>("/chats", {
      method: "POST",
      body: JSON.stringify({}),
    });
    if (!creado.ok) return creado;
    idChat = creado.data.chat_id as string;
  }

  const r = await comoUsuario<Record<string, unknown>>(
    `/chats/${encodeURIComponent(idChat)}/messages`,
    { method: "POST", body: JSON.stringify({ message }) },
  );
  if (!r.ok) return r;

  return {
    ok: true,
    data: {
      chatId: idChat,
      reply: r.data.reply as string,
      lastQuotation: deCotizacion(r.data.last_quotation),
      newQuotation: deNuevaCotizacion(r.data.new_quotation),
      hasCutSheet: r.data.has_cut_sheet === true,
    },
  };
}

export async function borrarChat(chatId: string): Promise<Resultado<void>> {
  return comoUsuario<void>(`/chats/${encodeURIComponent(chatId)}`, { method: "DELETE" });
}

/**
 * Confirma el bosquejo pendiente (`new_quotation`) y le pide al agente que
 * cree la cotización en Odoo directamente, sin pasar por el chat/LLM. Misma
 * forma de respuesta que `POST /chats/{chat_id}/messages` (ver
 * `docs/API_agent.md`): la cotización creada viene en `last_quotation`, no en
 * la raíz del body.
 */
export async function crearCotizacion(
  chatId: string,
): Promise<
  Resultado<{
    reply: string;
    lastQuotation: Cotizacion;
    newQuotation: Record<string, unknown> | null;
    hasCutSheet: boolean;
  }>
> {
  const r = await comoUsuario<Record<string, unknown>>("/create-quotation", {
    method: "POST",
    body: JSON.stringify({ chat_id: chatId }),
  });
  if (!r.ok) return r;

  const cotizacion = deCotizacion(r.data.last_quotation);
  if (!cotizacion) return fallo("El agente no devolvió una cotización válida.");

  return {
    ok: true,
    data: {
      reply: r.data.reply as string,
      lastQuotation: cotizacion,
      newQuotation: deNuevaCotizacion(r.data.new_quotation),
      hasCutSheet: r.data.has_cut_sheet === true,
    },
  };
}
