/**
 * El material que se estima para un producto terminado y el precio que sale de
 * ahí.
 *
 *   área de una unidad            de la forma y las medidas, o la que se escriba
 *   × unidades × (1 + merma)      = el área de plancha que se va a usar
 *   ÷ área de la plancha          = planchas (con decimales: es una estimación)
 *
 *   costo = planchas × precio de la plancha + accesorios
 *   precio sugerido por unidad = costo por unidad × factor del tipo + extras
 *
 * El mismo motor corre en el navegador, mientras se arma, y en el servidor al
 * guardar, con los precios que lee él de Odoo.
 */

import { areaM2, type Geometria, type Medidas } from "./geometria";

export interface PlanchaDeReferencia {
  productoId: number;
  codigo: string;
  nombre: string;
  anchoCm: number;
  largoCm: number;
  /** El precio de la plancha entera, según Odoo. */
  precio: number;
}

export interface Accesorio {
  productoId: number;
  codigo: string | null;
  nombre: string;
  unidad: string | null;
  /** Para toda la línea, no por unidad. */
  cantidad: number;
  precio: number;
}

/** Un material de la estimación: la plancha o un accesorio. */
export interface MaterialEstimado {
  productoId: number;
  codigo: string | null;
  nombre: string;
  unidad: string | null;
  cantidad: number;
  /** El precio unitario de Odoo cuando se cotizó. */
  precio: number;
  esPlancha: boolean;
}

export interface EntradaTerminado {
  geometria: Geometria;
  medidas: Medidas;
  /** El área de una unidad escrita a mano (m²). Le gana a la de la forma. */
  areaManualM2: number | null;
  cantidad: number;
  plancha: PlanchaDeReferencia | null;
  accesorios: Accesorio[];
  /** Por cuánto se multiplica el costo del material. */
  factor: number;
  /** Lo que suma cada opción elegida al precio de una unidad. */
  extras: number[];
  mermaPct: number;
  anchoDeLetra: number;
}

export interface CalculoTerminado {
  /** El área de una unidad, sin merma. `null`: ni la forma ni nadie la dio. */
  areaUnidadM2: number | null;
  /** Si el área es la escrita a mano. */
  areaManual: boolean;
  /** El área de toda la línea, con merma. */
  areaTotalM2: number;
  /** Planchas de referencia que eso representa. */
  planchas: number;
  materiales: MaterialEstimado[];
  costoMaterial: number;
  /** Por unidad. */
  precioSugerido: number;
}

export const redondear2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
const redondear4 = (x: number) => Math.round((x + Number.EPSILON) * 10000) / 10000;

/**
 * La plancha con la que se estima: de las que tienen precio en Odoo, la más
 * barata por metro cuadrado (y, a igual precio, la más grande).
 */
export function planchaDeReferencia<F extends { codigo: string; anchoCm: number; largoCm: number; activo?: boolean }>(
  formatos: F[],
  precios: ReadonlyMap<string, { productoId: number; precio: number; nombre?: string }>,
): PlanchaDeReferencia | null {
  let mejor: { plancha: PlanchaDeReferencia; porM2: number; area: number } | null = null;
  for (const f of formatos) {
    if (f.activo === false) continue;
    const p = precios.get(f.codigo);
    const area = (f.anchoCm * f.largoCm) / 10000;
    if (!p || !(p.precio > 0) || !(area > 0)) continue;
    const porM2 = p.precio / area;
    if (!mejor || porM2 < mejor.porM2 - 1e-9 || (Math.abs(porM2 - mejor.porM2) <= 1e-9 && area > mejor.area)) {
      mejor = {
        porM2,
        area,
        plancha: {
          productoId: p.productoId,
          codigo: f.codigo,
          nombre: p.nombre ?? f.codigo,
          anchoCm: f.anchoCm,
          largoCm: f.largoCm,
          precio: p.precio,
        },
      };
    }
  }
  return mejor?.plancha ?? null;
}

export function calcularTerminado(e: EntradaTerminado): CalculoTerminado {
  const cantidad = Math.max(0, Math.floor(Number(e.cantidad) || 0));
  const manual = typeof e.areaManualM2 === "number" && e.areaManualM2 > 0;
  const areaUnidadM2 = manual ? redondear4(e.areaManualM2!) : areaM2(e.geometria, e.medidas, e.anchoDeLetra);

  const areaTotalM2 = redondear4((areaUnidadM2 ?? 0) * cantidad * (1 + Math.max(0, e.mermaPct) / 100));
  const areaPlancha = e.plancha ? (e.plancha.anchoCm * e.plancha.largoCm) / 10000 : 0;
  const planchas = areaPlancha > 0 ? redondear2(areaTotalM2 / areaPlancha) : 0;

  const materiales: MaterialEstimado[] = [];
  if (e.plancha && planchas > 0) {
    materiales.push({
      productoId: e.plancha.productoId,
      codigo: e.plancha.codigo,
      nombre: e.plancha.nombre,
      unidad: "plancha",
      cantidad: planchas,
      precio: e.plancha.precio,
      esPlancha: true,
    });
  }
  for (const a of e.accesorios) {
    if (!(a.cantidad > 0)) continue;
    materiales.push({
      productoId: a.productoId,
      codigo: a.codigo,
      nombre: a.nombre,
      unidad: a.unidad,
      cantidad: a.cantidad,
      precio: a.precio,
      esPlancha: false,
    });
  }

  const costoMaterial = redondear2(materiales.reduce((s, m) => s + m.cantidad * m.precio, 0));
  const extras = e.extras.reduce((s, x) => s + (x > 0 ? x : 0), 0);
  const precioSugerido =
    cantidad > 0 ? redondear2((costoMaterial / cantidad) * (e.factor > 0 ? e.factor : 1) + extras) : 0;

  return { areaUnidadM2, areaManual: manual, areaTotalM2, planchas, materiales, costoMaterial, precioSugerido };
}
