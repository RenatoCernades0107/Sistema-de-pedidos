/**
 * El nombre automático de un diseño, como el título que Claude le pone a un
 * chat: tras el primer mensaje, el modelo resume el pedido en pocas palabras.
 *
 * Si el modelo falla o devuelve algo inservible, el nombre sale de las primeras
 * palabras del propio mensaje: un diseño nunca se queda sin nombre por esto.
 */

import { transmitirChat, type PeticionChat, type EventoLlm } from "@/lib/llm/inferhub";

/** El nombre con que nace un diseño (el `default` de `cad_disenos.nombre`). */
export const NOMBRE_POR_DEFECTO = "Diseño sin título";

const MAX_LARGO = 60;
const MAX_PALABRAS_RESPALDO = 6;

const SISTEMA = [
  "Pones títulos a diseños de productos de acrílico, MDF y similares (cajas, porta afiches, exhibidores…).",
  "Recibes el primer mensaje que escribió la persona y devuelves SOLO un título de 2 a 5 palabras en español",
  "que resuma qué se quiere diseñar. Sin comillas, sin punto final, sin emojis, sin explicar nada.",
  'Ejemplos: "Caja acrílica con tapa", "Porta afiche A4 vertical", "Alzador de mostrador".',
  'Si el mensaje no pide nada concreto (un saludo, una pregunta general), devuelve "Consulta de diseño".',
].join(" ");

/** Deja el título en una línea limpia, o `""` si no queda nada usable. */
export function limpiarTitulo(crudo: string): string {
  let t = crudo.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  t = t
    .replace(/^(t[ií]tulo\s*:\s*)/i, "")
    .replace(/^[\s"'«»“”‘’*#`]+|[\s"'«»“”‘’*#`.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length > MAX_LARGO) t = `${t.slice(0, MAX_LARGO - 1).trimEnd()}…`;
  return t;
}

/** Las primeras palabras del mensaje, por si el modelo no da un título. */
export function tituloDeRespaldo(mensaje: string): string {
  const palabras = mensaje.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (palabras.length === 0) return NOMBRE_POR_DEFECTO;
  const corto = palabras.slice(0, MAX_PALABRAS_RESPALDO).join(" ");
  const t = limpiarTitulo(palabras.length > MAX_PALABRAS_RESPALDO ? `${corto}…` : corto);
  if (!t) return NOMBRE_POR_DEFECTO;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Un título para el diseño a partir del primer mensaje. Nunca lanza: si algo
 * falla, devuelve el de respaldo.
 */
export async function generarTitulo(
  mensaje: string,
  opciones: {
    senal?: AbortSignal;
    /** Para las pruebas: por defecto, el modelo de verdad. */
    transmitir?: (p: PeticionChat) => AsyncIterable<EventoLlm>;
  } = {},
): Promise<string> {
  const transmitir = opciones.transmitir ?? transmitirChat;
  try {
    let texto = "";
    for await (const evento of transmitir({
      sistema: SISTEMA,
      mensajes: [{ rol: "usuario", contenido: mensaje.slice(0, 2000) }],
      senal: opciones.senal,
    })) {
      if (evento.tipo === "texto") texto += evento.delta;
      if (texto.length > 400) break;
    }
    return limpiarTitulo(texto) || tituloDeRespaldo(mensaje);
  } catch (e) {
    console.error("[cad] título del diseño", e instanceof Error ? e.message : e);
    return tituloDeRespaldo(mensaje);
  }
}
