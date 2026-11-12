/**
 * Lo que Administración ajusta del cálculo de productos terminados
 * (`/configuracion`). Vive en `configuracion`, en la fila `terminados`.
 *
 * Como la de cortes, se lee siempre con `leerConfigTerminados`, que nunca
 * falla: lo que falte o no sirva cae a su defecto.
 */

import { z } from "zod";

export interface ConfigTerminados {
  /** Lo que se pierde al cortar y armar, sobre el área de las piezas. */
  mermaPct: number;
  /** En las letras: el ancho de cada una, como proporción de su altura. */
  anchoDeLetra: number;
}

export const CONFIG_TERMINADOS_DEFECTO: ConfigTerminados = { mermaPct: 15, anchoDeLetra: 0.7 };

export const esquemaConfigTerminados = z.object({
  mermaPct: z.coerce
    .number("La merma es un porcentaje")
    .min(0, "La merma no puede ser negativa")
    .max(200, "Esa merma no es razonable"),
  anchoDeLetra: z.coerce
    .number("El ancho de letra es una proporción de la altura")
    .positive("El ancho de letra tiene que ser mayor que cero")
    .max(3, "Ese ancho de letra no es razonable"),
});

export function leerConfigTerminados(json: unknown): ConfigTerminados {
  const o = (typeof json === "object" && json !== null ? json : {}) as Record<string, unknown>;
  const campo = <K extends keyof ConfigTerminados>(k: K): ConfigTerminados[K] => {
    const r = esquemaConfigTerminados.shape[k].safeParse(o[k]);
    return r.success && o[k] !== null && o[k] !== undefined && o[k] !== "" ? r.data : CONFIG_TERMINADOS_DEFECTO[k];
  };
  return { mermaPct: campo("mermaPct"), anchoDeLetra: campo("anchoDeLetra") };
}
