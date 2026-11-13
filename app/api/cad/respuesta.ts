/**
 * Lo común de los cuatro proxies de `/api/cad`: quién puede llamar, cómo se lee
 * el cuerpo y cómo se contestan los errores.
 *
 * El navegador nunca habla con el motor CAD: pasa por aquí, que comprueba la
 * sesión y pone la clave. Como quien llama es un `fetch`, la respuesta es JSON
 * siempre — un `redirect` al login le devolvería HTML —, así que no se usan las
 * guardas que redirigen.
 */

import { z } from "zod";
import { ErrorMotorCad, type ErrorCampoCad } from "@/lib/cad/motor";
import { perfilConCad } from "@/lib/sesion";

/** Lo que recibe el navegador cuando algo falla. */
export interface ErrorCad {
  error: string;
  codigo?: string;
  errores?: ErrorCampoCad[];
}

export function error(mensaje: string, status: number, extra?: Omit<ErrorCad, "error">) {
  return Response.json({ error: mensaje, ...extra } satisfies ErrorCad, { status });
}

/** `null` si puede usar el motor; si no, la respuesta que hay que devolver. */
export async function puertaCad(): Promise<Response | null> {
  const perfil = await perfilConCad();
  if (!perfil) return error("Tu sesión no puede usar la herramienta de diseños. Recarga la página.", 401);
  return null;
}

/**
 * Un error del motor conserva su estado cuando es culpa de lo que se pidió (404,
 * 422): el formulario pinta los `errores` por campo. Lo demás —clave mal puesta,
 * motor caído, geometría rota— es un 502 o 503: falló algo detrás de nosotros.
 */
export function errorDeMotor(e: unknown) {
  if (e instanceof ErrorMotorCad) {
    const estado = e.estado === 404 || e.estado === 422 || e.estado === 503 ? e.estado : 502;
    if (estado === 502) console.error("[cad] motor", e.estado, e.codigo, e.message);
    return error(e.message, estado, { codigo: e.codigo, errores: e.errores });
  }
  console.error("[cad]", e);
  return error("No se pudo generar el diseño. Intenta de nuevo.", 500);
}

const parametros = z.record(
  z.string().min(1).max(64),
  z.union([z.number().refine(Number.isFinite), z.boolean(), z.string().max(200)]),
);

export const cuerpoGenerar = z.object({
  plantilla: z.string().regex(/^[a-z0-9_-]{1,64}$/i),
  parametros: parametros.default({}),
});

export const cuerpoDxf = cuerpoGenerar.extend({
  opciones: z
    .object({
      kerf_mm: z.number().min(0).max(5).optional(),
      separacion_mm: z.number().min(0).max(200).optional(),
    })
    .optional(),
});

/** El cuerpo validado, o la respuesta 400 que hay que devolver. */
export async function leerCuerpo<T>(
  request: Request,
  esquema: z.ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false; respuesta: Response }> {
  let crudo: unknown;
  try {
    crudo = await request.json();
  } catch {
    return { ok: false, respuesta: error("No se pudo leer la petición.", 400) };
  }
  const r = esquema.safeParse(crudo);
  if (!r.success) {
    return { ok: false, respuesta: error("La petición no tiene la forma esperada.", 400) };
  }
  return { ok: true, data: r.data };
}

/** Un binario del motor, servido como descarga. */
export function archivo(contenido: ArrayBuffer, tipoMime: string, nombre: string) {
  return new Response(contenido, {
    headers: {
      "Content-Type": tipoMime,
      "Content-Disposition": `attachment; filename="${nombre}"`,
      "Content-Length": String(contenido.byteLength),
      "Cache-Control": "no-store",
    },
  });
}
