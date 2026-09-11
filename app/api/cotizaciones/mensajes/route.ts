/**
 * Enviar un turno de conversación al agente, con los archivos que lo acompañen.
 *
 * Es un route handler y no una Server Action por el tamaño: una Server Action
 * rechaza cuerpos de más de 1 MB (`Body exceeded 1 MB limit`), y una foto de un
 * plano desde el celular pasa de eso ella sola. Aquí llega como `multipart/form-data`,
 * que además evita el 33% que engorda el base64 — importante porque detrás hay
 * una segunda pared: Vercel corta las peticiones en 4.5 MB. Mandando los bytes
 * crudos, los 4 MB que admite la API caben; en base64 no cabrían.
 *
 * El base64 se hace aquí, en el servidor, que es donde hace falta de todos modos:
 * la Quote Agent API recibe los archivos así (ver `docs/API_agent.md`).
 */

import type { NextRequest } from "next/server";
import { exigirAgenteCotizacion } from "@/lib/sesion";
import { agentFetch } from "@/lib/agente-cotizaciones";
import { deTurno } from "@/lib/cotizaciones-tipos";

/** El mismo tope que impone la API, comprobado también aquí porque el navegador
 * no es de fiar y porque así el error llega antes de gastar la subida entera. */
const MAX_BYTES = 4 * 1024 * 1024;

function error(mensaje: string, status: number) {
  return Response.json({ error: mensaje }, { status });
}

export async function POST(request: NextRequest) {
  const perfil = await exigirAgenteCotizacion();

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return error("No se pudo leer el mensaje.", 400);
  }

  const mensaje = String(form.get("mensaje") ?? "");
  const archivos = form.getAll("archivos").filter((a): a is File => a instanceof File);

  if (!mensaje.trim() && archivos.length === 0) {
    return error("Escribe un mensaje o adjunta un archivo.", 400);
  }

  const pesan = archivos.reduce((suma, a) => suma + a.size, 0);
  if (pesan > MAX_BYTES) {
    return error(
      `Los archivos suman ${(pesan / 1024 / 1024).toFixed(1)} MB y el máximo por mensaje es ${MAX_BYTES / 1024 / 1024} MB.`,
      413,
    );
  }

  // Creación diferida del chat: la primera vez de una cotización nueva no hay
  // chatId todavía. Se crea sin título — la propia API lo autocompleta con este
  // mismo mensaje — y recién ahí se manda el turno.
  let chatId = String(form.get("chatId") ?? "");
  if (!chatId) {
    const creado = await agentFetch<Record<string, unknown>>(perfil.id, "/chats", {
      method: "POST",
      body: JSON.stringify({}),
    });
    if (!creado.ok) return error(creado.error, 502);
    chatId = creado.data.chat_id as string;
  }

  const attachments = await Promise.all(
    archivos.map(async (a) => ({
      filename: a.name,
      content_type: a.type,
      content_base64: Buffer.from(await a.arrayBuffer()).toString("base64"),
    })),
  );

  const r = await agentFetch<Record<string, unknown>>(
    perfil.id,
    `/chats/${encodeURIComponent(chatId)}/messages`,
    { method: "POST", body: JSON.stringify({ message: mensaje, attachments }) },
  );
  if (!r.ok) return error(r.error, 502);

  return Response.json(deTurno(chatId, r.data));
}
