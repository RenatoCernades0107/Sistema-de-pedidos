/**
 * El idioma de la app para lo que devuelve la Quote Agent API, y los traductores
 * que lo pasan de su `snake_case` al nuestro.
 *
 * Separado de `cotizaciones/acciones.ts` porque lo necesitan dos llamadores: las
 * Server Actions y el route handler que recibe los mensajes con archivos. Un
 * archivo `"use server"` no puede exportar nada que no sea una función async, así
 * que no puede hacer de biblioteca ni de estos tipos ni de estas funciones puras.
 */

export interface Cotizacion {
  orderId: number;
  orderName: string;
  totalPen: number;
}

/** Un archivo ya guardado por el agente: la ficha, no los bytes. */
export interface Adjunto {
  attachmentId: string;
  filename: string;
  contentType: string;
  size: number;
}

export interface Mensaje {
  role: "user" | "assistant";
  text: string;
  adjuntos: Adjunto[];
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

/** Lo que devuelve un turno de conversación, ya traducido. */
export interface TurnoEnviado {
  chatId: string;
  reply: string;
  lastQuotation: Cotizacion | null;
  newQuotation: Record<string, unknown> | null;
  hasCutSheet: boolean;
  adjuntos: Adjunto[];
}

export function deCotizacion(json: unknown): Cotizacion | null {
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
 * se normaliza a `null` para que esto no truene contra el backend actual.
 */
export function deNuevaCotizacion(json: unknown): Record<string, unknown> | null {
  if (!json || typeof json !== "object") return null;
  return json as Record<string, unknown>;
}

function deAdjunto(json: unknown): Adjunto | null {
  if (!json || typeof json !== "object") return null;
  const a = json as Record<string, unknown>;
  if (typeof a.attachment_id !== "string" || typeof a.filename !== "string") return null;
  return {
    attachmentId: a.attachment_id,
    filename: a.filename,
    contentType: typeof a.content_type === "string" ? a.content_type : "application/octet-stream",
    size: typeof a.size === "number" ? a.size : 0,
  };
}

export function deAdjuntos(json: unknown): Adjunto[] {
  if (!Array.isArray(json)) return [];
  return json.map(deAdjunto).filter((a): a is Adjunto => a !== null);
}

export function deMensajes(json: unknown): Mensaje[] {
  if (!Array.isArray(json)) return [];
  return (json as Record<string, unknown>[]).map((m) => ({
    role: m.role as "user" | "assistant",
    text: (m.text as string) ?? "",
    adjuntos: deAdjuntos(m.attachments),
  }));
}

export function deChat(json: Record<string, unknown>): ChatResumen {
  return {
    chatId: json.chat_id as string,
    title: json.title as string,
    createdAt: json.created_at as string,
    updatedAt: json.updated_at as string,
    lastQuotation: deCotizacion(json.last_quotation),
    newQuotation: deNuevaCotizacion(json.new_quotation),
  };
}

export function deTurno(chatId: string, json: Record<string, unknown>): TurnoEnviado {
  return {
    chatId,
    reply: json.reply as string,
    lastQuotation: deCotizacion(json.last_quotation),
    newQuotation: deNuevaCotizacion(json.new_quotation),
    hasCutSheet: json.has_cut_sheet === true,
    adjuntos: deAdjuntos(json.attachments),
  };
}
