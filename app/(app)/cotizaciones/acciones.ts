"use server";

/**
 * Puente server-to-server hacia la Quote Agent API (`docs/API_agent.md`).
 *
 * `APP_API_KEY` y `X-User-Id` nunca salen del servidor: `X-User-Id` sale de
 * `exigirAgenteCotizacion()`, nunca de un valor que mande el navegador — la
 * propia API documenta que confía en ese header a ciegas (IDOR si se
 * expusiera). El agente no guarda los chats en la base de Plexiacril: la
 * Quote Agent API es la única fuente de verdad, así que aquí no hay tablas
 * ni `refresh()` que llamar, solo traducir su respuesta al idioma de la app.
 */

import { exigirAgenteCotizacion } from "@/lib/sesion";

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
}

export interface Mensaje {
  role: "user" | "assistant";
  text: string;
}

export interface ChatDetalle extends ChatResumen {
  messages: Mensaje[];
}

export type Resultado<T> = { ok: true; data: T } | { ok: false; error: string };

const fallo = <T,>(error: string): Resultado<T> => ({ ok: false, error });

/** Mapea los códigos de `docs/API_agent.md` § Códigos de error a español. */
const MENSAJE_POR_ESTADO: Record<number, string> = {
  400: "Falta un dato de sesión. Recarga la página.",
  401: "La API de cotizaciones no está bien configurada. Avisa a soporte.",
  404: "Este chat ya no existe.",
  422: "El mensaje no es válido.",
};

function mensajeDeEstado(status: number): string {
  return MENSAJE_POR_ESTADO[status] ?? "No se pudo comunicar con el agente. Intenta de nuevo.";
}

function deCotizacion(json: unknown): Cotizacion | null {
  if (!json || typeof json !== "object") return null;
  const c = json as Record<string, unknown>;
  return {
    orderId: c.order_id as number,
    orderName: c.order_name as string,
    totalPen: c.total_pen as number,
  };
}

function deChat(json: Record<string, unknown>): ChatResumen {
  return {
    chatId: json.chat_id as string,
    title: json.title as string,
    createdAt: json.created_at as string,
    updatedAt: json.updated_at as string,
    lastQuotation: deCotizacion(json.last_quotation),
  };
}

/** Llama a la Quote Agent API con los headers que exige, y decodifica el JSON. */
async function agentFetch<T>(path: string, init?: RequestInit): Promise<Resultado<T>> {
  const perfil = await exigirAgenteCotizacion();
  const base = process.env.AGENT_API_BASE_URL;

  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": process.env.APP_API_KEY ?? "",
        "X-User-Id": perfil.id,
        ...init?.headers,
      },
      cache: "no-store",
    });
  } catch {
    return fallo("No se pudo conectar con el agente de cotizaciones.");
  }

  if (!res.ok) return fallo(mensajeDeEstado(res.status));
  if (res.status === 204) return { ok: true, data: undefined as T };

  const json = (await res.json()) as T;
  return { ok: true, data: json };
}

export async function listarChats(): Promise<Resultado<ChatResumen[]>> {
  const r = await agentFetch<Record<string, unknown>[]>("/chats");
  if (!r.ok) return r;
  return { ok: true, data: r.data.map(deChat) };
}

export async function obtenerChat(chatId: string): Promise<Resultado<ChatDetalle>> {
  const r = await agentFetch<Record<string, unknown>>(`/chats/${encodeURIComponent(chatId)}`);
  if (!r.ok) return r;

  const mensajes = (r.data.messages as Record<string, unknown>[] | undefined) ?? [];
  return {
    ok: true,
    data: {
      ...deChat(r.data),
      messages: mensajes.map((m) => ({ role: m.role as "user" | "assistant", text: m.text as string })),
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
): Promise<Resultado<{ chatId: string; reply: string; lastQuotation: Cotizacion | null }>> {
  let idChat = chatId;

  if (!idChat) {
    const creado = await agentFetch<Record<string, unknown>>("/chats", {
      method: "POST",
      body: JSON.stringify({}),
    });
    if (!creado.ok) return creado;
    idChat = creado.data.chat_id as string;
  }

  const r = await agentFetch<Record<string, unknown>>(
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
    },
  };
}

export async function borrarChat(chatId: string): Promise<Resultado<void>> {
  return agentFetch<void>(`/chats/${encodeURIComponent(chatId)}`, { method: "DELETE" });
}
