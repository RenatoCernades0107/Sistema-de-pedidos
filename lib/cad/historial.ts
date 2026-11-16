/**
 * El historial de versiones de un diseño: lo que se calcula sin servidor ni
 * React, para que el panel (`components/disenos/historial-versiones.tsx`) solo
 * pinte y las reglas se puedan probar.
 *
 * Cada guardado es una versión inmutable (`cad_diseno_versiones`). Restaurar no
 * reescribe nada: copia la vieja como una nueva (`restaurar_version_diseno`).
 */

import { momentoEnLima } from "@/lib/fecha";
import type { MaterialesPorCopia } from "./materiales";
import type { MaterialDiseno, ParametrosCad } from "./tipos";

export type OrigenHistorial = "formulario" | "chat" | "restauracion";

/** Una versión, como la lista el historial. */
export type VersionHistorial = {
  version: number;
  creadoEn: string;
  creadoPor: string | null;
  /** Copiado al guardar: `usuarios` solo deja leer el perfil propio. */
  autorNombre: string;
  origen: OrigenHistorial;
  nombreVersion: string | null;
  /** Si es una restauración, de qué versión. */
  restauradaDe: number | null;
  estado: "borrador" | "aprobado";
  /** URL pública de la foto, o `null` si nadie la sacó. */
  miniatura: string | null;
  plantilla: string;
  parametros: ParametrosCad;
  material: MaterialDiseno | null;
  materiales: MaterialesPorCopia;
};

/** Lo mínimo para decidir si alguien más guardó: número y autor. */
export type FirmaVersion = Pick<VersionHistorial, "version" | "creadoPor" | "autorNombre">;

/** La más nueva primero. */
export const ordenarVersiones = <T extends { version: number }>(versiones: readonly T[]): T[] =>
  [...versiones].sort((a, b) => b.version - a.version);

/** La versión vigente: la de número más alto. */
export function versionActual<T extends { version: number }>(versiones: readonly T[]): T | null {
  let actual: T | null = null;
  for (const v of versiones) if (!actual || v.version > actual.version) actual = v;
  return actual;
}

/** La última versión que guardó `usuarioId`, o `null` si nunca guardó en este diseño. */
export function ultimaVersionDe<T extends FirmaVersion>(versiones: readonly T[], usuarioId: string): T | null {
  return versionActual(versiones.filter((v) => v.creadoPor === usuarioId));
}

export const soloDe = <T extends FirmaVersion>(versiones: readonly T[], usuarioId: string): T[] =>
  versiones.filter((v) => v.creadoPor === usuarioId);

/** "Tú" para quien mira; si no, el nombre guardado (o "Alguien" en filas viejas sin nombre). */
export function nombreAutor(v: Pick<FirmaVersion, "creadoPor" | "autorNombre">, usuarioId: string | null): string {
  if (usuarioId && v.creadoPor === usuarioId) return "Tú";
  return v.autorNombre.trim() || "Alguien";
}

/** Solo el primer nombre, para los avisos cortos: "Carla Ruiz" → "Carla". */
export const primerNombre = (nombre: string) => nombre.trim().split(/\s+/)[0] || "Alguien";

/** De dónde salió la versión, en palabras: "Formulario", "Asistente", "Restaurada de v8". */
export function textoOrigen(v: Pick<VersionHistorial, "origen" | "restauradaDe">): string {
  switch (v.origen) {
    case "chat":
      return "Asistente";
    case "restauracion":
      return v.restauradaDe ? `Restaurada de v${v.restauradaDe}` : "Restaurada";
    default:
      return "Formulario";
  }
}

/**
 * El aviso de arriba del historial: la versión vigente es de otra persona y
 * quien mira tiene una suya a la que volver. `null` si la vigente es suya o si
 * nunca guardó en este diseño (no hay "tu versión").
 */
export function avisoCambioAjeno<T extends FirmaVersion>(
  versiones: readonly T[],
  usuarioId: string,
): { autor: string; version: number; mia: T } | null {
  const actual = versionActual(versiones);
  if (!actual || actual.creadoPor === usuarioId) return null;
  const mia = ultimaVersionDe(versiones, usuarioId);
  if (!mia) return null;
  return { autor: primerNombre(nombreAutor(actual, usuarioId)), version: actual.version, mia };
}

/**
 * Edición en paralelo: de las versiones guardadas después de `desde`, la más
 * nueva que no es de `usuarioId`. `null` si todas son suyas (su formulario, su
 * asistente u otra pestaña suya).
 */
export function cambioAjenoDesde<T extends FirmaVersion>(versiones: readonly T[], desde: number, usuarioId: string): T | null {
  return versionActual(versiones.filter((v) => v.version > desde && v.creadoPor !== usuarioId));
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/**
 * Cuándo se guardó, en hora de Lima: "hace un momento", "hace 5 min", "hoy 14:32",
 * "ayer 09:10", "12 nov 14:32" (con año si no es el actual).
 */
export function fechaVersion(iso: string, ahora: Date = new Date()): string {
  const ms = ahora.getTime() - new Date(iso).getTime();
  if (ms >= 0 && ms < 60_000) return "hace un momento";
  if (ms >= 0 && ms < 60 * 60_000) return `hace ${Math.floor(ms / 60_000)} min`;

  const momento = momentoEnLima(iso); // 2026-11-12T14:32
  const hoy = momentoEnLima(ahora.toISOString()).slice(0, 10);
  const ayer = momentoEnLima(new Date(ahora.getTime() - 86_400_000).toISOString()).slice(0, 10);
  const dia = momento.slice(0, 10);
  const hora = momento.slice(11, 16);
  if (dia === hoy) return `hoy ${hora}`;
  if (dia === ayer) return `ayer ${hora}`;
  const [a, m, d] = dia.split("-").map(Number);
  const año = a === Number(hoy.slice(0, 4)) ? "" : ` ${a}`;
  return `${d} ${MESES[m - 1]}${año} ${hora}`;
}

/** El nombre que alguien le pone a una versión: recortado, hasta 80; vacío es "sin nombre". */
export function limpiarNombreVersion(nombre: string): string | null {
  const limpio = nombre.trim().replace(/\s+/g, " ");
  return limpio ? limpio.slice(0, 80) : null;
}
