/**
 * Los proyectos de diseños (migración 20261226000100): agrupan varios diseños de
 * un mismo trabajo (los letreros de una lámina) para aprobarlos y cortarlos
 * juntos. Este archivo es lo puro que comparten el servidor y las pantallas.
 */

import { z } from "zod";
import { PLANTILLA_LIBRE } from "./tipos";

/** Cuántos diseños puede crear el asistente de una vez. */
export const MAX_DISENOS_POR_LLAMADA = 10;

/** Tope del nombre de un proyecto (el mismo de la base). */
export const MAX_NOMBRE_PROYECTO = 120;

export const esquemaNombreProyecto = z
  .string()
  .trim()
  .min(1, "Ponle un nombre al proyecto.")
  .max(MAX_NOMBRE_PROYECTO, `El nombre es demasiado largo (máximo ${MAX_NOMBRE_PROYECTO} caracteres).`);

/**
 * En qué punto está un diseño para producción:
 *   · `sin_version`  todavía no tiene plantilla ni código;
 *   · `plantilla`    de plantilla: nace aprobado;
 *   · `borrador`     personalizado (código) y Administración aún no lo aprobó;
 *   · `aprobado`     personalizado y aprobado.
 */
export type EstadoDiseno = "sin_version" | "plantilla" | "borrador" | "aprobado";

/** El estado de un diseño según su versión vigente (`null`: no tiene versión). */
export function estadoDeDiseno(version: { plantilla: string; estado: string | null } | null): EstadoDiseno {
  if (!version) return "sin_version";
  if (version.plantilla !== PLANTILLA_LIBRE) return "plantilla";
  return version.estado === "aprobado" ? "aprobado" : "borrador";
}

export type ResumenProyecto = {
  total: number;
  /** Listos para producción: de plantilla o personalizados aprobados. */
  aprobados: number;
  /** Personalizados esperando que Administración los apruebe. */
  borradores: number;
  sinVersion: number;
  /** Hay al menos un diseño y ninguno espera aprobación ni está vacío. */
  listoParaProduccion: boolean;
};

export function resumenDeProyecto(estados: readonly EstadoDiseno[]): ResumenProyecto {
  const borradores = estados.filter((e) => e === "borrador").length;
  const sinVersion = estados.filter((e) => e === "sin_version").length;
  const total = estados.length;
  return {
    total,
    aprobados: total - borradores - sinVersion,
    borradores,
    sinVersion,
    listoParaProduccion: total > 0 && borradores === 0 && sinVersion === 0,
  };
}

/** «3 de 4 listos», «Sin diseños», «2 diseños (1 por aprobar)». */
export function textoDeResumen(r: ResumenProyecto): string {
  if (r.total === 0) return "Sin diseños todavía";
  if (r.listoParaProduccion) return r.total === 1 ? "1 diseño, listo" : `${r.total} diseños, todos listos`;
  return `${r.aprobados} de ${r.total} listos`;
}

/** El texto del primer mensaje de un diseño que el asistente creó dentro de un proyecto. */
export function mensajeInicialDeDiseno(entrada: { proyecto: string; nombre: string; descripcion: string; hermanos: string[] }): string {
  const otros = entrada.hermanos.filter((n) => n !== entrada.nombre);
  return [
    `Este diseño es «${entrada.nombre}», del proyecto «${entrada.proyecto}».`,
    entrada.descripcion.trim(),
    otros.length ? `Los otros diseños del proyecto son: ${otros.join(", ")}. Aquí trabajamos solo este.` : "",
    "Te dejo adjunto el plano del cliente.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** La respuesta que se deja guardada tras el mensaje inicial, para que el historial alterne usuario y asistente. */
export const RESPUESTA_INICIAL_DE_DISENO =
  "Listo, tengo el contexto de este diseño y el plano. Dime cómo seguimos, o te propongo cómo armarlo.";
