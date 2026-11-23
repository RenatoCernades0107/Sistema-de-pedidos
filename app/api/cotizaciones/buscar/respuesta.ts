/**
 * Lo común de los dos buscadores: quién puede preguntar y cómo se contestan los
 * errores. Un `fetch` que escribe mientras se teclea necesita JSON siempre —un
 * `redirect` al login le devolvería HTML—, así que aquí no se usan las guardas
 * que redirigen.
 */

import { perfilConCotizaciones } from "@/lib/sesion";
import { productosPorCodigo } from "@/lib/odoo/catalogos";
import { ErrorOdoo, ODOO_NO_CONFIGURADO, odooConfigurado } from "@/lib/odoo/rpc";
import type { ProductoOdoo, RespuestaBusqueda } from "@/lib/odoo/tipos";

export function error(mensaje: string, status: number) {
  return Response.json({ error: mensaje }, { status });
}

/** `null` si puede buscar; si no, la respuesta que hay que devolver. */
export async function puertaDeBusqueda(): Promise<Response | null> {
  const perfil = await perfilConCotizaciones();
  if (!perfil) return error("Tu sesión no puede buscar en Odoo. Recarga la página.", 401);
  if (!odooConfigurado()) return error(ODOO_NO_CONFIGURADO, 503);
  return null;
}

export function errorDeBusqueda(e: unknown) {
  if (e instanceof ErrorOdoo) return error(e.message, 502);
  console.error("[cotizaciones] búsqueda", e);
  return error("La búsqueda falló. Intenta de nuevo.", 500);
}

/** La consulta, recortada: nadie busca con 200 caracteres. */
export const consultaDe = (url: URL) => (url.searchParams.get("q") ?? "").slice(0, 120).trim();

/** Más que esto no lo pide ningún paso (una categoría de accesorios es la más larga). */
const MAXIMO_CODIGOS = 200;

/**
 * Los códigos de `?codigos=A,B,C`, sin repetir y en su orden, o `null` si no
 * vinieron. Es lo que piden "Buscar plancha" (los formatos de un grupo) y
 * "Buscar accesorio" (los de una categoría).
 */
export function codigosDe(url: URL): string[] | null {
  const crudo = url.searchParams.get("codigos");
  if (crudo === null) return null;
  return [
    ...new Set(
      crudo
        .split(",")
        .map((c) => c.trim())
        .filter((c) => c && c.length <= 40),
    ),
  ].slice(0, MAXIMO_CODIGOS);
}

/** Los productos de esos códigos, como una respuesta del buscador y en el mismo orden. */
export async function respuestaPorCodigos(codigos: string[]): Promise<RespuestaBusqueda<ProductoOdoo>> {
  const productos = await productosPorCodigo(codigos);
  return {
    origen: "indice",
    resultados: codigos
      .map((c) => productos.get(c))
      .filter((p): p is ProductoOdoo => !!p)
      .map((item) => ({ item, porCodigo: null })),
  };
}
