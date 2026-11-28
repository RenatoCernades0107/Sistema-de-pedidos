/**
 * Las conversaciones del agente (hoy, las del área de pruebas), como las guarda la
 * base (`agente_pruebas`, `agente_pruebas_mensajes`) y como las pintan
 * /agente-whatsapp y /conversaciones.
 */

import { deAdjuntos } from "@/lib/cad/adjuntos";
import type { Json } from "@/lib/supabase-tipos";
import { leerEstado, type EstadoConversacion } from "./estado";
import { leerAdjuntosWhatsapp } from "./webhook";
import {
  esMimeDocumento,
  esTipoDocumento,
  type AdjuntoAgente,
  type AdjuntoCliente,
  type Anuncio,
  type PasoTraza,
} from "./tipos";

/** Un archivo que el agente mandó en una prueba, con su pie y (al leerlo) su enlace. */
export interface AdjuntoPrueba extends AdjuntoAgente {
  texto?: string;
  url?: string;
}

/**
 * Un archivo que adjuntó el cliente, con (al leerlo) su enlace. Los del área de
 * pruebas están en el bucket `agente_adjuntos` (`ruta`); los que llegaron por
 * WhatsApp, en Kapso, y se ven por /api/whatsapp/media (ya traen `url`).
 */
export interface AdjuntoClientePrueba extends Omit<AdjuntoCliente, "mime"> {
  mime: string;
  url?: string;
}

export type RolMensaje = "cliente" | "agente" | "asesor";

export interface MensajePrueba {
  id: string;
  rol: RolMensaje;
  contenido: string;
  /** Lo que envió el agente. */
  adjuntos: AdjuntoPrueba[];
  /** Lo que adjuntó el cliente (o el asesor desde la app del celular). */
  adjuntosCliente: AdjuntoClientePrueba[];
  traza: PasoTraza[];
  /** Un mensaje del agente con `derivado` y sin contenido es la nota "pasó a un asesor". */
  derivado: boolean;
  /** Quién lo escribió, en los del asesor. */
  autorId: string | null;
  autorNombre?: string;
  creadoEn: string;
}

export type CanalConversacion = "prueba" | "whatsapp";

export interface PruebaResumen {
  id: string;
  titulo: string;
  canal: CanalConversacion;
  /** El número del cliente, en las de WhatsApp. */
  telefono: string | null;
  contactoNombre: string | null;
  anuncio: Anuncio | null;
  actualizadoEn: string;
  estado: EstadoConversacion;
  motivoAtencion: string | null;
  atencionDesde: string | null;
}

/** Una conversación en la lista de /conversaciones, con su último mensaje. */
export interface ConversacionResumen extends PruebaResumen {
  ultimoMensaje: { rol: RolMensaje; contenido: string; creadoEn: string } | null;
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

export const leerRol = (v: string): RolMensaje => (v === "agente" || v === "asesor" ? v : "cliente");

export function mensajeDeFila(f: {
  id: string;
  rol: string;
  contenido: string;
  adjuntos: Json | null;
  traza: Json | null;
  derivado: boolean;
  autor_id?: string | null;
  creado_en: string;
}): MensajePrueba {
  const rol = leerRol(f.rol);
  // Los que llegaron por WhatsApp se ven por la ruta que los baja de Kapso.
  const deWhatsapp = leerAdjuntosWhatsapp(f.adjuntos).map(
    (a, i): AdjuntoClientePrueba => ({
      ruta: `whatsapp:${i}`,
      nombre: a.nombre,
      mime: a.mime,
      tamano: a.tamano,
      url: `/api/whatsapp/media/${f.id}/${i}`,
    }),
  );
  return {
    id: f.id,
    rol,
    contenido: f.contenido,
    // La columna `adjuntos` guarda lo del agente o lo del cliente, según quién escribió.
    adjuntos: rol === "agente" ? leerAdjuntos(f.adjuntos) : [],
    adjuntosCliente: rol === "cliente" ? [...deAdjuntos(f.adjuntos), ...deWhatsapp] : rol === "asesor" ? deWhatsapp : [],
    traza: leerTraza(f.traza),
    derivado: f.derivado,
    autorId: f.autor_id ?? null,
    creadoEn: f.creado_en,
  };
}

export function resumenDeFila(p: {
  id: string;
  titulo: string;
  canal?: string;
  telefono?: string | null;
  contacto_nombre?: string | null;
  anuncio: Json | null;
  actualizado_en: string;
  estado: string;
  motivo_atencion: string | null;
  atencion_desde: string | null;
}): PruebaResumen {
  return {
    id: p.id,
    titulo: p.titulo,
    canal: p.canal === "whatsapp" ? "whatsapp" : "prueba",
    telefono: p.telefono ?? null,
    contactoNombre: p.contacto_nombre ?? null,
    anuncio: leerAnuncio(p.anuncio),
    actualizadoEn: p.actualizado_en,
    estado: leerEstado(p.estado),
    motivoAtencion: p.motivo_atencion,
    atencionDesde: p.atencion_desde,
  };
}

/** Una línea para la lista: "Tú: …", "Agente: …", o la nota de derivación. */
export function vistaPreviaMensaje(m: { rol: RolMensaje; contenido: string } | null): string {
  if (!m) return "Sin mensajes";
  const texto = m.contenido.replace(/\s+/g, " ").trim();
  if (m.rol === "agente" && !texto) return "El agente la pasó a un asesor";
  const quien = m.rol === "cliente" ? "Cliente" : m.rol === "asesor" ? "Asesor" : "Agente";
  return `${quien}: ${texto || "(adjunto)"}`;
}

/** Un título para la prueba a partir del primer mensaje del cliente. */
export function tituloDePrueba(primerMensaje: string): string {
  const t = primerMensaje.replace(/\s+/g, " ").trim();
  if (!t) return "Prueba";
  return t.length > 60 ? `${t.slice(0, 59).trimEnd()}…` : t;
}
