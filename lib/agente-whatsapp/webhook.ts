/**
 * Lo que trae un webhook de Kapso, en los términos del agente. Sin dependencias
 * de servidor: se prueba con los payloads de la documentación.
 *
 * Kapso manda un evento por mensaje, o varios juntos si el buffering está activo
 * (`{ batch: true, data: [...] }`); el tipo va en la cabecera `X-Webhook-Event`.
 * De todos, al agente le importan dos:
 *   · `whatsapp.message.received`: un mensaje del cliente.
 *   · un mensaje SALIENTE con `kapso.origin = "business_app"`: alguien del equipo
 *     respondió desde la app de WhatsApp Business del celular (coexistencia).
 *     Se guarda como del asesor, y el agente deja de responder en esa conversación.
 * Los mensajes que manda la propia API (el agente) vuelven como `cloud_api` y se ignoran.
 *
 * Payloads: https://docs.kapso.ai/docs/platform/webhooks/message-events
 */

import { anuncioDeReferral } from "./canal";
import type { Anuncio } from "./tipos";

/** Un archivo que mandó el cliente (o el asesor desde el celular), guardado en Kapso. */
export interface AdjuntoWhatsapp {
  origen: "whatsapp";
  /** `message.kapso.media_url`: se descarga con la clave de Kapso. */
  url: string;
  nombre: string;
  mime: string;
  tamano: number;
}

export interface EventoWhatsapp {
  /** `cliente`: escribió el cliente. `asesor`: alguien del equipo, desde la app del celular. */
  rol: "cliente" | "asesor";
  /** El número de la empresa (Meta phone_number_id). */
  phoneNumberId: string;
  /** El del cliente (o su id de WhatsApp si no muestra el número). */
  telefono: string;
  contacto: string | null;
  wamid: string;
  texto: string;
  adjuntos: AdjuntoWhatsapp[];
  anuncio: Anuncio | null;
  creadoEn: string;
}

export const EVENTO_RECIBIDO = "whatsapp.message.received";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const cadena = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** El texto de un mensaje, según su tipo. Las notas de voz van con su transcripción. */
export function textoDeMensaje(m: Obj): string {
  const kapso = obj(m.kapso);
  const tipo = cadena(m.type) ?? "";
  const delTipo = obj(m[tipo]);
  switch (tipo) {
    case "text":
      return cadena(obj(m.text).body) ?? "";
    case "image":
    case "video":
    case "document":
      return cadena(delTipo.caption) ?? cadena(obj(kapso.message_type_data).caption) ?? "";
    case "sticker":
      return "";
    case "audio": {
      const transcripcion = cadena(kapso.transcript);
      return transcripcion ? `🎤 Nota de voz: ${transcripcion}` : "🎤 Nota de voz (sin transcripción)";
    }
    case "interactive": {
      const i = obj(m.interactive);
      return cadena(obj(i.button_reply).title) ?? cadena(obj(i.list_reply).title) ?? cadena(kapso.content) ?? "";
    }
    case "button":
      return cadena(obj(m.button).text) ?? "";
    case "location": {
      const l = obj(m.location);
      const nombre = [cadena(l.name), cadena(l.address)].filter(Boolean).join(", ");
      return `📍 Ubicación${nombre ? `: ${nombre}` : ""} (${l.latitude}, ${l.longitude})`;
    }
    default:
      return cadena(kapso.content) ?? "";
  }
}

/** El archivo de un mensaje, si trae uno (de `message.kapso.media_url`). */
export function adjuntoDeMensaje(m: Obj): AdjuntoWhatsapp | null {
  const kapso = obj(m.kapso);
  const datos = obj(kapso.media_data);
  const url = cadena(kapso.media_url) ?? cadena(datos.url);
  if (!url || !/^https:\/\//.test(url)) return null;
  const tipo = cadena(m.type) ?? "archivo";
  return {
    origen: "whatsapp",
    url,
    nombre: cadena(datos.filename) ?? `${tipo}`,
    mime: cadena(datos.content_type) ?? "application/octet-stream",
    tamano: typeof datos.byte_size === "number" ? datos.byte_size : 0,
  };
}

function fecha(timestamp: unknown): string {
  const n = Number(timestamp);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : new Date().toISOString();
}

/** Un evento de Kapso, o `null` si al agente no le importa. */
export function eventoDePayload(payload: unknown, tipoEvento: string | null): EventoWhatsapp | null {
  const p = obj(payload);
  const m = obj(p.message);
  const kapso = obj(m.kapso);
  const conversacion = obj(p.conversation);
  const wamid = cadena(m.id);
  const phoneNumberId = cadena(p.phone_number_id) ?? cadena(conversacion.phone_number_id);
  if (!wamid || !phoneNumberId || cadena(m.type) === "reaction") return null;

  const saliente = cadena(kapso.direction) === "outbound";
  let rol: EventoWhatsapp["rol"];
  if (!saliente && (tipoEvento === EVENTO_RECIBIDO || tipoEvento === null)) rol = "cliente";
  else if (saliente && cadena(kapso.origin) === "business_app") rol = "asesor";
  else return null;

  const telefono =
    (rol === "cliente" ? cadena(m.from) ?? cadena(m.from_user_id) : cadena(m.to)) ??
    cadena(conversacion.phone_number) ??
    cadena(conversacion.business_scoped_user_id);
  if (!telefono) return null;

  const adjunto = adjuntoDeMensaje(m);
  const texto = textoDeMensaje(m);
  if (!texto && !adjunto) return null;

  return {
    rol,
    phoneNumberId,
    telefono,
    contacto: cadena(conversacion.contact_name) ?? null,
    wamid,
    texto,
    adjuntos: adjunto ? [adjunto] : [],
    anuncio: rol === "cliente" ? anuncioDeReferral(m.referral ?? p.referral) : null,
    creadoEn: fecha(m.timestamp),
  };
}

/** Los eventos de un webhook (suelto o en lote), en el orden en que ocurrieron. */
export function leerEventos(cuerpo: unknown, tipoEvento: string | null): EventoWhatsapp[] {
  const c = obj(cuerpo);
  const tipo = tipoEvento ?? cadena(c.type) ?? cadena(c.event) ?? null;
  const payloads = c.batch === true && Array.isArray(c.data) ? c.data : [cuerpo];
  return payloads
    .map((p) => eventoDePayload(p, tipo))
    .filter((e): e is EventoWhatsapp => e !== null)
    .sort((a, b) => a.creadoEn.localeCompare(b.creadoEn));
}

/** Los archivos de WhatsApp guardados con un mensaje; los que no se entiendan se saltan. */
export function leerAdjuntosWhatsapp(json: unknown): AdjuntoWhatsapp[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((x): AdjuntoWhatsapp[] => {
    const a = obj(x);
    const url = cadena(a.url);
    if (a.origen !== "whatsapp" || !url) return [];
    return [
      {
        origen: "whatsapp",
        url,
        nombre: cadena(a.nombre) ?? "archivo",
        mime: cadena(a.mime) ?? "application/octet-stream",
        tamano: typeof a.tamano === "number" ? a.tamano : 0,
      },
    ];
  });
}
