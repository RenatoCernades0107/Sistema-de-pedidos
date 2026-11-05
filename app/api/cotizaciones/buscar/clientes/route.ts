/**
 * Buscar clientes de Odoo mientras se escribe.
 *
 * `?q=` vacío devuelve los últimos clientes cotizados: al enfocar el buscador ya
 * está el que vuelve cada semana. Con texto, busca en el índice del servidor
 * (nombre, RUC/DNI, teléfono, correo, sin tildes y con errores de tipeo) y, si
 * no hay nada, le pregunta a Odoo en vivo.
 */

import type { NextRequest } from "next/server";
import { buscarClientes, indiceClientes } from "@/lib/odoo/catalogos";
import { clientesRecientes, popularidadClientes } from "@/lib/cotizaciones-servidor";
import type { ClienteOdoo, RespuestaBusqueda } from "@/lib/odoo/tipos";
import { consultaDe, errorDeBusqueda, puertaDeBusqueda } from "../respuesta";

export async function GET(request: NextRequest) {
  const cerrada = await puertaDeBusqueda();
  if (cerrada) return cerrada;

  const q = consultaDe(request.nextUrl);
  try {
    if (!q) {
      const recientes = await clientesRecientes();
      const respuesta: RespuestaBusqueda<ClienteOdoo> = {
        origen: "recientes",
        // La foto guardada en la cotización, completada con el índice si ya lo tiene.
        resultados: recientes.map(({ cliente, veces }) => ({
          item: indiceClientes().obtener(cliente.id) ?? cliente,
          porCodigo: null,
          veces,
        })),
      };
      return Response.json(respuesta);
    }

    const popularidad = await popularidadClientes();
    const respuesta = await buscarClientes(q, (id) => popularidad.get(id) ?? 0);
    return Response.json(respuesta);
  } catch (e) {
    return errorDeBusqueda(e);
  }
}
