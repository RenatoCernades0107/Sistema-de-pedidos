/**
 * Los archivos que la persona adjunta a un mensaje del chat de diseños: fotos,
 * bocetos o planos (imagen o PDF) para que el asistente los lea.
 *
 * Viven en el bucket privado `cad_adjuntos`, en la carpeta del diseño
 * (`<diseno_id>/<uuid>.<ext>`), y el mensaje guarda la lista en
 * `cad_mensajes.adjuntos` (migración 20261204000100). Este archivo es lo que
 * comparten el navegador y el servidor: los topes, los tipos y la validación.
 */

import { z } from "zod";

export const BUCKET_CAD_ADJUNTOS = "cad_adjuntos";

/** Lo que el modelo sabe leer. El resto se rechaza en vez de mandarse y ser ignorado. */
export const TIPOS_ADJUNTO = ["image/png", "image/jpeg", "image/webp", "application/pdf"] as const;
export type TipoAdjunto = (typeof TIPOS_ADJUNTO)[number];

/** Cuántos archivos por mensaje. */
export const MAX_ADJUNTOS = 6;
/** Lo que pesa cada uno como mucho (el mismo tope que el bucket). */
export const MAX_BYTES_ADJUNTO = 10 * 1024 * 1024;

export type AdjuntoCad = {
  /** La ruta dentro del bucket `cad_adjuntos`. */
  ruta: string;
  /** El nombre con el que lo eligió la persona. */
  nombre: string;
  mime: TipoAdjunto;
  /** En bytes. */
  tamano: number;
};

export const esTipoAdjunto = (mime: string): mime is TipoAdjunto =>
  (TIPOS_ADJUNTO as readonly string[]).includes(mime);

export const esImagenAdjunto = (mime: string) => mime.startsWith("image/");

/** `<uuid>/<uuid>.<ext>`: nada de `..`, barras de más ni rutas de otro sitio. */
const RUTA = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpe?g|webp|pdf)$/i;

export const esquemaAdjunto = z.object({
  ruta: z.string().regex(RUTA),
  nombre: z.string().trim().min(1).max(200),
  mime: z.enum(TIPOS_ADJUNTO),
  tamano: z.number().int().positive().max(MAX_BYTES_ADJUNTO),
});

export const esquemaAdjuntos = z.array(esquemaAdjunto).max(MAX_ADJUNTOS);

/** Si la ruta está en la carpeta de este diseño. */
export const rutaDeDiseno = (ruta: string, disenoId: string) =>
  ruta.toLowerCase().startsWith(`${disenoId.toLowerCase()}/`);

/** Dónde se sube un archivo nuevo de este diseño. */
export function rutaNueva(disenoId: string, mime: TipoAdjunto): string {
  const ext = mime === "application/pdf" ? "pdf" : mime === "image/jpeg" ? "jpg" : mime.slice("image/".length);
  return `${disenoId}/${crypto.randomUUID()}.${ext}`;
}

/** Los adjuntos guardados con un mensaje; los que no se entiendan se saltan. */
export function deAdjuntos(valor: unknown): AdjuntoCad[] {
  if (!Array.isArray(valor)) return [];
  const salida: AdjuntoCad[] = [];
  for (const a of valor) {
    const leido = esquemaAdjunto.safeParse(a);
    if (leido.success) salida.push(leido.data);
  }
  return salida;
}

/** 860160 → "840 KB". */
export function pesoTexto(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  return kb < 1024 ? `${Math.round(kb)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

/**
 * De los adjuntos de una conversación (en orden, del más viejo al más nuevo),
 * cuáles se le reenvían enteros al modelo: los `max` más recientes. Los demás
 * se le nombran nada más, para no mandar en cada turno todo lo que se adjuntó.
 */
export function rutasAReenviar(porMensaje: readonly (readonly AdjuntoCad[])[], max: number): Set<string> {
  const todas = porMensaje.flat().map((a) => a.ruta);
  return new Set(max > 0 ? todas.slice(-max) : []);
}
