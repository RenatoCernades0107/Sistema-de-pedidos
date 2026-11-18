/**
 * El kárdex: la historia de un producto en cada almacén, a partir de los
 * movimientos hechos en Odoo (que es el que manda: también trae lo que alguien
 * hizo directo allá).
 *
 * Cada movimiento se nombra por su origen: lo que hizo la app lleva su código
 * (`App Plexiacril ING-00001`, `TRF-…`, `CAS-…`), una entrega lleva el nombre de
 * la venta y una orden de fabricación, el de la cotización. El saldo se calcula
 * hacia atrás desde el stock de hoy, así cuadra con la tabla del almacén.
 *
 * Sin dependencias de servidor.
 */

import type { MovimientoOdoo } from "./odoo/almacenes";

export type TipoMovimiento = "compra" | "ajuste" | "transferencia" | "baja" | "conteo" | "venta" | "produccion" | "odoo";

export const TIPOS_MOVIMIENTO: Record<TipoMovimiento, string> = {
  compra: "Compra",
  ajuste: "Ajuste",
  transferencia: "Transferencia",
  baja: "Baja",
  conteo: "Ajuste de conteo",
  venta: "Venta",
  produccion: "Producción",
  odoo: "Odoo",
};

/** Lo que la app sabe de los códigos que aparecen en los orígenes. */
export interface Referencias {
  /** ING-00001 → compra o ajuste. */
  ingresos: Map<string, "compra" | "ajuste">;
  /** CAS-00001 → baja o diferencia. */
  casos: Map<string, "baja" | "diferencia">;
  /** El nombre de la venta en Odoo (S00042) → el código del pedido. */
  pedidoDeVenta: Map<string, string>;
  /** El id de la cotización → el código del pedido. */
  pedidoDeCotizacion: Map<string, string>;
}

export interface FilaKardex {
  /** Único: el movimiento y el almacén (uno entre dos almacenes da dos filas). */
  clave: string;
  fecha: string;
  almacenId: string;
  tipo: TipoMovimiento;
  /** "Compra ING-00004", "Venta · P2611-003", "Baja en Odoo · SP/00012". */
  detalle: string;
  /** A dónde lleva: el pedido, o la pestaña del almacén donde está el documento. */
  enlace: string | null;
  entra: number;
  sale: number;
  /** Lo que quedó en ese almacén después del movimiento. */
  saldo: number;
}

const DE_LA_APP = /App Plexiacril ((ING|TRF|CAS)-\d+)/;
const DE_COTIZACION = /App Plexiacril ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

/** Qué fue un movimiento, en palabras, y a dónde lleva. */
export function clasificar(m: MovimientoOdoo, refs: Referencias): Pick<FilaKardex, "tipo" | "detalle" | "enlace"> {
  const app = (m.origen ?? "").match(DE_LA_APP);
  if (app) {
    const [, codigo, serie] = app;
    if (serie === "ING") {
      // Quien no ve los ingresos (el taller) solo ve el código.
      const tipo = refs.ingresos.get(codigo);
      return {
        tipo: tipo ?? "ajuste",
        detalle: `${tipo === "compra" ? "Compra" : tipo === "ajuste" ? "Ajuste" : "Ingreso"} ${codigo}`,
        enlace: "/almacen?vista=movimientos",
      };
    }
    if (serie === "TRF") return { tipo: "transferencia", detalle: `Transferencia ${codigo}`, enlace: "/almacen?vista=movimientos" };
    const caso = refs.casos.get(codigo);
    if (caso === "diferencia") return { tipo: "conteo", detalle: `Ajuste de conteo ${codigo}`, enlace: "/almacen?vista=casos" };
    if (caso === "baja" || m.baja) return { tipo: "baja", detalle: `Baja ${codigo}`, enlace: "/almacen?vista=casos" };
    return { tipo: "conteo", detalle: `Caso ${codigo}`, enlace: "/almacen?vista=casos" };
  }
  const cotizacion = (m.origenProduccion ?? "").match(DE_COTIZACION)?.[1];
  if (cotizacion) {
    const pedido = refs.pedidoDeCotizacion.get(cotizacion);
    return {
      tipo: "produccion",
      detalle: pedido ? `Producción · ${pedido}` : `Producción · ${m.referencia ?? "orden"}`,
      enlace: pedido ? `/pedidos/${pedido}` : null,
    };
  }
  const venta = m.origen ? refs.pedidoDeVenta.get(m.origen) : undefined;
  if (venta) return { tipo: "venta", detalle: `Venta · ${venta}`, enlace: `/pedidos/${venta}` };
  if (m.baja) return { tipo: "baja", detalle: `Baja en Odoo${m.referencia ? ` · ${m.referencia}` : ""}`, enlace: null };
  if (m.inventario) return { tipo: "ajuste", detalle: "Ajuste en Odoo", enlace: null };
  return { tipo: "odoo", detalle: [m.referencia, m.origen].filter(Boolean).join(" · ") || "Movimiento en Odoo", enlace: null };
}

const redondear = (n: number) => Math.round(n * 1e4) / 1e4;

/**
 * Las filas del kárdex, de la más nueva a la más vieja. `almacenDeUbicacion`
 * dice de qué almacén es cada ubicación de Odoo; un movimiento entre dos de
 * ellos sale en los dos. `saldoHoy` es lo que hay hoy en cada almacén.
 */
export function filasDeKardex(
  movimientos: MovimientoOdoo[],
  almacenDeUbicacion: Map<number, string>,
  saldoHoy: Record<string, number>,
  refs: Referencias,
): FilaKardex[] {
  const ordenados = [...movimientos].sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id);
  const saldo = { ...saldoHoy };
  const filas: FilaKardex[] = [];
  for (const m of ordenados) {
    const desde = m.desde !== null ? almacenDeUbicacion.get(m.desde) : undefined;
    const hacia = m.hacia !== null ? almacenDeUbicacion.get(m.hacia) : undefined;
    if (desde === hacia) continue; // Dentro del mismo almacén (de un estante a otro): no cambia nada.
    const c = clasificar(m, refs);
    for (const [almacenId, entra, sale] of [
      [hacia, m.cantidad, 0],
      [desde, 0, m.cantidad],
    ] as const) {
      if (!almacenId) continue;
      const despues = saldo[almacenId] ?? 0;
      filas.push({ clave: `${m.id}|${almacenId}`, fecha: m.fecha, almacenId, ...c, entra, sale, saldo: redondear(despues) });
      saldo[almacenId] = redondear(despues - entra + sale);
    }
  }
  return filas;
}
