import { clienteServidor } from "@/lib/supabase-servidor";
import { enlacesDeDocumentos } from "./conocimiento-servidor";
import type { EstadoConversacion } from "./estado";
import {
  leerRol,
  mensajeDeFila,
  resumenDeFila,
  type ConversacionResumen,
  type MensajePrueba,
  type PruebaResumen,
} from "./pruebas";
import { BUCKET_ADJUNTOS_CLIENTE } from "./tipos";

const COLUMNAS_RESUMEN =
  "id, titulo, canal, telefono, contacto_nombre, anuncio, actualizado_en, estado, motivo_atencion, atencion_desde";
const COLUMNAS_MENSAJE = "id, rol, contenido, adjuntos, traza, derivado, autor_id, creado_en";

/** Las conversaciones del área de pruebas (no las de WhatsApp), la más reciente primero. */
export async function cargarPruebas(): Promise<PruebaResumen[]> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from("agente_pruebas")
    .select(COLUMNAS_RESUMEN)
    .eq("canal", "prueba")
    .order("actualizado_en", { ascending: false })
    .limit(100);
  if (error) throw new Error(`No se pudieron leer las pruebas del agente: ${error.message}`);
  return (data ?? []).map(resumenDeFila);
}

/**
 * Las conversaciones para /conversaciones, con su último mensaje. Las que esperan
 * a un humano van primero, la que más lleva esperando arriba; las demás, por la
 * última actividad.
 */
export async function cargarConversaciones(): Promise<ConversacionResumen[]> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from("agente_pruebas")
    .select(`${COLUMNAS_RESUMEN}, agente_pruebas_mensajes(rol, contenido, creado_en)`)
    .order("actualizado_en", { ascending: false })
    .order("creado_en", { referencedTable: "agente_pruebas_mensajes", ascending: false })
    .limit(1, { referencedTable: "agente_pruebas_mensajes" })
    .limit(200);
  if (error) throw new Error(`No se pudieron leer las conversaciones: ${error.message}`);
  const conversaciones = (data ?? []).map((p): ConversacionResumen => {
    const ultimo = p.agente_pruebas_mensajes?.[0];
    return {
      ...resumenDeFila(p),
      ultimoMensaje: ultimo ? { rol: leerRol(ultimo.rol), contenido: ultimo.contenido, creadoEn: ultimo.creado_en } : null,
    };
  });
  return ordenarConversaciones(conversaciones);
}

/** Primero las que necesitan atención (la más antigua arriba); después, por actividad. */
export function ordenarConversaciones<T extends PruebaResumen>(lista: T[]): T[] {
  const espera = (c: T) => c.atencionDesde ?? c.actualizadoEn;
  return [...lista].sort((a, b) => {
    const pa = a.estado === "necesita_atencion" ? 0 : 1;
    const pb = b.estado === "necesita_atencion" ? 0 : 1;
    if (pa !== pb) return pa - pb;
    if (pa === 0) return espera(a).localeCompare(espera(b));
    return b.actualizadoEn.localeCompare(a.actualizadoEn);
  });
}

/** Una conversación con su estado, o `null` si no existe. */
export async function cargarConversacion(id: string): Promise<PruebaResumen | null> {
  const supabase = await clienteServidor();
  const { data } = await supabase.from("agente_pruebas").select(COLUMNAS_RESUMEN).eq("id", id).maybeSingle();
  return data ? resumenDeFila(data) : null;
}

/** Los mensajes de una conversación, en orden, con enlaces temporales a los archivos y el nombre de los asesores. */
export async function cargarMensajesDePrueba(pruebaId: string): Promise<MensajePrueba[]> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from("agente_pruebas_mensajes")
    .select(COLUMNAS_MENSAJE)
    .eq("prueba_id", pruebaId)
    .order("creado_en", { ascending: true });
  if (error) throw new Error(`No se pudieron leer los mensajes: ${error.message}`);
  return conEnlaces((data ?? []).map(mensajeDeFila));
}

/** El nombre de cada usuario, por id (de `directorio_usuarios`, que lee cualquier rol). */
async function nombresDeUsuarios(): Promise<Map<string, string>> {
  const supabase = await clienteServidor();
  const { data } = await supabase.rpc("directorio_usuarios");
  return new Map((data ?? []).map((u) => [u.id, u.nombre]));
}

/**
 * Les pone a los adjuntos su enlace temporal (si el archivo sigue existiendo) y a
 * los mensajes de asesores el nombre de quien los escribió.
 */
export async function conEnlaces(mensajes: MensajePrueba[]): Promise<MensajePrueba[]> {
  const supabase = await clienteServidor();
  // Solo los del bucket: los de WhatsApp ya traen su enlace (/api/whatsapp/media).
  const rutasCliente = [
    ...new Set(mensajes.flatMap((m) => m.adjuntosCliente.flatMap((a) => (a.url ? [] : [a.ruta])))),
  ];
  const hayAsesores = mensajes.some((m) => m.rol === "asesor");
  const [enlaces, firmados, nombres] = await Promise.all([
    enlacesDeDocumentos(mensajes.flatMap((m) => m.adjuntos.map((a) => a.documentoId))),
    rutasCliente.length
      ? supabase.storage.from(BUCKET_ADJUNTOS_CLIENTE).createSignedUrls(rutasCliente, 3600)
      : Promise.resolve({ data: [] as { path: string | null; signedUrl: string }[] }),
    hayAsesores ? nombresDeUsuarios() : Promise.resolve(new Map<string, string>()),
  ]);
  const porRuta = new Map(
    (firmados.data ?? []).flatMap((x) => (x.path && x.signedUrl ? [[x.path, x.signedUrl] as const] : [])),
  );
  return mensajes.map((m) => ({
    ...m,
    adjuntos: m.adjuntos.map((a) => ({ ...a, url: enlaces.get(a.documentoId) })),
    adjuntosCliente: m.adjuntosCliente.map((a) => ({ ...a, url: a.url ?? porRuta.get(a.ruta) })),
    autorNombre: m.autorId ? nombres.get(m.autorId) : undefined,
  }));
}

/** Cuántas conversaciones esperan a un humano. */
export async function contarPendientes(): Promise<number> {
  const supabase = await clienteServidor();
  const { count } = await supabase
    .from("agente_pruebas")
    .select("id", { count: "exact", head: true })
    .eq("estado", "necesita_atencion" satisfies EstadoConversacion);
  return count ?? 0;
}
