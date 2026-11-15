/**
 * Lo que Administración ajusta de las cotizaciones en `/configuracion`. Vive en
 * la fila `cotizaciones` de la tabla `configuracion`; si no existe, valen los
 * defectos.
 *
 * El PDF público lee los mismos días desde `cotizacion_publica()` (el cliente no
 * tiene sesión para leer `configuracion`): el 15 de abajo y el de esa función
 * tienen que coincidir.
 */

import { z } from "zod";
import { sumarDias } from "./dominio";
import { diaEnLima } from "./fecha";
import { fechaCompleta } from "./formato";

export const CLAVE_CONFIG_COTIZACIONES = "cotizaciones";
export const VALIDEZ_POR_DEFECTO = 15;

export const esquemaConfigCotizaciones = z.object({
  validezDias: z.coerce
    .number("La validez es un número de días")
    .int("La validez va en días enteros")
    .min(1, "La validez tiene que ser de al menos 1 día")
    .max(365, "La validez no puede pasar de 365 días"),
});

export type ConfigCotizaciones = z.infer<typeof esquemaConfigCotizaciones>;

/** Lo guardado, o el defecto en lo que falte o no se entienda. */
export function leerConfigCotizaciones(json: unknown): ConfigCotizaciones {
  const valor = json && typeof json === "object" ? (json as Record<string, unknown>).validezDias : undefined;
  const r = esquemaConfigCotizaciones.shape.validezDias.safeParse(valor);
  return { validezDias: r.success ? r.data : VALIDEZ_POR_DEFECTO };
}

/** "Cotización válida por 15 días (hasta el 29/11/2026)." Desde el día de emisión, en Lima. */
export function textoValidez(creadoEn: string, validezDias: number): string {
  const hasta = fechaCompleta(sumarDias(diaEnLima(creadoEn), validezDias));
  return `Cotización válida por ${validezDias} ${validezDias === 1 ? "día" : "días"} (hasta el ${hasta}).`;
}
