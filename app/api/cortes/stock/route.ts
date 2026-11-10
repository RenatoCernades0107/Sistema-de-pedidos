/**
 * Cuánto hay en Odoo de unas pocas planchas, por su código.
 *
 * Una sola consulta para todos los códigos: ir a Odoo es lo que más tarda, así
 * que el navegador calcula primero, se queda con los tres mejores formatos y
 * pregunta por los tres de una vez.
 */

import type { NextRequest } from "next/server";
import { stockPorCodigo } from "@/lib/odoo/productos";
import { error, errorDeBusqueda, puertaDeBusqueda } from "../../cotizaciones/buscar/respuesta";

/** Los candidatos son tres; con margen para que el formato elegido a mano también entre. */
const MAXIMO = 8;

export interface RespuestaStock {
  /** Por código. `null`: Odoo no lleva el stock de ese producto, o no existe. */
  stock: Record<string, number | null>;
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
    const encontrado = await stockPorCodigo(codigos);
    const respuesta: RespuestaStock = {
      stock: Object.fromEntries(codigos.map((c) => [c, encontrado.get(c) ?? null])),
    };
    return Response.json(respuesta);
  } catch (e) {
    return errorDeBusqueda(e);
  }
}
