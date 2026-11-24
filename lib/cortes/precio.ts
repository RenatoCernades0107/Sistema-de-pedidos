/**
 * El precio de un corte cuando quien cotiza lo cambia a mano.
 *
 * El calculado es casi el mínimo: se puede subir sin tope y bajar hasta
 * `descuentoMaxPct` por ciento menos. Puro, sin dependencias de servidor: lo
 * usan el formulario (para avisar) y el servidor (para exigirlo).
 */

import type { CalculoCorte } from "./calcular";

const redondear2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Lo menos que puede valer un corte de `total`: el descuento máximo, redondeado al céntimo hacia arriba. */
export function precioMinimoCorte(total: number, descuentoMaxPct: number): number {
  return Math.ceil((total * (1 - descuentoMaxPct / 100)) * 100 - 1e-9) / 100;
}

/**
 * El cálculo con el precio que se puso. La diferencia la absorbe el servicio
 * —igual que el redondeo—, así `material + servicio = total` sigue cumpliéndose,
 * y el desglose la muestra como "Ajuste de precio".
 */
export function conPrecioFinal(calculo: CalculoCorte, precioFinal: number): CalculoCorte {
  const total = redondear2(precioFinal);
  const ajuste = redondear2(total - calculo.total);
  if (ajuste === 0) return calculo;

  const desglose = calculo.desglose.filter((l) => !l.esTotal);
  desglose.push({ etiqueta: "Ajuste de precio", monto: ajuste });
  desglose.push({ etiqueta: "Total", monto: total, esTotal: true });
  return { ...calculo, servicio: redondear2(total - calculo.material), total, desglose };
}
