/**
 * Buscar productos de Odoo mientras se escribe. El código manda: la referencia
 * interna y el código de barras se comparan sin espacios ni guiones, y un código
 * exacto sale primero.
 *
 * `?q=` vacío devuelve los más cotizados de los últimos 90 días.
 * `?exacto=1` devuelve solo coincidencias exactas de código: es lo que pide el
 * formulario cuando se da Enter antes de que llegue la búsqueda normal, que es
 * lo que hace un lector de código de barras.
 */

import type { NextRequest } from "next/server";
import { buscarProductos, productosPorId } from "@/lib/odoo/catalogos";
import { popularidadProductos } from "@/lib/cotizaciones-servidor";
import type { ProductoOdoo, RespuestaBusqueda } from "@/lib/odoo/tipos";
import { consultaDe, errorDeBusqueda, puertaDeBusqueda } from "../respuesta";

const SUGERIDOS = 8;

export async function GET(request: NextRequest) {
  const cerrada = await puertaDeBusqueda();
  if (cerrada) return cerrada;

  const q = consultaDe(request.nextUrl);
  const soloCodigoExacto = request.nextUrl.searchParams.get("exacto") === "1";

  try {
    const popularidad = await popularidadProductos();

    if (!q) {
      const ids = [...popularidad.keys()].slice(0, SUGERIDOS);
      const productos = await productosPorId(ids);
      const respuesta: RespuestaBusqueda<ProductoOdoo> = {
        origen: "recientes",
        resultados: ids
          .map((id) => productos.get(id))
          .filter((p): p is ProductoOdoo => !!p)
          .map((item) => ({ item, porCodigo: null, veces: popularidad.get(item.id) ?? 0 })),
      };
      return Response.json(respuesta);
    }

    const respuesta = await buscarProductos(q, {
      popularidad: (id) => popularidad.get(id) ?? 0,
      soloCodigoExacto,
    });
    return Response.json(respuesta);
  } catch (e) {
    return errorDeBusqueda(e);
  }
}
