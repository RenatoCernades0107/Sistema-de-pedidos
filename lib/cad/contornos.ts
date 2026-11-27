/**
 * Los contornos vectoriales (logos) de un diseño: lo que el asistente extrae de
 * un PDF (`lib/pdf-vector.ts`), se guarda en `cad_contornos` (migración
 * 20261225000100) y se le pasa al sandbox con cada ejecución para que el código
 * del diseño libre los pida por nombre (`caras_de_contorno("hurley")`).
 *
 * Este archivo es lo que comparten el servidor, el cliente del sandbox y la
 * herramienta: la forma, los topes y la validación del nombre.
 */

import { z } from "zod";

/** Cómo lo pide el código: minúsculas, números y guion bajo (el mismo patrón que la base). */
export const NOMBRE_CONTORNO = /^[a-z][a-z0-9_]{0,39}$/;

/** Cuántos contornos viajan con un diseño, como mucho. */
export const MAX_CONTORNOS = 20;

/** Un contorno tal como lo recibe el sandbox: trazos `d` de SVG (M, L, C, Z) en mm, Y hacia arriba. */
export const esquemaContorno = z.object({
  ancho_mm: z.number().positive(),
  alto_mm: z.number().positive(),
  trazos: z.array(z.string().min(1).max(2_000_000)).min(1).max(5000),
});

export type ContornoSandbox = z.infer<typeof esquemaContorno>;

/** Nombre → contorno: lo que va en `contornos` de cada llamada al sandbox. */
export type ContornosSandbox = Record<string, ContornoSandbox>;

/** Los contornos guardados con un diseño, en la forma del sandbox; los que no se entiendan se saltan. */
export function deFilasDeContorno(
  filas: readonly { nombre: string; ancho_mm: number; alto_mm: number; trazos: unknown }[],
): ContornosSandbox {
  const salida: ContornosSandbox = {};
  for (const f of filas) {
    const leido = esquemaContorno.safeParse({ ancho_mm: Number(f.ancho_mm), alto_mm: Number(f.alto_mm), trazos: f.trazos });
    if (leido.success && NOMBRE_CONTORNO.test(f.nombre)) salida[f.nombre] = leido.data;
  }
  return salida;
}
