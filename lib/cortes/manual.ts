/**
 * Corte manual: se hace con cutter y se cobra por metro lineal de corte (ver
 * `metros.ts`), a una tarifa que depende del espesor.
 *
 * Cada fila de la tabla vale "hasta tantos mm": un espesor paga la primera fila
 * que lo alcanza. Más grueso que la última fila significa "esto no se corta a
 * mano"; las excepciones se resuelven agregando la fila en Configuración.
 */

import type { TarifaManual } from "./config";

/** Los soles por metro a ese espesor, o `null` si no se corta a mano. */
export function tarifaManual(tarifas: TarifaManual[], espesorMm: number): number | null {
  const fila = [...tarifas].sort((a, b) => a.hastaMm - b.hastaMm).find((t) => espesorMm <= t.hastaMm + 0.005);
  return fila ? fila.solesPorMetro : null;
}

export const mensajeSinPrecioManual = (espesorMm: number) =>
  `No hay tarifa de corte manual para ${espesorMm} mm. Agrégala en Configuración o elige corte láser.`;
