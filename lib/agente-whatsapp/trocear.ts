/**
 * Parte el texto de un documento en fragmentos para la búsqueda: lo bastante
 * cortos para que cada uno hable de una cosa (un producto, una tabla) y lo
 * bastante largos para que tengan sentido solos. Nunca cruzan de una página a
 * otra, así el agente puede decir "página 4 del catálogo".
 */

import type { PaginaPdf } from "@/lib/pdf-texto";

export type Fragmento = { pagina: number | null; contenido: string };

export const LARGO_FRAGMENTO = 1000;
export const SOLAPE_FRAGMENTO = 150;

/** Un trozo demasiado largo, por frases; y si una frase sola no cabe, a cuchillo por palabras. */
function partirLargo(texto: string, max: number): string[] {
  const frases = texto.match(/[^.!?\n]+[.!?]*\s*/g) ?? [texto];
  const salida: string[] = [];
  let actual = "";
  for (const frase of frases) {
    if (frase.length > max) {
      if (actual.trim()) salida.push(actual.trim());
      actual = "";
      const palabras = frase.split(/\s+/);
      let trozo = "";
      for (const p of palabras) {
        if ((trozo + " " + p).length > max && trozo) {
          salida.push(trozo.trim());
          trozo = "";
        }
        trozo += (trozo ? " " : "") + p;
      }
      if (trozo.trim()) actual = trozo;
      continue;
    }
    if ((actual + frase).length > max && actual.trim()) {
      salida.push(actual.trim());
      actual = "";
    }
    actual += frase;
  }
  if (actual.trim()) salida.push(actual.trim());
  return salida;
}

/** Las últimas palabras de un fragmento, para empezar el siguiente con contexto. */
function cola(texto: string, largo: number): string {
  if (largo <= 0 || texto.length <= largo) return "";
  const corte = texto.slice(-largo);
  const espacio = corte.indexOf(" ");
  return espacio === -1 ? corte : corte.slice(espacio + 1);
}

/** Los fragmentos de un texto, de a lo sumo unos `max` caracteres (más el solape). */
export function trocearTexto(texto: string, max = LARGO_FRAGMENTO, solape = SOLAPE_FRAGMENTO): string[] {
  const limpio = texto.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!limpio) return [];
  const parrafos = limpio
    .split(/\n\s*\n|\n(?=[-•·*]\s)/)
    .map((p) => p.trim())
    .filter(Boolean)
    .flatMap((p) => (p.length > max ? partirLargo(p, max) : [p]));

  const salida: string[] = [];
  let actual = "";
  for (const p of parrafos) {
    if (actual && (actual + "\n" + p).length > max) {
      salida.push(actual);
      const previo = cola(actual, solape);
      actual = previo ? `${previo}\n${p}` : p;
    } else {
      actual = actual ? `${actual}\n${p}` : p;
    }
  }
  if (actual) salida.push(actual);
  return salida;
}

/** Los fragmentos de un PDF, página por página. */
export function trocearPaginas(paginas: PaginaPdf[], max = LARGO_FRAGMENTO, solape = SOLAPE_FRAGMENTO): Fragmento[] {
  return paginas.flatMap((p) => trocearTexto(p.texto, max, solape).map((contenido) => ({ pagina: p.numero, contenido })));
}

/** "=== Página 2 ===\n…" → páginas. Sin marcas, todo es la página 1. Exportado para las pruebas. */
export function paginasDeTranscripcion(texto: string): PaginaPdf[] {
  const partes = texto.split(/^=+\s*P[aá]gina\s+(\d+)\s*=+\s*$/im);
  if (partes.length === 1) return texto.trim() ? [{ numero: 1, texto: texto.trim() }] : [];
  const paginas: PaginaPdf[] = [];
  if (partes[0].trim()) paginas.push({ numero: 1, texto: partes[0].trim() });
  for (let i = 1; i < partes.length; i += 2) {
    const t = (partes[i + 1] ?? "").trim();
    if (t) paginas.push({ numero: Number(partes[i]), texto: t });
  }
  return paginas;
}
