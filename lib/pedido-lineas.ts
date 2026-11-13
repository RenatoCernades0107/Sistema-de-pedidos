/**
 * Las líneas de un pedido —productos y cortes— y cómo va su venta en Odoo, tal
 * como las ve quien trabaja el pedido.
 *
 * Salen de `lineas_de_pedido()` y `odoo_de_pedido()`: a quien no es
 * Administración le llegan sin precios. Sin dependencias de servidor: las leen
 * también los componentes del navegador.
 */

import { planchasNuevas, type CorteGuardado } from "./cortes/guardado";
import type { MaterialUsado, TerminadoGuardado } from "./terminados/guardado";
import type { ReferenciaDiseno } from "./cad/referencia";

export interface LineaDePedido {
  posicion: number;
  productoId: number;
  nombre: string;
  codigo: string | null;
  descripcion: string | null;
  /** Lo que el taller tiene que saber de esta línea (acabados, pegado…). */
  indicaciones?: string | null;
  /** En un corte, cuántas planchas se calcularon. */
  cantidad: number;
  corte: CorteGuardado | null;
  /** Lo que el taller anotó que usó de verdad. `null`: nadie lo dijo todavía. */
  planchasUsadas: number | null;
  /** Si la línea es un producto terminado, su ficha (sin precios para quien no es Administración). */
  terminado: TerminadoGuardado | null;
  /** Lo que logística anotó que se usó en el producto terminado. `null`: nadie lo dijo todavía. */
  materialesUsados: MaterialUsado[] | null;
  /** Si la línea sale de un diseño CAD: cuál y qué versión se cotizó. */
  diseno?: ReferenciaDiseno | null;
  /** Solo para Administración; `null` para los demás. */
  importe: number | null;
  /** Con el piloto de sobrantes: la orden de fabricación del corte en Odoo. */
  produccionId: number | null;
  produccionNombre: string | null;
  produccionCerrada: boolean;
}

export interface OdooDePedido {
  cotizacionId: string;
  orderId: number | null;
  orderName: string | null;
  enOdoo: boolean;
  confirmada: boolean;
  stockDescontado: boolean;
  errorStock: string | null;
  anuladaEnOdoo: boolean;
  errorAnulacion: string | null;
}

/**
 * Las planchas que el cálculo abre. Con el piloto de sobrantes, solo las nuevas:
 * las piezas del almacén que usa el corte no son planchas que descontar.
 */
export const planchasCalculadas = (l: Pick<LineaDePedido, "cantidad" | "corte">) =>
  l.corte?.sobrantes ? planchasNuevas(l.corte) : l.cantidad;

/** Las planchas que se descuentan de un corte: las anotadas o, si no, las calculadas. */
export const planchasDe = (l: Pick<LineaDePedido, "cantidad" | "planchasUsadas" | "corte">) =>
  l.planchasUsadas ?? planchasCalculadas(l);

/** El tope de una cantidad de planchas anotada; el mismo que pone la base. */
export const PLANCHAS_MAXIMAS = 9999;

/** Media y cuarto de plancha existen; más decimales que la columna (`numeric(8,2)`), no. */
export const hastaDosDecimales = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;

/**
 * Lo que sale del almacén por producto de Odoo. Un producto puede estar en
 * varias líneas (la misma plancha en dos cortes): se suman.
 */
export function cantidadesParaDescontar(lineas: LineaDePedido[]): Map<number, number> {
  const salida = new Map<number, number>();
  for (const l of lineas) {
    const cuanto = l.corte ? planchasDe(l) : l.cantidad;
    salida.set(l.productoId, (salida.get(l.productoId) ?? 0) + cuanto);
  }
  return salida;
}
