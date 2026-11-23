/**
 * La lista de precios en PDF, para mandar al cliente. La descargan quienes ven
 * los precios del almacén (Administración y Logística).
 *
 * `?diseno=clasico|moderno|compacto`. Lo que entra va en `?seleccion` con un
 * `m=<material>` por material y un `c=<id>` por categoría de accesorios; sin
 * `seleccion`, entra todo.
 */

import type { NextRequest } from "next/server";
import { ROLES } from "@/lib/dominio";
import { hoy } from "@/lib/fecha";
import { armarLista, esDiseno, nombreArchivoLista, type SeleccionLista } from "@/lib/lista-precios";
import { cargarConfigListaPrecios, cargarDatosListaPrecios } from "@/lib/lista-precios-servidor";
import { leerLogo } from "@/lib/logo-servidor";
import { generarPdfListaPrecios } from "@/lib/pdf-lista-precios";
import { bienvenidaPendiente, perfilActual } from "@/lib/sesion";

const texto = (mensaje: string, status: number) =>
  new Response(mensaje, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

export async function GET(request: NextRequest) {
  const perfil = await perfilActual();
  if (!perfil || bienvenidaPendiente(perfil)) return texto("Inicia sesión para descargar la lista de precios.", 401);
  if (!ROLES[perfil.rol].verPrecios) return texto("No tienes permiso para ver los precios.", 403);

  const params = request.nextUrl.searchParams;
  const diseno = params.get("diseno");
  const seleccion: SeleccionLista = params.has("seleccion")
    ? { materiales: params.getAll("m"), categorias: params.getAll("c") }
    : { materiales: null, categorias: null };

  let datos;
  try {
    datos = await cargarDatosListaPrecios();
  } catch (e) {
    console.error("[lista de precios]", e);
    return texto(`No se pudieron leer los precios de Odoo: ${e instanceof Error ? e.message : "error desconocido"}`, 502);
  }

  const fecha = hoy();
  const lista = armarLista(datos, seleccion, await cargarConfigListaPrecios(), fecha);
  if (!lista.secciones.length) return texto("No hay productos con precio en lo que elegiste.", 404);

  const pdf = await generarPdfListaPrecios(lista, esDiseno(diseno) ? diseno : "clasico", await leerLogo());
  return new Response(pdf as Uint8Array<ArrayBuffer>, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(pdf.byteLength),
      "Content-Disposition": `attachment; filename="${nombreArchivoLista(fecha)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
