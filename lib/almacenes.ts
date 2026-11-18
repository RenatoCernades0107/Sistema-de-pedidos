/**
 * Los almacenes en el idioma de la pantalla. Sin dependencias de servidor: lo
 * usan también los componentes del navegador.
 *
 * Hay un taller (Católica: corta láser y fabrica los productos terminados), una
 * tienda (Andahuaylas: algunos cortes manuales) y los depósitos que se quieran
 * (Esmeraldas). Cada uno es un almacén de Odoo que la app crea.
 */

import { lugarDeCorte, type LugarCorte } from "./cortes/guardado";
import type { Modalidad } from "./cortes/calcular";

export type TipoAlmacen = "taller" | "tienda" | "deposito";

export const TIPOS_ALMACEN: Record<TipoAlmacen, string> = {
  taller: "Taller",
  tienda: "Tienda",
  deposito: "Depósito",
};

export type SincronizacionAlmacen = "pendiente" | "sincronizada" | "error";

export interface Almacen {
  id: string;
  nombre: string;
  /** El código corto en Odoo: AND, CAT, ESM. */
  codigo: string;
  tipo: TipoAlmacen;
  activo: boolean;
  orden: number;
  odooWarehouseId: number | null;
  odooUbicacionId: number | null;
  sincronizacion: SincronizacionAlmacen;
  errorSincronizacion: string | null;
}

/** El almacén de un lugar de producción: el taller o la tienda. */
export const almacenDeLugar = <A extends Pick<Almacen, "tipo">>(almacenes: A[], lugar: LugarCorte): A | null =>
  almacenes.find((a) => a.tipo === lugar) ?? null;

/** Lo mínimo de una línea para saber dónde se produce. */
export interface LineaParaAlmacen {
  corte?: { modalidad: Modalidad; lugar?: LugarCorte | null } | null;
  terminado?: unknown | null;
}

/** Dónde se produce una línea: un producto terminado, en el taller; un corte, donde diga. `null`: no se produce. */
export function lugarDeLinea(l: LineaParaAlmacen): LugarCorte | null {
  if (l.terminado) return "taller";
  if (l.corte) return lugarDeCorte(l.corte);
  return null;
}

/**
 * De qué almacén sale la venta. Si algo se produce en el taller (un láser, un
 * producto terminado, un manual en el taller), todo sale del taller: el pedido
 * se arma allí. Si no, de la tienda. Se puede cambiar en la cotización.
 */
export function tipoDeDespacho(lineas: LineaParaAlmacen[]): LugarCorte {
  return lineas.some((l) => lugarDeLinea(l) === "taller") ? "taller" : "tienda";
}

/** El código corto de un almacén nuevo: hasta 5 letras o números, en mayúsculas. */
export const CODIGO_ALMACEN = /^[A-Z0-9]{1,5}$/;
