/**
 * El webhook de Kapso: los mensajes que llegan al número de WhatsApp.
 *
 * Llega sin sesión (está abierto en `proxy.ts`): lo que lo autoriza es la firma
 * HMAC de Kapso (`X-Webhook-Signature`, con KAPSO_WEBHOOK_SECRET) sobre el cuerpo
 * crudo, que se verifica antes de leer nada. Después, la base solo se toca con la
 * clave del agente (`lib/agente-whatsapp/secreto.ts`).
 *
 * Contesta 200 enseguida y procesa después (`after`): Kapso reintenta si tarda, y
 * el agente puede tardar varios segundos. Un reintento no duplica nada: cada
 * mensaje se guarda por su wamid.
 *
 * En Kapso: el número → Webhooks → URL `https://<dominio>/api/whatsapp/webhook`,
 * eventos `whatsapp.message.received` y `whatsapp.message.sent` (para ver lo que el
 * equipo responde desde la app del celular). Ver lib/agente-whatsapp/webhook.ts.
 */

import { after } from "next/server";
import { verifyKapsoWebhookSignature } from "@kapso/whatsapp-cloud-api/server";
import { leerEventos } from "@/lib/agente-whatsapp/webhook";
import { procesarEventos } from "@/lib/agente-whatsapp/whatsapp-servidor";

export const maxDuration = 300;

export async function POST(request: Request) {
  const secreto = process.env.KAPSO_WEBHOOK_SECRET?.trim();
  if (!secreto) {
    console.error("[whatsapp] Falta KAPSO_WEBHOOK_SECRET: no se puede verificar el webhook.");
    return Response.json({ error: "Webhook no configurado." }, { status: 503 });
  }

  const crudo = await request.text();
  const firmado = verifyKapsoWebhookSignature({
    secret: secreto,
    rawBody: crudo,
    signatureHeader: request.headers.get("x-webhook-signature") ?? undefined,
  });
  if (!firmado) return Response.json({ error: "Firma inválida." }, { status: 401 });

  let cuerpo: unknown;
  try {
    cuerpo = JSON.parse(crudo);
  } catch {
    return Response.json({ error: "Cuerpo inválido." }, { status: 400 });
  }

  const eventos = leerEventos(cuerpo, request.headers.get("x-webhook-event"));
  if (eventos.length) after(() => procesarEventos(eventos));
  return Response.json({ ok: true, eventos: eventos.length });
}
