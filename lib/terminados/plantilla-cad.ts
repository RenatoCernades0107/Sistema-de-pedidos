/**
 * El puente entre el catálogo de productos terminados y las plantillas del
 * motor CAD (`cad/motor/plantillas/`).
 *
 * Un producto que una plantilla cubre trae en la base `plantilla_cad` y
 * `parametros_cad` (migración `20261119000100`): los parámetros de su primera
 * medida, ya en milímetros, más los fijos de su forma (si lleva tapa, cuántos
 * niveles…). Al elegir otra medida en el editor, aquí se traduce de nuevo: el
 * catálogo guarda centímetros y el motor recibe milímetros.
 *
 * Sin dependencias de servidor: lo usa el editor del navegador.
 */

import type { ParametrosCad } from "../cad/tipos";
import type { Medidas } from "./geometria";

export const MM_POR_CM = 10;

type CampoCm = Exclude<keyof Medidas, "letras">;

/**
 * Qué medida del catálogo va a qué parámetro de cada plantilla. El orden de
 * las medidas es el de la empresa (frente × fondo × alto, o ancho × alto en
 * las láminas). La misma tabla la aplica la migración al poblar la base.
 */
export const MEDIDAS_DE_PLANTILLA: Record<string, Partial<Record<CampoCm, string>>> = {
  caja: { m1: "largo", m2: "ancho", m3: "alto" },
  anfora: { m1: "largo", m2: "ancho", m3: "alto" },
  alzador: { m1: "largo", m2: "ancho", m3: "alto" },
  display: { m1: "ancho", m2: "fondo", m3: "alto" },
  porta_afiche: { m1: "ancho", m2: "alto", m3: "fondo" },
  atril: { m1: "ancho", m2: "alto" },
  tareco: { m1: "largo", m2: "alto" },
  letrero: { m1: "ancho", m2: "alto" },
  letras: { altura: "alto_letra" },
};

/** El texto libre que admite cada plantilla, y hasta cuántos caracteres. */
const TEXTO_DE_PLANTILLA: Record<string, number> = { letras: 40, letrero: 60 };

const aMm = (cm: number) => Math.round(cm * MM_POR_CM * 10) / 10;

/** Las medidas del catálogo (cm) como parámetros del motor (mm). Lo que falta, no se manda. */
export function medidasAParametrosCad(plantilla: string, medidas: Medidas): ParametrosCad {
  const salida: ParametrosCad = {};
  for (const [campo, parametro] of Object.entries(MEDIDAS_DE_PLANTILLA[plantilla] ?? {})) {
    const v = medidas[campo as CampoCm];
    if (parametro && typeof v === "number" && Number.isFinite(v) && v > 0) salida[parametro] = aMm(v);
  }
  return salida;
}

/**
 * Los parámetros que se mandan al motor: los guardados del producto, con la
 * medida elegida, el espesor de la plancha y —en letras y letreros— el texto
 * del pedido encima.
 */
export function parametrosCadDe(
  producto: { plantillaCad: string | null; parametrosCad: ParametrosCad | null },
  medidas: Medidas,
  extra: { espesorMm?: number | null; texto?: string | null } = {},
): ParametrosCad | null {
  const plantilla = producto.plantillaCad;
  if (!plantilla) return null;
  const salida: ParametrosCad = { ...(producto.parametrosCad ?? {}), ...medidasAParametrosCad(plantilla, medidas) };
  if (extra.espesorMm && extra.espesorMm > 0) salida.espesor = extra.espesorMm;
  const largoTexto = TEXTO_DE_PLANTILLA[plantilla];
  const texto = extra.texto?.trim();
  if (largoTexto && texto) salida.texto = texto.slice(0, largoTexto);
  return salida;
}

/** Lo que llega de la base (`jsonb`): solo un objeto de valores planos sirve. */
export function leerParametrosCad(valor: unknown): ParametrosCad | null {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return null;
  const salida: ParametrosCad = {};
  for (const [k, v] of Object.entries(valor)) {
    if (typeof v === "number" || typeof v === "boolean" || typeof v === "string") salida[k] = v;
  }
  return salida;
}
