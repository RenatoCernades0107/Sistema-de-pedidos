/**
 * El material que se estima para un producto terminado y el precio que sale de
 * ahí.
 *
 *   área de una unidad            de la forma y las medidas, o la que se escriba
 *   × unidades × (1 + merma)      = el área de plancha que se va a usar
 *   ÷ área de la plancha          = planchas (con decimales: es una estimación)
 *
 *   costo = planchas × precio de la plancha + accesorios
 *
 * Cuando la forma se despieza (`piezas.ts`), el material ya no sale del área:
 * las piezas se acomodan en cada formato del material con el optimizador de la
 * hoja de corte, y se usa el formato más barato. Las planchas salen enteras o
 * en las fracciones que vende el taller (½, ¼), y la merma no se suma: el
 * desperdicio real ya está en el acomodo. Si no se puede despiezar, o alguna
 * pieza no entra en ninguna plancha, se vuelve al cálculo por área.
 *   precio sugerido por unidad = costo por unidad × factor del tipo + extras
 *
 * El mismo motor corre en el navegador, mientras se arma, y en el servidor al
 * guardar, con los precios que lee él de Odoo.
 */

import { compararFormatos, MAX_PIEZAS, type CalculoCorte, type FormatoCorte } from "../cortes/calcular";
import type { ConfigCortes } from "../cortes/config";
import { areaM2, type Geometria, type Medidas } from "./geometria";
import { piezasDeTerminado, type PiezaDeTerminado } from "./piezas";

export interface PlanchaDeReferencia {
  productoId: number;
  codigo: string;
  nombre: string;
  anchoCm: number;
  largoCm: number;
  /** El precio de la plancha entera, según Odoo. */
  precio: number;
}

/** Un formato del material, con su producto y su precio de Odoo: con esto se acomodan las piezas. */
export interface FormatoTerminado extends FormatoCorte {
  productoId: number;
  nombre: string;
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
  /** Los formatos del material con precio. Sin ellos (o sin `configCortes`), se estima por área. */
  formatos?: FormatoTerminado[];
  configCortes?: ConfigCortes;
  /** El espesor del material: lo pide el cálculo del corte. */
  espesorMm?: number;
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
  /** Las piezas de toda la línea (las de una unidad × unidades). `null`: la forma no se despieza. */
  piezas: PiezaDeTerminado[] | null;
  /** El acomodo en el formato elegido. `null`: el material se estimó por área. */
  corte: CalculoCorte | null;
  /** El formato del corte, con su producto de Odoo. */
  formato: FormatoTerminado | null;
  /** Por qué, habiendo piezas, el material se estimó por área. */
  aviso: string | null;
  /** La merma que se aplicó (0 si el material salió del acomodo). */
  mermaPct: number;
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

const numero = (x: number) => String(+x.toFixed(2));

/** Las piezas de una unidad, multiplicadas por las unidades de la línea. */
export function piezasDeLinea(porUnidad: PiezaDeTerminado[], unidades: number): PiezaDeTerminado[] {
  return porUnidad.map((p) => ({ ...p, cantidad: p.cantidad * unidades }));
}

/** Los formatos activos del material que tienen precio en Odoo, listos para acomodar piezas. */
export function formatosConPrecio<F extends { codigo: string; anchoCm: number; largoCm: number; activo?: boolean }>(
  formatos: F[],
  precios: ReadonlyMap<string, { productoId: number; precio: number; nombre?: string }>,
): FormatoTerminado[] {
  const salida: FormatoTerminado[] = [];
  for (const f of formatos) {
    const p = precios.get(f.codigo);
    if (f.activo === false || !p || !(p.precio > 0) || !(f.anchoCm > 0) || !(f.largoCm > 0)) continue;
    // El mismo código dos veces (SKU compartido) se acomoda una vez.
    if (salida.some((s) => s.codigo === f.codigo)) continue;
    salida.push({
      codigo: f.codigo,
      ancho: f.anchoCm,
      alto: f.largoCm,
      precio: p.precio,
      productoId: p.productoId,
      nombre: p.nombre ?? f.codigo,
    });
  }
  return salida;
}

type Acomodo =
  | { corte: CalculoCorte; formato: FormatoTerminado; aviso: null }
  | { corte: null; formato: null; aviso: string | null };

/** El acomodo en el formato más barato, o por qué no lo hay. */
function acomodar(e: EntradaTerminado, piezas: PiezaDeTerminado[] | null, manual: boolean): Acomodo {
  const nada = (aviso: string | null): Acomodo => ({ corte: null, formato: null, aviso });
  if (!piezas || piezas.length === 0) return nada(null);
  if (manual) return nada("Con el área escrita a mano, el material se estima por área y no por cortes.");
  const formatos = (e.formatos ?? []).filter((f) => f.precio > 0 && f.ancho > 0 && f.alto > 0);
  if (!e.configCortes || formatos.length === 0) return nada(null);
  const total = piezas.reduce((s, p) => s + p.cantidad, 0);
  if (total === 0) return nada(null);
  if (total > MAX_PIEZAS) {
    return nada(`Son ${total} piezas, más de las ${MAX_PIEZAS} que se acomodan de una vez: el material se estima por área.`);
  }

  const opciones = compararFormatos(
    { piezas, espesorMm: e.espesorMm ?? 0, modalidad: "laser", rotable: true },
    formatos,
    e.configCortes,
  );
  const mejor = opciones.find((o) => o.noCaben.length === 0 && o.planchas.length > 0);
  if (!mejor) {
    const grande = Math.max(...formatos.map((f) => Math.max(f.ancho, f.alto)));
    const fuera = piezas.find((p) => Math.max(p.ancho, p.alto) > grande) ?? piezas[0];
    return nada(
      `${fuera.nombre} (${numero(fuera.ancho)} × ${numero(fuera.alto)} cm) no entra en ninguna plancha de este ` +
        "material: el material se estima por área.",
    );
  }
  const formato = formatos.find((f) => f.codigo === mejor.formato.codigo)!;
  return { corte: mejor, formato, aviso: null };
}

export function calcularTerminado(e: EntradaTerminado): CalculoTerminado {
  const cantidad = Math.max(0, Math.floor(Number(e.cantidad) || 0));
  const manual = typeof e.areaManualM2 === "number" && e.areaManualM2 > 0;
  const areaUnidadM2 = manual ? redondear4(e.areaManualM2!) : areaM2(e.geometria, e.medidas, e.anchoDeLetra);

  const porUnidad = piezasDeTerminado(e.geometria, e.medidas, e.anchoDeLetra);
  const piezas = porUnidad && cantidad > 0 ? piezasDeLinea(porUnidad, cantidad) : null;
  const { corte, formato, aviso } = acomodar(e, piezas, manual);

  const mermaPct = corte ? 0 : Math.max(0, e.mermaPct);
  const areaTotalM2 = redondear4((areaUnidadM2 ?? 0) * cantidad * (1 + mermaPct / 100));
  const areaPlancha = e.plancha ? (e.plancha.anchoCm * e.plancha.largoCm) / 10000 : 0;
  const planchas = corte
    ? redondear2(corte.planchas.reduce((s, p) => s + p.cobro.factor, 0))
    : areaPlancha > 0
      ? redondear2(areaTotalM2 / areaPlancha)
      : 0;

  const materiales: MaterialEstimado[] = [];
  if (corte && formato) {
    materiales.push({
      productoId: formato.productoId,
      codigo: formato.codigo,
      nombre: formato.nombre,
      unidad: "plancha",
      cantidad: planchas,
      precio: formato.precio,
      esPlancha: true,
    });
  } else if (e.plancha && planchas > 0) {
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

  return {
    areaUnidadM2,
    areaManual: manual,
    areaTotalM2,
    planchas,
    materiales,
    costoMaterial,
    precioSugerido,
    piezas,
    corte,
    formato,
    aviso,
    mermaPct,
  };
}
