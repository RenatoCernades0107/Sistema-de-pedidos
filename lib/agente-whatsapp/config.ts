/**
 * Con qué clave y qué modelos trabaja el agente de WhatsApp. Tiene su propia
 * clave de Inferhub (`AGENTE_WA_INFERHUB_API_KEY`), separada de la del chat de
 * diseños, para que el consumo de cada uno se vea por separado.
 *
 * Los embeddings no tienen "respaldo" en el sentido del chat: un vector de un
 * modelo no se compara con el de otro. El de respaldo se usa para indexar (y
 * para buscar entre lo que quedó indexado con él) cuando el principal falla;
 * la búsqueda por palabras cubre el resto.
 */

import type { PerfilLlm } from "@/lib/llm/inferhub";

const MODELO_POR_DEFECTO = "ag/gemini-3.8-flash-high";
const RESPALDO_POR_DEFECTO = "cc/claude-haiku-5-5";
const EMBEDDINGS_POR_DEFECTO = "oai/gpt-6-luna";
const EMBEDDINGS_RESPALDO_POR_DEFECTO = "oai/gpt-5.6-luna";

/**
 * El tamaño de los vectores. Fijo: es el de la columna `agente_fragmentos.embedding`
 * (migración 20261216000100). Cambiarlo es otra migración y reindexar todo.
 */
export const DIMENSIONES_EMBEDDING = 1536;

export const AGENTE_NO_CONFIGURADO =
  "El agente no está configurado: falta su clave de Inferhub (AGENTE_WA_INFERHUB_API_KEY).";

const lista = (valor: string | undefined, defecto: string[]) =>
  valor === undefined
    ? defecto
    : valor
        .split(",")
        .map((m) => m.trim())
        .filter(Boolean);

function clave(): string {
  return process.env.AGENTE_WA_INFERHUB_API_KEY?.trim() ?? "";
}

export function agenteConfigurado(): boolean {
  return clave() !== "";
}

/** La clave y los modelos de chat del agente. */
export function perfilDelAgente(): PerfilLlm {
  return {
    clave: clave(),
    modelo: process.env.AGENTE_WA_MODELO?.trim() || MODELO_POR_DEFECTO,
    respaldo: lista(process.env.AGENTE_WA_MODELOS_RESPALDO, [RESPALDO_POR_DEFECTO]),
  };
}

/** Los modelos de embeddings, en el orden en que se prueban. */
export function modelosDeEmbeddings(): string[] {
  const principal = process.env.AGENTE_WA_EMBEDDINGS_MODELO?.trim() || EMBEDDINGS_POR_DEFECTO;
  const respaldo = lista(process.env.AGENTE_WA_EMBEDDINGS_RESPALDO, [EMBEDDINGS_RESPALDO_POR_DEFECTO]);
  return [...new Set([principal, ...respaldo])];
}
