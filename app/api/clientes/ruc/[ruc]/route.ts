/**
 * Datos de un cliente a partir de su RUC (openruc.com / SUNAT), para autocompletar
 * el formulario de "Nuevo cliente". Siempre JSON, también en los errores.
 */

import type { NextRequest } from "next/server";
import { perfilConCotizaciones } from "@/lib/sesion";
import { rucValido, soloDigitos } from "@/lib/busqueda-inteligente";
import { consultarRuc, ErrorRuc } from "@/lib/ruc";

const error = (mensaje: string, status: number) => Response.json({ error: mensaje }, { status });

export async function GET(_request: NextRequest, { params }: { params: Promise<{ ruc: string }> }) {
  if (!(await perfilConCotizaciones())) return error("Tu sesión no puede consultar RUC. Recarga la página.", 401);

  const ruc = soloDigitos((await params).ruc);
  if (ruc.length !== 11 || !rucValido(ruc)) return error("Ese RUC no es válido: revisa los dígitos.", 400);

  try {
    return Response.json(await consultarRuc(ruc));
  } catch (e) {
    if (e instanceof ErrorRuc) return error(e.message, e.status);
    console.error("[ruc] consulta", e);
    return error("La consulta de RUC falló. Completa los datos a mano.", 500);
  }
}
