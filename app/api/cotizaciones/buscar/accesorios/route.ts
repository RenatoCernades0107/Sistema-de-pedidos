/**
 * Las categorías de accesorios del Almacén con los códigos de los suyos, para
 * "Buscar accesorio". Solo códigos: el nombre y el precio se piden después a la
 * ruta de productos de cada pantalla, que sabe si quien busca ve precios.
 */

import { categoriasConAccesorios, type RespuestaAccesorios } from "@/lib/accesorios-busqueda";
import { perfilActual } from "@/lib/sesion";
import { cargarAccesorios, cargarCategorias } from "@/lib/stock-servidor";
import { error } from "../respuesta";

export async function GET() {
  const perfil = await perfilActual();
  if (!perfil) return error("Tu sesión no puede buscar accesorios. Recarga la página.", 401);

  try {
    const [categorias, accesorios] = await Promise.all([cargarCategorias(), cargarAccesorios()]);
    const respuesta: RespuestaAccesorios = { categorias: categoriasConAccesorios(categorias, accesorios) };
    return Response.json(respuesta);
  } catch (e) {
    console.error("[accesorios] categorías", e);
    return error("No se pudieron leer los accesorios. Intenta de nuevo.", 500);
  }
}
