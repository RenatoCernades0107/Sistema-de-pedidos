/**
 * Qué material necesita un pedido, en qué almacén, y qué le falta.
 *
 * Cada línea pide material en un lugar:
 *   - un corte, sus planchas nuevas donde se corta (el láser y el manual en el
 *     taller, en el taller; el manual en tienda, en la tienda). Los sobrantes que
 *     usa ya son de ese almacén;
 *   - un producto terminado, su material estimado (planchas y accesorios) en el
 *     taller, que es donde se fabrica;
 *   - una plancha suelta o un accesorio, su cantidad en el almacén de despacho:
 *     es de donde sale la venta.
 *
 * Lo que falta se compara con el stock libre de Odoo (lo que no está reservado
 * por otro pedido), y para cada faltante se sugiere de dónde traerlo. Una venta
 * sale de un solo almacén (el taller o la tienda; un depósito no despacha): si
 * lo suelto está repartido, se elige el que más cubre y el resto se trae.
 *
 * Sin dependencias de servidor: lo usan también la cotización y sus pruebas.
 */

import { almacenDeLugar, tipoDeDespacho, type Almacen } from "./almacenes";
import { lugarDeCorte, type CorteGuardado } from "./cortes/guardado";
import { planchasCalculadas } from "./pedido-lineas";
import type { TerminadoGuardado } from "./terminados/guardado";

export type MotivoFaltante = "corte" | "terminado" | "despacho";

export const MOTIVOS_FALTANTE: Record<MotivoFaltante, string> = {
  corte: "para cortar",
  terminado: "para fabricar",
  despacho: "para despachar",
};

/** Lo mínimo de una línea (de cotización o de pedido) para saber qué material pide. */
export interface LineaConMaterial {
  productoId: number;
  codigo: string | null;
  nombre: string;
  cantidad: number;
  corte: CorteGuardado | null;
  terminado: Pick<TerminadoGuardado, "materiales"> | null;
}

export interface Necesidad {
  productoId: number;
  codigo: string | null;
  nombre: string;
  cantidad: number;
  /** El almacén donde hace falta. */
  almacenId: string;
  motivo: MotivoFaltante;
}

/** El stock libre de cada producto, por almacén de la app. */
export type StockLibre = Map<number, Record<string, number>>;

type AlmacenMinimo = Pick<Almacen, "id" | "nombre" | "tipo" | "activo" | "orden">;

const redondear = (n: number) => Math.round(n * 100) / 100;

/** Lo que es "suelto": ni corte ni producto terminado. Se despacha tal cual. */
const esSuelta = (l: LineaConMaterial) => !l.corte && !l.terminado;

/**
 * Lo que necesita cada línea y dónde. `almacenables` son los productos que
 * llevan stock (las planchas y accesorios del catálogo): una línea suelta de
 * otra cosa (un servicio, "Corte a medida") no pide material. Si un almacén
 * (el taller o la tienda) no existe, lo que va ahí no se cuenta.
 */
export function necesidadesDeLineas(
  lineas: LineaConMaterial[],
  despachoId: string,
  almacenes: AlmacenMinimo[],
  almacenables: Set<number>,
): Necesidad[] {
  const activos = almacenes.filter((a) => a.activo);
  const porClave = new Map<string, Necesidad>();
  const sumar = (n: Necesidad) => {
    if (!(n.cantidad > 0)) return;
    const clave = `${n.productoId}|${n.almacenId}`;
    const previa = porClave.get(clave);
    if (previa) previa.cantidad = redondear(previa.cantidad + n.cantidad);
    else porClave.set(clave, { ...n, cantidad: redondear(n.cantidad) });
  };

  for (const l of lineas) {
    if (l.corte) {
      const donde = almacenDeLugar(activos, lugarDeCorte(l.corte));
      if (!donde) continue;
      sumar({
        productoId: l.productoId,
        codigo: l.codigo,
        nombre: l.nombre,
        cantidad: planchasCalculadas(l),
        almacenId: donde.id,
        motivo: "corte",
      });
    } else if (l.terminado) {
      const taller = almacenDeLugar(activos, "taller");
      if (!taller) continue;
      for (const m of l.terminado.materiales) {
        sumar({ productoId: m.productoId, codigo: m.codigo, nombre: m.nombre, cantidad: m.cantidad, almacenId: taller.id, motivo: "terminado" });
      }
    } else if (almacenables.has(l.productoId)) {
      sumar({ productoId: l.productoId, codigo: l.codigo, nombre: l.nombre, cantidad: l.cantidad, almacenId: despachoId, motivo: "despacho" });
    }
  }
  return [...porClave.values()];
}

export interface Faltante extends Necesidad {
  /** Cuánto falta en ese almacén (no cuánto pide el pedido). */
  falta: number;
  /** Lo que hay libre allí. */
  hay: number;
  /** De dónde traerlo. `null`: no hay en ningún otro almacén, hay que comprar. */
  origenSugeridoId: string | null;
  /** Lo que hay libre en el origen sugerido. */
  hayEnOrigen: number;
}

/**
 * El orden en que se busca de dónde traer algo: primero el otro de los dos que
 * trabajan (la tienda para el taller, el taller para la tienda), después los
 * depósitos en su orden.
 */
function ordenDeOrigen(destinoId: string, almacenes: AlmacenMinimo[]): AlmacenMinimo[] {
  const peso = (a: AlmacenMinimo) => (a.tipo === "deposito" ? 1 : 0);
  return almacenes
    .filter((a) => a.activo && a.id !== destinoId)
    .sort((a, b) => peso(a) - peso(b) || a.orden - b.orden || a.nombre.localeCompare(b.nombre));
}

/**
 * Lo que no alcanza, y de dónde traerlo: el primero (en `ordenDeOrigen`) que
 * tiene libre lo que falta; si ninguno lo tiene completo, el que más tiene.
 * Lo que dos necesidades piden del mismo producto en otro almacén no se cuenta
 * dos veces: el origen sugerido se va "gastando".
 */
export function faltantesDe(necesidades: Necesidad[], stock: StockLibre, almacenes: AlmacenMinimo[]): Faltante[] {
  const disponible = new Map<number, Record<string, number>>();
  const libre = (productoId: number) => {
    let d = disponible.get(productoId);
    if (!d) {
      d = { ...(stock.get(productoId) ?? {}) };
      disponible.set(productoId, d);
    }
    return d;
  };

  // Primero cada necesidad toma lo suyo de su almacén; recién después se reparte lo que sobra.
  const conHay = necesidades.map((n) => {
    const d = libre(n.productoId);
    const hay = Math.max(0, d[n.almacenId] ?? 0);
    d[n.almacenId] = Math.max(0, hay - n.cantidad);
    return { n, hay };
  });

  const salida: Faltante[] = [];
  for (const { n, hay } of conHay) {
    const falta = redondear(n.cantidad - hay);
    if (falta <= 0) continue;
    const d = libre(n.productoId);
    const candidatos = ordenDeOrigen(n.almacenId, almacenes).map((a) => ({ a, tiene: Math.max(0, d[a.id] ?? 0) }));
    const completo = candidatos.find((c) => c.tiene >= falta);
    const mayor = candidatos.filter((c) => c.tiene > 0).sort((x, y) => y.tiene - x.tiene)[0];
    const origen = completo ?? mayor ?? null;
    if (origen) d[origen.a.id] = Math.max(0, origen.tiene - falta);
    salida.push({
      ...n,
      falta,
      hay: redondear(hay),
      origenSugeridoId: origen?.a.id ?? null,
      hayEnOrigen: redondear(origen?.tiene ?? 0),
    });
  }
  return salida;
}

/**
 * De qué almacén sale la venta. Si algo se produce en el taller, del taller: el
 * pedido se arma allí. Si no, el que cubre todo lo suelto (la tienda primero);
 * si ninguno lo cubre todo, el que cubre más unidades (a igualdad, la tienda).
 * Un depósito nunca despacha. Sin taller ni tienda, `null`.
 */
export function elegirDespacho(
  lineas: LineaConMaterial[],
  stock: StockLibre,
  almacenes: AlmacenMinimo[],
  almacenables: Set<number>,
): AlmacenMinimo | null {
  const activos = almacenes.filter((a) => a.activo);
  const tienda = almacenDeLugar(activos, "tienda");
  const taller = almacenDeLugar(activos, "taller");
  if (tipoDeDespacho(lineas) === "taller") return taller ?? tienda;
  const candidatos = [tienda, taller].filter((a): a is AlmacenMinimo => !!a);
  if (candidatos.length <= 1) return candidatos[0] ?? null;

  const sueltas = new Map<number, number>();
  for (const l of lineas.filter(esSuelta)) {
    if (!almacenables.has(l.productoId)) continue;
    sueltas.set(l.productoId, (sueltas.get(l.productoId) ?? 0) + l.cantidad);
  }
  const cubre = (a: AlmacenMinimo) => {
    let unidades = 0;
    let todo = true;
    for (const [id, cantidad] of sueltas) {
      const hay = Math.max(0, stock.get(id)?.[a.id] ?? 0);
      unidades += Math.min(hay, cantidad);
      if (hay < cantidad) todo = false;
    }
    return { a, unidades, todo };
  };
  const evaluados = candidatos.map(cubre);
  const completo = evaluados.find((e) => e.todo);
  if (completo) return completo.a;
  // `sort` es estable: a igualdad queda la tienda, que va primero.
  return [...evaluados].sort((x, y) => y.unidades - x.unidades)[0].a;
}

/** Los productos de unas líneas cuyo stock hay que mirar. */
export function productosDeLineas(lineas: LineaConMaterial[]): number[] {
  const ids = new Set<number>();
  for (const l of lineas) {
    if (l.terminado) for (const m of l.terminado.materiales) ids.add(m.productoId);
    else ids.add(l.productoId);
  }
  return [...ids].filter((id) => id > 0);
}

/* ── Lo guardado ───────────────────────────────────────────────────────────── */

export type EstadoFaltante = "pendiente" | "en_camino" | "resuelto" | "descartado";

export interface FaltanteGuardado {
  id: string;
  pedidoId: string;
  pedidoCodigo: string;
  productoId: number;
  codigo: string | null;
  nombre: string;
  cantidad: number;
  almacenId: string;
  motivo: MotivoFaltante;
  origenSugeridoId: string | null;
  estado: EstadoFaltante;
  transferenciaId: string | null;
  transferenciaCodigo: string | null;
  creadoEn: string;
}
