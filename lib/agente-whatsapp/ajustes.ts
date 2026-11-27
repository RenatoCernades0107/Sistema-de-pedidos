/**
 * Lo que Administración ajusta del agente en `/agente-whatsapp` (pestaña
 * Ajustes): instrucciones extra y el contexto de cada anuncio de Meta. Vive en la
 * fila `agente_whatsapp` de `configuracion`.
 *
 * Antes también guardaba el mensaje que decía al pasar a un asesor; desde que el
 * agente calla al derivar ya no se usa, y si viene en datos viejos se ignora.
 */

import { z } from "zod";

export const CLAVE_AJUSTES_AGENTE = "agente_whatsapp";

export const esquemaAnuncio = z.object({
  sourceId: z
    .string()
    .trim()
    .min(1, "Cada anuncio necesita su ID de Meta (source_id)")
    .max(64, "El ID del anuncio es demasiado largo"),
  nombre: z.string().trim().min(1, "Cada anuncio necesita un nombre").max(120, "El nombre del anuncio es demasiado largo"),
  contexto: z.string().trim().max(2000, "El contexto de un anuncio no puede pasar de 2000 caracteres"),
});

export type AnuncioConfigurado = z.infer<typeof esquemaAnuncio>;

export const esquemaAjustesAgente = z.object({
  instrucciones: z.string().trim().max(4000, "Las instrucciones no pueden pasar de 4000 caracteres"),
  anuncios: z
    .array(esquemaAnuncio)
    .max(50, "Como mucho 50 anuncios")
    .refine((a) => new Set(a.map((x) => x.sourceId)).size === a.length, "Hay dos anuncios con el mismo ID"),
});

export type AjustesAgente = z.infer<typeof esquemaAjustesAgente>;

export const AJUSTES_POR_DEFECTO: AjustesAgente = {
  instrucciones: "",
  anuncios: [],
};

/** Lo guardado, o el defecto en lo que falte o no se entienda. */
export function leerAjustesAgente(json: unknown): AjustesAgente {
  const fuente = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const instrucciones = esquemaAjustesAgente.shape.instrucciones.safeParse(fuente.instrucciones);
  const anuncios = Array.isArray(fuente.anuncios)
    ? fuente.anuncios.flatMap((a) => {
        const r = esquemaAnuncio.safeParse(a);
        return r.success ? [r.data] : [];
      })
    : [];
  return {
    instrucciones: instrucciones.success ? instrucciones.data : "",
    anuncios: anuncios.filter((a, i) => anuncios.findIndex((b) => b.sourceId === a.sourceId) === i).slice(0, 50),
  };
}
