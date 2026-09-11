"use server";

/**
 * Puente server-to-server hacia la Quote Agent API (`docs/API_agent.md`).
 *
 * `X-User-Id` sale de `exigirAgenteCotizacion()`, nunca de un valor que mande el
 * navegador; el transporte y los mensajes de error viven en
 * `lib/agente-cotizaciones.ts`, y los tipos y traductores en
 * `lib/cotizaciones-tipos.ts`, que comparte con los route handlers. El agente no
 * guarda los chats en la base de Plexiacril: la Quote Agent API es la única
 * fuente de verdad, así que aquí no hay tablas ni `refresh()` que llamar.
 *
 * Enviar un mensaje NO está aquí: va por `app/api/cotizaciones/mensajes`, porque
 * una Server Action rechaza cuerpos de más de 1 MB y un mensaje puede llevar
 * archivos.
 */

import { exigirAgenteCotizacion } from "@/lib/sesion";
import { agentFetch, fallo, type Resultado } from "@/lib/agente-cotizaciones";
import { deChat, deCotizacion, deMensajes, deNuevaCotizacion } from "@/lib/cotizaciones-tipos";
import type { ChatDetalle, ChatResumen, Cotizacion } from "@/lib/cotizaciones-tipos";

export type { Resultado };
export type {
  Adjunto,
  ChatDetalle,
  ChatResumen,
  Cotizacion,
  Mensaje,
  TurnoEnviado,
} from "@/lib/cotizaciones-tipos";

/** El mismo `agentFetch` compartido, pero con la sesión ya exigida. */
async function comoUsuario<T>(path: string, init?: RequestInit): Promise<Resultado<T>> {
  const perfil = await exigirAgenteCotizacion();
  return agentFetch<T>(perfil.id, path, init);
}

export async function listarChats(): Promise<Resultado<ChatResumen[]>> {
  const r = await comoUsuario<Record<string, unknown>[]>("/chats");
  if (!r.ok) return r;
  return { ok: true, data: r.data.map(deChat) };
}

export async function obtenerChat(chatId: string): Promise<Resultado<ChatDetalle>> {
  const r = await comoUsuario<Record<string, unknown>>(`/chats/${encodeURIComponent(chatId)}`);
  if (!r.ok) return r;

  return {
    ok: true,
    data: {
      ...deChat(r.data),
      messages: deMensajes(r.data.messages),
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
