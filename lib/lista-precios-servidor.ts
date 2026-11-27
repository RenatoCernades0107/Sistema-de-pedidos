/**
 * Lo que necesita la lista de precios del lado del servidor: las planchas y los
 * accesorios con su precio de Odoo (sin el stock, que aquí no hace falta) y la
 * configuración que escribió Administración.
 */

import { cache } from "react";
import { cargarCatalogoPlanchas } from "./cortes-servidor";
import type { GrupoPlancha } from "./cortes/catalogo";
import { filasDePlanchas } from "./inventario";
import { leerConfigListaPrecios, type ConfigListaPrecios } from "./lista-precios-config";
import type { AccesorioParaLista, PlanchaParaLista } from "./lista-precios";
import { productosPorCodigo } from "./odoo/catalogos";
import { ODOO_NO_CONFIGURADO, odooConfigurado } from "./odoo/rpc";
import { cargarAccesorios, cargarCategorias } from "./stock-servidor";
import { clienteServidor } from "./supabase-servidor";

/** Por la función de ventanilla: la lee Administración y Logística. */
export const cargarConfigListaPrecios = cache(async (): Promise<ConfigListaPrecios> => {
  const supabase = await clienteServidor();
  const { data } = await supabase.rpc("config_lista_precios");
  return leerConfigListaPrecios(data);
});

export interface DatosListaPrecios {
  planchas: PlanchaParaLista[];
  accesorios: AccesorioParaLista[];
  categorias: { id: string; nombre: string; orden: number }[];
}

/** Las planchas y los accesorios activos con su precio de venta de Odoo. Lanza si Odoo no responde. */
export async function cargarDatosListaPrecios(): Promise<DatosListaPrecios> {
  if (!odooConfigurado()) throw new Error(ODOO_NO_CONFIGURADO);
  const [catalogo, accesorios, categorias] = await Promise.all([
    cargarCatalogoPlanchas(true),
    cargarAccesorios(),
    cargarCategorias(),
  ]);
  return armarDatosListaPrecios(catalogo, accesorios, categorias);
}

/**
 * La lista a partir del catálogo ya leído (con sesión, o por `wa_catalogo` en el
 * webhook de WhatsApp), con los precios de Odoo. Lanza si Odoo no responde.
 */
export async function armarDatosListaPrecios(
  catalogo: GrupoPlancha[],
  accesorios: { codigo_odoo: string; categoria_id: string; activo: boolean }[],
  categorias: { id: string; nombre: string; orden: number }[],
): Promise<DatosListaPrecios> {
  if (!odooConfigurado()) throw new Error(ODOO_NO_CONFIGURADO);
  const codigoDeFormato = new Map(catalogo.flatMap((g) => g.formatos.map((f) => [f.id, f.codigo] as const)));
  const productos = await productosPorCodigo([
    ...codigoDeFormato.values(),
    ...accesorios.map((a) => a.codigo_odoo),
  ]);

  return {
    planchas: filasDePlanchas(catalogo).map((f) => {
      const codigo = codigoDeFormato.get(f.formatoId)!;
      return { ...f, codigo, precio: productos.get(codigo)?.precio ?? null };
    }),
    accesorios: accesorios.map((a) => {
      const p = productos.get(a.codigo_odoo);
      return {
        categoriaId: a.categoria_id,
        nombre: p?.nombre ?? a.codigo_odoo,
        codigo: a.codigo_odoo,
        precio: p?.precio ?? null,
        activo: a.activo && !!p,
      };
    }),
    categorias: categorias.map((c) => ({ id: c.id, nombre: c.nombre, orden: c.orden })),
  };
}
