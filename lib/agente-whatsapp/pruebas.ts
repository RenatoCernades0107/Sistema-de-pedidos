/**
 * Las conversaciones del área de pruebas, como las guarda la base
 * (`agente_pruebas`, `agente_pruebas_mensajes`) y como las pinta la pantalla.
 */

import type { Json } from "@/lib/supabase-tipos";
import { esMimeDocumento, esTipoDocumento, type AdjuntoAgente, type Anuncio, type PasoTraza } from "./tipos";

/** Un archivo que el agente mandó en una prueba, con su pie y (al leerlo) su enlace. */
export interface AdjuntoPrueba extends AdjuntoAgente {
  texto?: string;
  url?: string;
}

export interface MensajePrueba {
  id: string;
  rol: "cliente" | "agente";
  contenido: string;
  adjuntos: AdjuntoPrueba[];
  traza: PasoTraza[];
  derivado: boolean;
  creadoEn: string;
}

export interface PruebaResumen {
  id: string;
  titulo: string;
  anuncio: Anuncio | null;
  actualizadoEn: string;
}

const cadena = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 2000) : undefined);

/** El anuncio guardado, o `null` si no hay o no se entiende. */
export function leerAnuncio(json: unknown): Anuncio | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const j = json as Record<string, unknown>;
  const a: Anuncio = {
    sourceId: cadena(j.sourceId),
    titulo: cadena(j.titulo),
    texto: cadena(j.texto),
    url: cadena(j.url),
    ctwaClid: cadena(j.ctwaClid),
  };
  const limpio = Object.fromEntries(Object.entries(a).filter(([, v]) => v !== undefined)) as Anuncio;
  return limpio.sourceId || limpio.titulo || limpio.texto ? limpio : null;
}

export function leerAdjuntos(json: unknown): AdjuntoPrueba[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((x): AdjuntoPrueba[] => {
    if (!x || typeof x !== "object") return [];
    const a = x as Record<string, unknown>;
    if (typeof a.documentoId !== "string" || typeof a.nombre !== "string") return [];
    if (typeof a.mime !== "string" || !esMimeDocumento(a.mime) || !esTipoDocumento(a.tipo)) return [];
    return [{ documentoId: a.documentoId, nombre: a.nombre, mime: a.mime, tipo: a.tipo, texto: cadena(a.texto) }];
  });
}

export function leerTraza(json: unknown): PasoTraza[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((x): PasoTraza[] => {
    if (!x || typeof x !== "object") return [];
    const p = x as Record<string, unknown>;
    if (typeof p.herramienta !== "string" || typeof p.resumen !== "string") return [];
    return [
      {
        herramienta: p.herramienta,
        resumen: p.resumen,
        argumentos: p.argumentos && typeof p.argumentos === "object" ? (p.argumentos as Record<string, unknown>) : {},
        detalle: p.detalle,
        error: p.error === true,
      },
    ];
  });
}

export function mensajeDeFila(f: {
  id: string;
  rol: string;
  contenido: string;
  adjuntos: Json | null;
  traza: Json | null;
  derivado: boolean;
  creado_en: string;
}): MensajePrueba {
  return {
    id: f.id,
    rol: f.rol === "agente" ? "agente" : "cliente",
    contenido: f.contenido,
    adjuntos: leerAdjuntos(f.adjuntos),
    traza: leerTraza(f.traza),
    derivado: f.derivado,
    creadoEn: f.creado_en,
  };
}

/** Un título para la prueba a partir del primer mensaje del cliente. */
export function tituloDePrueba(primerMensaje: string): string {
  const t = primerMensaje.replace(/\s+/g, " ").trim();
  if (!t) return "Prueba";
  return t.length > 60 ? `${t.slice(0, 59).trimEnd()}…` : t;
}
