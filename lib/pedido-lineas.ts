/**
 * Las líneas de un pedido —productos y cortes— y cómo va su venta en Odoo, tal
 * como las ve quien trabaja el pedido.
 *
 * Salen de `lineas_de_pedido()` y `odoo_de_pedido()`: a quien no es
 * Administración le llegan sin precios. Sin dependencias de servidor: las leen
 * también los componentes del navegador.
 */

import { leerCorte, planchasNuevas, tituloCorte, totalPiezas, type CorteGuardado } from "./cortes/guardado";
import { leerTerminado, type MaterialUsado, type TerminadoGuardado } from "./terminados/guardado";
import type { ReferenciaDiseno } from "./cad/referencia";
import type { ItemPedido } from "./dominio";

/** Lo que trae `lineas_de_pedidos()` de cada línea y basta para resumirla. */
export interface FilaDeLinea {
  posicion: number;
  tipo: string | null;
  producto_nombre: string | null;
  cantidad: number | null;
  corte: unknown;
  terminado: unknown;
}

/**
 * Una línea como ítem de la lista: un corte se nombra por su modalidad y su
 * material y se cuenta en piezas; un terminado, por su nombre; un producto de
 * Odoo, por el suyo. Si el JSON de un corte o una ficha no se puede leer, la
 * línea no se pierde: queda con el nombre del producto de Odoo.
 */
export function itemDeLinea(f: FilaDeLinea): ItemPedido {
  const nombreOdoo = f.producto_nombre ?? "Producto";
  const unidades = Number(f.cantidad ?? 0) || 0;
  if (f.tipo === "corte") {
    const corte = leerCorte(f.corte);
    return corte
      ? { posicion: f.posicion, clase: "corte", nombre: tituloCorte(corte), cantidad: totalPiezas(corte.piezas) }
      : { posicion: f.posicion, clase: "corte", nombre: nombreOdoo, cantidad: unidades };
  }
  if (f.tipo === "terminado") {
    const ficha = leerTerminado(f.terminado);
    return { posicion: f.posicion, clase: "terminado", nombre: ficha?.nombre ?? nombreOdoo, cantidad: unidades };
  }
  return { posicion: f.posicion, clase: "producto", nombre: nombreOdoo, cantidad: unidades };
}

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

/** Lo que se anotó como usado en cada producto terminado: productos de Odoo y cuánto de cada uno. */
export type MaterialesAnotados = { posicion: number; usados: { productoId: number; cantidad: number }[] }[];

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
