/**
 * La referencia de una línea de cotización (y del pedido que sale de ella) al
 * diseño CAD del que viene: «Diseño CAD 1b2c…-… v3».
 *
 * Viaja dentro de las notas del producto terminado, que ya se guardan con la
 * ficha de la línea: así la cotización, el pedido y la hoja de corte la tienen
 * sin columnas nuevas. La hoja de corte la lee para bajar el DXF por plancha del
 * motor en vez del de rectángulos.
 */

export interface ReferenciaDiseno {
  disenoId: string;
  version: number;
}

const PATRON =
  /Diseño CAD ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}) v(\d+)/i;

export const marcaDiseno = (r: ReferenciaDiseno) =>
  `Diseño CAD ${r.disenoId} v${r.version}`;

/** La referencia escrita en un texto (las notas de la línea). `null` si no hay. */
export function leerReferenciaDiseno(
  texto: string | null | undefined,
): ReferenciaDiseno | null {
  const m = texto ? PATRON.exec(texto) : null;
  if (!m) return null;
  const version = Number(m[2]);
  return version > 0 ? { disenoId: m[1].toLowerCase(), version } : null;
}
