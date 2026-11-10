/**
 * Corte manual: se cobra por pieza, y el precio de la pieza depende del espesor.
 *
 * La tabla es exacta, sin interpolar: a mano se cortan solo ciertos espesores, y
 * que uno no esté en la tabla significa "esto no se corta a mano". Las
 * excepciones se resuelven agregando la fila en Configuración.
 */

import type { PrecioManual } from "./config";

/** El precio por pieza a ese espesor, o `null` si no se corta a mano. */
export function precioManual(precios: PrecioManual[], espesorMm: number): number | null {
  const fila = precios.find((p) => Math.abs(p.mm - espesorMm) < 0.005);
  return fila ? fila.precio : null;
}

export const mensajeSinPrecioManual = (espesorMm: number) =>
  `No hay precio de corte manual para ${espesorMm} mm. Agrégalo en Configuración o elige corte láser.`;
