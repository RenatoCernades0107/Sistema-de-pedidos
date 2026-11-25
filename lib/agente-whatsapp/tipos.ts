/**
 * Los tipos del agente de ventas de WhatsApp. No saben de canal: el área de
 * pruebas y (más adelante) el webhook de Kapso/Meta hablan con el motor en
 * estos términos.
 */

export const TIPOS_DOCUMENTO = {
  catalogo: "Catálogo",
  ficha_tecnica: "Ficha técnica",
  foto: "Foto",
  otro: "Otro",
} as const;

export type TipoDocumento = keyof typeof TIPOS_DOCUMENTO;

export const esTipoDocumento = (v: unknown): v is TipoDocumento =>
  typeof v === "string" && v in TIPOS_DOCUMENTO;

export const MIMES_DOCUMENTO = ["application/pdf", "image/png", "image/jpeg", "image/webp"] as const;
export type MimeDocumento = (typeof MIMES_DOCUMENTO)[number];
export const esMimeDocumento = (v: string): v is MimeDocumento => (MIMES_DOCUMENTO as readonly string[]).includes(v);

/** Como el límite del bucket `agente_conocimiento`. */
export const MAX_BYTES_DOCUMENTO = 20 * 1024 * 1024;

export const BUCKET_CONOCIMIENTO = "agente_conocimiento";

export type EstadoDocumento = "procesando" | "listo" | "error";

/** Un archivo de la base de conocimiento, como lo ve la pantalla. */
export interface DocumentoAgente {
  id: string;
  nombre: string;
  tipo: TipoDocumento;
  mime: MimeDocumento;
  ruta: string;
  tamano: number;
  descripcion: string;
  estado: EstadoDocumento;
  error: string | null;
  enviable: boolean;
  paginas: number | null;
  fragmentos: number;
  creadoEn: string;
}

/**
 * El anuncio de Meta (Click-to-WhatsApp) del que viene el cliente: lo que trae
 * `messages[].referral` en el webhook (source_id, headline, body, source_url…).
 */
export interface Anuncio {
  sourceId?: string;
  titulo?: string;
  texto?: string;
  url?: string;
  ctwaClid?: string;
}

/** Un archivo que el agente le manda al cliente. */
export interface AdjuntoAgente {
  documentoId: string;
  nombre: string;
  mime: MimeDocumento;
  tipo: TipoDocumento;
}

/** Lo que el agente contesta, en el orden en que se envía por WhatsApp. */
export type MensajeAgente =
  | { tipo: "texto"; texto: string }
  | { tipo: "archivo"; adjunto: AdjuntoAgente; texto?: string };

/** Un turno ya ocurrido de la conversación. */
export interface TurnoHistorial {
  rol: "cliente" | "agente";
  contenido: string;
  adjuntos?: AdjuntoAgente[];
}

/** Una herramienta que usó el agente para responder, para el panel "¿Por qué respondió esto?". */
export interface PasoTraza {
  herramienta: string;
  argumentos: Record<string, unknown>;
  /** Una línea: "3 precios encontrados", "Dirección y 2 cuentas". */
  resumen: string;
  /** Lo que le devolvió, para mirarlo de cerca (recortado). */
  detalle?: unknown;
  error?: boolean;
}

export interface RespuestaAgente {
  mensajes: MensajeAgente[];
  traza: PasoTraza[];
  /** Si pidió que siga un asesor humano. */
  derivado: boolean;
  /** El motivo, cuando derivó. */
  motivoDerivacion?: string;
}
