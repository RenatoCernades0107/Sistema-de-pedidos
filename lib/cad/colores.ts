/**
 * El color con que el visor 3D pinta el acrílico, según el color de la plancha
 * elegida (`colorDe` del catálogo: "Cristal", "Blanco lechoso", "Colores rojo").
 *
 * Una tabla corta de palabras clave: se busca la primera que aparezca en el
 * nombre. Lo que no se reconoce se pinta con un gris neutro semiopaco; cristal y
 * transparente se quedan como siempre (`null`).
 */

import { compactar } from "@/lib/busqueda-inteligente";

export interface TinteAcrilico {
  color: string;
  opacidad: number;
}

/** Palabra clave (ya compactada) → tinte. El orden importa: la primera gana. */
const TINTES: [string, TinteAcrilico | null][] = [
  ["cristal", null],
  ["transparente", null],
  ["humo", { color: "#5b5b5b", opacidad: 0.55 }],
  ["bronce", { color: "#8c6a3f", opacidad: 0.55 }],
  ["espejodorado", { color: "#d4af37", opacidad: 0.95 }],
  ["espejoplata", { color: "#c0c4c8", opacidad: 0.95 }],
  ["dorado", { color: "#d4af37", opacidad: 0.92 }],
  ["plata", { color: "#c0c4c8", opacidad: 0.92 }],
  ["espejo", { color: "#c0c4c8", opacidad: 0.95 }],
  ["lechoso", { color: "#f4f4f2", opacidad: 0.85 }],
  ["opal", { color: "#f4f4f2", opacidad: 0.85 }],
  ["blanco", { color: "#f8f8f8", opacidad: 0.92 }],
  ["white", { color: "#f8f8f8", opacidad: 0.92 }],
  ["negro", { color: "#1c1c1c", opacidad: 0.95 }],
  ["black", { color: "#1c1c1c", opacidad: 0.95 }],
  ["rojo", { color: "#c62828", opacidad: 0.8 }],
  ["red", { color: "#c62828", opacidad: 0.8 }],
  ["azul", { color: "#1e5bb8", opacidad: 0.8 }],
  ["blue", { color: "#1e5bb8", opacidad: 0.8 }],
  ["celeste", { color: "#5bb8e8", opacidad: 0.7 }],
  ["verde", { color: "#2e7d32", opacidad: 0.8 }],
  ["green", { color: "#2e7d32", opacidad: 0.8 }],
  ["amarillo", { color: "#f5c518", opacidad: 0.8 }],
  ["yellow", { color: "#f5c518", opacidad: 0.8 }],
  ["naranja", { color: "#ef6c00", opacidad: 0.8 }],
  ["orange", { color: "#ef6c00", opacidad: 0.8 }],
  ["rosado", { color: "#e88aa8", opacidad: 0.8 }],
  ["fucsia", { color: "#c2185b", opacidad: 0.8 }],
  ["morado", { color: "#6a1b9a", opacidad: 0.8 }],
  ["violeta", { color: "#6a1b9a", opacidad: 0.8 }],
  ["gris", { color: "#8a8a8a", opacidad: 0.85 }],
  ["marron", { color: "#6d4c41", opacidad: 0.9 }],
];

/** Para lo que no está en la tabla: se ve que no es cristal, sin inventar un color. */
const POR_DEFECTO: TinteAcrilico = { color: "#b0b4b8", opacidad: 0.75 };

/** El tinte de un color del catálogo. `null`: cristal / transparente o sin color. */
export function tinteDeColor(nombre: string | null | undefined): TinteAcrilico | null {
  const texto = compactar(nombre ?? "");
  if (!texto) return null;
  for (const [clave, tinte] of TINTES) if (texto.includes(clave)) return tinte;
  return POR_DEFECTO;
}
