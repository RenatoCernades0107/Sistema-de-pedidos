/** Lo común de las dos rutas de referencias: errores en JSON y parámetros JSON validados. */

import { z } from "zod";

export function error(mensaje: string, status: number) {
  return Response.json({ error: mensaje }, { status });
}

/**
 * Un parámetro de la URL que trae JSON (`contexto`, `nivel`). Sin él, el valor
 * por defecto; con JSON roto, falla la validación como cualquier otro campo.
 */
export const json = <T extends z.ZodType>(esquema: T, porDefecto: z.input<T>) =>
  z
    .string()
    .max(2000)
    .optional()
    .transform((texto, ctx): unknown => {
      if (texto === undefined || texto === "") return porDefecto;
      try {
        return JSON.parse(texto);
      } catch {
        ctx.addIssue({ code: "custom", message: "JSON inválido" });
        return z.NEVER;
      }
    })
    .pipe(esquema);
