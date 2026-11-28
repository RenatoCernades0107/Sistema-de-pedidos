/**
 * Las series del gráfico de Costos y precios, a partir del historial. Puro: lo
 * arma el navegador al cambiar los filtros, sin volver al servidor.
 *
 * Cada serie es escalonada: un costo vale desde su compra hasta la siguiente, y
 * un precio desde que se cambió hasta el próximo cambio. El precio se conoce
 * desde que se aplica en Costos y precios (antes, solo el de hoy).
 */

import { segundoCosto, sinIgv, tasaOperativa, type ConfigCostos, type MesOperativo } from "./costeo";

export interface FilaGrafico {
  productoId: number | null;
  codigo: string;
  /** Precio de lista de hoy (Odoo). */
  precio: number | null;
  kgPorPlancha: number | null;
  areaM2: number;
}

export interface SeriesHistoricas {
  costos: Record<number, { fecha: string; costo: number }[]>;
  precios: Record<number, { fecha: string; precio: number }[]>;
}

export type Fila = { fecha: string } & Record<string, number | string | null>;

export type Unidad = "plancha" | "kg" | "m2";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** El último valor con fecha ≤ `fecha` (las listas vienen en orden de fecha). */
function vigente<T extends { fecha: string }>(lista: T[] | undefined, fecha: string): T | null {
  let v: T | null = null;
  for (const x of lista ?? []) {
    if (x.fecha <= fecha) v = x;
    else break;
  }
  return v;
}

function fechasDe(filas: FilaGrafico[], s: SeriesHistoricas, hoy: string): string[] {
  const f = new Set<string>([hoy]);
  for (const x of filas) {
    if (!x.productoId) continue;
    for (const c of s.costos[x.productoId] ?? []) f.add(c.fecha);
    for (const p of s.precios[x.productoId] ?? []) f.add(p.fecha);
  }
  return [...f].sort();
}

function contexto(meses: MesOperativo[], config: ConfigCostos) {
  const tasas = new Map<string, number | null>();
  const tasaEn = (fecha: string) => {
    const mes = fecha.slice(0, 7);
    if (!tasas.has(mes)) tasas.set(mes, tasaOperativa(meses, mes, config.mesesPromedio));
    return tasas.get(mes)!;
  };
  return { tasaEn };
}

function precioEn(f: FilaGrafico, s: SeriesHistoricas, fecha: string, hoy: string): number | null {
  if (fecha >= hoy && f.precio !== null) return f.precio;
  return f.productoId ? (vigente(s.precios[f.productoId], fecha)?.precio ?? null) : null;
}

/**
 * Una plancha: su 1er costo, su 2do costo y su precio (sin IGV, para que se
 * compare con los costos en el mismo eje), en el tiempo.
 */
export function serieDePlancha(
  f: FilaGrafico,
  s: SeriesHistoricas,
  meses: MesOperativo[],
  config: ConfigCostos,
  hoy: string,
): Fila[] {
  const { tasaEn } = contexto(meses, config);
  return fechasDe([f], s, hoy).flatMap((fecha) => {
    const c = f.productoId ? vigente(s.costos[f.productoId], fecha) : null;
    const p = precioEn(f, s, fecha, hoy);
    if (!c && p === null) return [];
    return [
      {
        fecha,
        primer: c ? r2(c.costo) : null,
        segundo: c ? r2(segundoCosto(c.costo, tasaEn(fecha))) : null,
        precio: p === null ? null : r2(sinIgv(p, config)),
      },
    ];
  });
}

/** Varias planchas: el 1er costo de cada una, por plancha, por kg o por m². */
export function serieDeCostos(
  filas: FilaGrafico[],
  s: SeriesHistoricas,
  unidad: Unidad,
  hoy: string,
): Fila[] {
  const divisor = (f: FilaGrafico) => (unidad === "kg" ? f.kgPorPlancha : unidad === "m2" ? f.areaM2 : 1);
  return fechasDe(filas, s, hoy).flatMap((fecha) => {
    const fila: Fila = { fecha };
    let alguno = false;
    for (const f of filas) {
      const c = f.productoId ? vigente(s.costos[f.productoId], fecha) : null;
      const d = divisor(f);
      fila[f.codigo] = c && d && d > 0 ? r2(c.costo / d) : null;
      if (fila[f.codigo] !== null) alguno = true;
    }
    return alguno ? [fila] : [];
  });
}

/** Varias planchas: el margen (precio sin IGV contra el 2do costo), en %. */
export function serieDeMargen(
  filas: FilaGrafico[],
  s: SeriesHistoricas,
  meses: MesOperativo[],
  config: ConfigCostos,
  hoy: string,
): Fila[] {
  const { tasaEn } = contexto(meses, config);
  return fechasDe(filas, s, hoy).flatMap((fecha) => {
    const fila: Fila = { fecha };
    let alguno = false;
    for (const f of filas) {
      const c = f.productoId ? vigente(s.costos[f.productoId], fecha) : null;
      const p = precioEn(f, s, fecha, hoy);
      if (!c || p === null) {
        fila[f.codigo] = null;
        continue;
      }
      const base = sinIgv(p, config);
      const costo = segundoCosto(c.costo, tasaEn(fecha));
      fila[f.codigo] = base > 0 ? Math.round(((base - costo) / base) * 1000) / 10 : null;
      alguno = true;
    }
    return alguno ? [fila] : [];
  });
}
