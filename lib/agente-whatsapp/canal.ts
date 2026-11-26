/**
 * El canal de WhatsApp, listo para la fase 2 (todavía no lo usa nadie: el área
 * de pruebas no envía nada a un número real).
 *
 * Se habla con la Cloud API con el SDK de Kapso (`@kapso/whatsapp-cloud-api`),
 * que replica la Graph API de Meta. Por eso el mismo código sirve para los dos
 * proveedores y cambiar es configuración:
 *
 *   WHATSAPP_PROVEEDOR=kapso → https://api.kapso.ai/meta/whatsapp con KAPSO_API_KEY.
 *   WHATSAPP_PROVEEDOR=meta  → graph.facebook.com directo con META_ACCESS_TOKEN.
 *
 * Los webhooks de los dos traen el anuncio en `messages[].referral` (Kapso lo
 * reenvía tal cual con un webhook de tipo "meta"). Las firmas se verifican con
 * `verifyKapsoWebhookSignature` (Kapso, `X-Webhook-Signature`) o `verifySignature`
 * (Meta, `X-Hub-Signature-256`) de `@kapso/whatsapp-cloud-api/server`.
 */

import { WhatsAppClient } from "@kapso/whatsapp-cloud-api";
import type { Anuncio, MensajeAgente } from "./tipos";

export type ProveedorWhatsApp = "kapso" | "meta";

const BASE_KAPSO = "https://api.kapso.ai/meta/whatsapp";

export function proveedorWhatsApp(): ProveedorWhatsApp {
  return process.env.WHATSAPP_PROVEEDOR?.trim().toLowerCase() === "meta" ? "meta" : "kapso";
}

/** El cliente de la Cloud API según el proveedor. `null` si falta su clave. */
export function clienteWhatsApp(proveedor = proveedorWhatsApp()): WhatsAppClient | null {
  if (proveedor === "meta") {
    const token = process.env.META_ACCESS_TOKEN?.trim();
    return token ? new WhatsAppClient({ accessToken: token, graphVersion: "v24.0" }) : null;
  }
  const clave = process.env.KAPSO_API_KEY?.trim();
  return clave ? new WhatsAppClient({ baseUrl: BASE_KAPSO, kapsoApiKey: clave, graphVersion: "v24.0" }) : null;
}

/**
 * El anuncio de un mensaje entrante, desde su `referral` (formato de Meta):
 * `{ source_type: "ad", source_id, source_url, headline, body, ctwa_clid, … }`.
 * `null` si el mensaje no vino de un anuncio.
 */
export function anuncioDeReferral(referral: unknown): Anuncio | null {
  if (!referral || typeof referral !== "object") return null;
  const r = referral as Record<string, unknown>;
  const cadena = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const anuncio: Anuncio = {
    sourceId: cadena(r.source_id),
    titulo: cadena(r.headline),
    texto: cadena(r.body),
    url: cadena(r.source_url),
    ctwaClid: cadena(r.ctwa_clid),
  };
  return anuncio.sourceId || anuncio.titulo || anuncio.texto ? anuncio : null;
}

/** Cómo se envía cada mensaje del agente: el cuerpo que va a la Cloud API. Exportado para las pruebas. */
export function envioDe(
  mensaje: MensajeAgente,
  enlaces: Map<string, string>,
): { tipo: "texto"; body: string } | { tipo: "imagen" | "documento"; link: string; caption?: string; filename?: string } | null {
  if (mensaje.tipo === "texto") return { tipo: "texto", body: mensaje.texto };
  const link = enlaces.get(mensaje.adjunto.documentoId);
  if (!link) return null;
  if (mensaje.adjunto.mime.startsWith("image/")) return { tipo: "imagen", link, caption: mensaje.texto };
  return { tipo: "documento", link, caption: mensaje.texto, filename: mensaje.adjunto.nombre };
}

/**
 * Envía la respuesta del agente a un número, en orden. `enlaces` son URLs
 * temporales de los archivos (de `enlacesDeDocumentos`): Meta los descarga de ahí.
 */
export async function enviarRespuesta(
  cliente: WhatsAppClient,
  { phoneNumberId, to }: { phoneNumberId: string; to: string },
  mensajes: MensajeAgente[],
  enlaces: Map<string, string>,
): Promise<void> {
  for (const m of mensajes) {
    const envio = envioDe(m, enlaces);
    if (!envio) continue;
    if (envio.tipo === "texto") await cliente.messages.sendText({ phoneNumberId, to, body: envio.body });
    else if (envio.tipo === "imagen") {
      await cliente.messages.sendImage({ phoneNumberId, to, image: { link: envio.link, caption: envio.caption } });
    } else {
      await cliente.messages.sendDocument({
        phoneNumberId,
        to,
        document: { link: envio.link, caption: envio.caption, filename: envio.filename },
      });
    }
  }
}
