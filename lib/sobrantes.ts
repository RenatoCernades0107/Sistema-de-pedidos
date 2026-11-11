/**
 * Los sobrantes en el idioma de la pantalla: qué son, cómo se miden, cuándo son
 * "estándar" y cuáles sirven para una pieza.
 *
 * Funciones puras, sin dependencias de servidor: las usan la pantalla de
 * Sobrantes, el servidor y las pruebas.
 */

import { colorDe, espesorTexto, type FormatoPlancha, type GrupoPlancha } from "./cortes/catalogo";

export type EstadoSobrante = "disponible" | "reservado" | "consumido" | "baja";
export type OrigenSobrante = "manual" | "corte" | "odoo";
export type SincronizacionSobrante = "pendiente" | "sincronizada" | "error";

export const ESTADOS_SOBRANTE: Record<EstadoSobrante, string> = {
  disponible: "Disponible",
  reservado: "Reservado",
  consumido: "Consumido",
  baja: "De baja",
};

export interface Sobrante {
  id: string;
  /** SOB-00042: el nombre del lote en Odoo y lo que dice la etiqueta. */
  codigo: string;
  grupoId: string;
  /** "Acrílico ECO · Cristal · 3 mm". */
  material: string;
  /** El color de la pieza, si el grupo comparte código entre colores. */
  color: string | null;
  /** El lado mayor, en cm. */
  largo: number;
  ancho: number;
  ubicacion: string | null;
  estado: EstadoSobrante;
  estandar: boolean;
  /** El pedido que lo tiene reservado o lo consumió. */
  pedido: string | null;
  origen: OrigenSobrante;
  odooLotId: number | null;
  sincronizacion: SincronizacionSobrante;
  errorSincronizacion: string | null;
  creadoEn: string;
}

const n = (x: number) => String(+x.toFixed(2));

/** "183×61": el largo primero, como se mide en el almacén. */
export const medidaSobrante = (s: Pick<Sobrante, "largo" | "ancho">) => `${n(s.largo)}×${n(s.ancho)}`;

/** Las medidas con el lado mayor como largo. */
export function normalizarMedidas(a: number, b: number): { largo: number; ancho: number } {
  return a >= b ? { largo: a, ancho: b } : { largo: b, ancho: a };
}

/** "Acrílico ECO · Colores negro · 3 mm" o, con color propio, "… · Colores (rojo) · 3 mm". */
export function materialDeSobrante(g: Pick<GrupoPlancha, "material" | "variante" | "detalle" | "espesorMm">, color: string | null) {
  const tono = color ? `${colorDe(g)} (${color})` : colorDe(g);
  return `${g.material} · ${tono} · ${espesorTexto(g.espesorMm)}`;
}

/** Hasta 1 cm de diferencia es la misma medida: la sierra y la cinta no dan más. */
const TOLERANCIA_CM = 1;

/**
 * Si un sobrante es media o cuarta parte de un formato del grupo. Esos se
 * dejan para el final: una media plancha se vende entera, y cortarla para unas
 * piezas chicas es perder una venta.
 */
export function esEstandar(
  medidas: { largo: number; ancho: number },
  formatos: Pick<FormatoPlancha, "anchoCm" | "largoCm">[],
): boolean {
  const igual = (a: number, b: number) => Math.abs(a - b) <= TOLERANCIA_CM;
  return formatos.some((f) => {
    const W = f.anchoCm;
    const H = f.largoCm;
    const fracciones = [
      [W / 2, H],
      [W, H / 2],
      [W / 2, H / 2],
    ];
    return fracciones.some(([x, y]) => {
      const m = normalizarMedidas(x, y);
      return igual(m.largo, medidas.largo) && igual(m.ancho, medidas.ancho);
    });
  });
}

/** Si una pieza de `a × b` cabe en el sobrante, girándola si hace falta y se puede. */
export function cabeEn(
  s: Pick<Sobrante, "largo" | "ancho">,
  pieza: { a: number; b: number },
  rotable = true,
): boolean {
  const { largo, ancho } = s;
  const derecha = pieza.a <= largo && pieza.b <= ancho;
  if (!rotable) return derecha;
  return derecha || (pieza.b <= largo && pieza.a <= ancho);
}

/**
 * El orden en que el cálculo usa los sobrantes: primero los más chicos (que se
 * acaban de una vez), a igual tamaño el más antiguo, y los estándar al final.
 */
export function ordenDeUso<S extends Pick<Sobrante, "largo" | "ancho" | "estandar" | "creadoEn" | "codigo">>(
  sobrantes: S[],
): S[] {
  return [...sobrantes].sort(
    (a, b) =>
      Number(a.estandar) - Number(b.estandar) ||
      a.largo * a.ancho - b.largo * b.ancho ||
      a.creadoEn.localeCompare(b.creadoEn) ||
      a.codigo.localeCompare(b.codigo),
  );
}

/** Las medidas que se escriben en la búsqueda: "60x80", "60 × 80", "60*80". */
export function leerMedidaBuscada(texto: string): { a: number; b: number } | null {
  const m = /(\d+(?:[.,]\d+)?)\s*[x×*]\s*(\d+(?:[.,]\d+)?)/i.exec(texto);
  if (!m) return null;
  const a = Number(m[1].replace(",", "."));
  const b = Number(m[2].replace(",", "."));
  return a > 0 && b > 0 ? { a, b } : null;
}

/* ── Lo que va a Odoo ──────────────────────────────────────────────────────── */

const sinTildes = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/**
 * El producto Sobrante de un grupo: su código sale de la plancha más chica del
 * grupo (SOB-F7E024), y el nombre va como los de la lista de la empresa.
 */
export function materialOdoo(g: GrupoPlancha): { codigoBase: string; nombre: string } | null {
  const base = g.formatos[0];
  if (!base) return null;
  const partes = [g.material, g.variante, g.detalle, `${String(+g.espesorMm.toFixed(2))}MM`].filter((p) => p.trim());
  return { codigoBase: base.codigo, nombre: sinTildes(`SOBRANTE ${partes.join(" ")}`).toUpperCase() };
}

/** Lo que va en la nota del lote: dónde está y, si hace falta, el color. */
export const notaDeLote = (s: { ubicacion: string | null; color: string | null }) =>
  [s.ubicacion, s.color && `Color: ${s.color}`].filter(Boolean).join(" · ") || null;

/** La nota de vuelta: "Rack 2 · Color: rojo" → ubicación y color. */
export function leerNotaDeLote(nota: string | null): { ubicacion: string | null; color: string | null } {
  if (!nota) return { ubicacion: null, color: null };
  const color = /Color:\s*(.+?)\s*$/.exec(nota)?.[1] ?? null;
  const ubicacion = nota.replace(/\s*·?\s*Color:.*$/, "").trim() || null;
  return { ubicacion, color };
}

