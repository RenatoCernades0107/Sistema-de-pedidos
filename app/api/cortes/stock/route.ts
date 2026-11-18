/**
 * Cuánto hay en Odoo de unas pocas planchas, por su código: el total que se
 * puede prometer y lo que hay en cada almacén.
 *
 * Pocas consultas para todos los códigos: ir a Odoo es lo que más tarda, así
 * que el navegador calcula primero, se queda con los tres mejores formatos y
 * pregunta por los tres de una vez.
 */

import type { NextRequest } from "next/server";
import { cargarAlmacenes } from "@/lib/almacenes-servidor";
import { stockPorAlmacen } from "@/lib/odoo/almacenes";
import { productosPorCodigo } from "@/lib/odoo/catalogos";
import { stockPorCodigo } from "@/lib/odoo/productos";
import { error, errorDeBusqueda, puertaDeBusqueda } from "../../cotizaciones/buscar/respuesta";

/** Los candidatos son tres; con margen para que el formato elegido a mano también entre. */
const MAXIMO = 8;

export interface RespuestaStock {
  /** Por código. `null`: Odoo no lleva el stock de ese producto, o no existe. */
  stock: Record<string, number | null>;
  /** Por código, lo que hay en la mano en cada almacén (por su nombre). */
  porAlmacen: Record<string, Record<string, number>>;
}

export async function GET(request: NextRequest) {
  const cerrada = await puertaDeBusqueda();
  if (cerrada) return cerrada;

  const codigos = [
    ...new Set(
      (request.nextUrl.searchParams.get("codigos") ?? "")
        .split(",")
        .map((c) => c.trim())
        .filter((c) => c && c.length <= 40),
    ),
  ];
  if (codigos.length === 0 || codigos.length > MAXIMO) return error("Faltan los códigos de plancha.", 400);

  try {
    const [encontrado, productos, almacenes] = await Promise.all([
      stockPorCodigo(codigos),
      productosPorCodigo(codigos),
      cargarAlmacenes(),
    ]);
    const conUbicacion = almacenes.filter((a) => a.activo && a.odooUbicacionId);
    const detalle = await stockPorAlmacen(
      [...productos.values()].map((p) => p.id),
      conUbicacion.map((a) => ({ almacenId: a.id, ubicacionId: a.odooUbicacionId! })),
    );
    const nombre = new Map(conUbicacion.map((a) => [a.id, a.nombre]));
    const porAlmacen: RespuestaStock["porAlmacen"] = {};
    for (const [codigo, p] of productos) {
      const s = detalle.get(p.id);
      if (!s) continue;
      porAlmacen[codigo] = Object.fromEntries(
        Object.entries(s.porAlmacen).map(([id, cantidad]) => [nombre.get(id) ?? id, cantidad]),
      );
    }
    const respuesta: RespuestaStock = {
      stock: Object.fromEntries(codigos.map((c) => [c, encontrado.get(c) ?? null])),
      porAlmacen,
    };
    return Response.json(respuesta);
  } catch (e) {
    return errorDeBusqueda(e);
  }
}
