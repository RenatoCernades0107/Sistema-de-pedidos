/**
 * Buscar materiales de Odoo para anotar lo que se usó en un producto terminado.
 *
 * Es el buscador de productos de las cotizaciones, abierto a quien trabaja el
 * pedido —logística y el taller no cotizan, pero sí dicen qué se usó— y sin lo
 * que ellos no ven: los precios van en cero.
 */

import type { NextRequest } from "next/server";
import { buscarProductos } from "@/lib/odoo/catalogos";
import { ODOO_NO_CONFIGURADO, odooConfigurado } from "@/lib/odoo/rpc";
import type { ProductoOdoo, RespuestaBusqueda } from "@/lib/odoo/tipos";
import { perfilActual } from "@/lib/sesion";
import { consultaDe, error, errorDeBusqueda } from "../../cotizaciones/buscar/respuesta";

export async function GET(request: NextRequest) {
  const perfil = await perfilActual();
  if (!perfil) return error("Tu sesión no puede buscar en Odoo. Recarga la página.", 401);
  if (!odooConfigurado()) return error(ODOO_NO_CONFIGURADO, 503);

  const q = consultaDe(request.nextUrl);
  if (!q) {
    const vacia: RespuestaBusqueda<ProductoOdoo> = { origen: "indice", resultados: [] };
    return Response.json(vacia);
  }

  try {
    const respuesta = await buscarProductos(q, {
      popularidad: () => 0,
      soloCodigoExacto: request.nextUrl.searchParams.get("exacto") === "1",
    });
    return Response.json({
      ...respuesta,
      resultados: respuesta.resultados.map((r) => ({ ...r, item: { ...r.item, precio: 0 } })),
    });
  } catch (e) {
    return errorDeBusqueda(e);
  }
}
