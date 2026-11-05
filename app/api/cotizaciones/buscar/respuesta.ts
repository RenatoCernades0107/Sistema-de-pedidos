/**
 * Lo común de los dos buscadores: quién puede preguntar y cómo se contestan los
 * errores. Un `fetch` que escribe mientras se teclea necesita JSON siempre —un
 * `redirect` al login le devolvería HTML—, así que aquí no se usan las guardas
 * que redirigen.
 */

import { perfilConCotizaciones } from "@/lib/sesion";
import { ErrorOdoo, ODOO_NO_CONFIGURADO, odooConfigurado } from "@/lib/odoo/rpc";

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
