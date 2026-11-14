/**
 * El espesor propio de una copia de pieza. Viaja dentro de los parámetros del
 * diseño como `"espesor@<nodo>": mm`, donde `<nodo>` es el nombre de la copia
 * en el GLB (`lateral_2`, o `base` si la pieza va una sola vez). El motor lo
 * aplica después de construir la plantilla (`cad/motor/plantillas/base.py`,
 * `aplicar_espesores`) y devuelve solo los que siguen teniendo sentido.
 *
 * Puro: lo usan el formulario, el visor, el contexto y el chat.
 */

import type { ParametrosCad } from "./tipos";

export const PREFIJO_ESPESOR = "espesor@";
export const ESPESOR_MIN_MM = 1;
export const ESPESOR_MAX_MM = 30;
const CLAVE = /^espesor@[a-z0-9_]{1,56}$/;

export const claveEspesor = (nodo: string) => `${PREFIJO_ESPESOR}${nodo}`;
export const esClaveEspesor = (clave: string) => clave.startsWith(PREFIJO_ESPESOR);
/** Si el nombre de un nodo se puede usar en una clave de espesor. */
export const nodoValido = (nodo: string) => CLAVE.test(claveEspesor(nodo));

/** Los espesores propios de los parámetros, por nodo. */
export function espesoresDe(parametros: ParametrosCad): Record<string, number> {
  const salida: Record<string, number> = {};
  for (const [clave, valor] of Object.entries(parametros)) {
    if (esClaveEspesor(clave) && typeof valor === "number" && Number.isFinite(valor)) {
      salida[clave.slice(PREFIJO_ESPESOR.length)] = valor;
    }
  }
  return salida;
}

/** Los parámetros de la plantilla, sin los espesores propios. */
export function sinEspesores(parametros: ParametrosCad): ParametrosCad {
  return Object.fromEntries(Object.entries(parametros).filter(([k]) => !esClaveEspesor(k)));
}

/**
 * `nuevos` con los espesores propios de `anteriores` que `nuevos` no fija.
 * Para que cambiar un parámetro (desde el formulario o el chat) no borre los
 * espesores elegidos copia por copia.
 */
export function conservarEspesores(nuevos: ParametrosCad, anteriores: ParametrosCad): ParametrosCad {
  const salida: ParametrosCad = { ...nuevos };
  for (const [clave, valor] of Object.entries(anteriores)) {
    if (esClaveEspesor(clave) && !(clave in salida)) salida[clave] = valor;
  }
  return salida;
}

/** Los parámetros con el espesor propio de `nodos` puesto, o quitado con `null`. */
export function conEspesor(parametros: ParametrosCad, nodos: string | readonly string[], mm: number | null): ParametrosCad {
  const salida: ParametrosCad = { ...parametros };
  for (const nodo of typeof nodos === "string" ? [nodos] : nodos) {
    const clave = claveEspesor(nodo);
    if (mm === null) delete salida[clave];
    else salida[clave] = mm;
  }
  return salida;
}
