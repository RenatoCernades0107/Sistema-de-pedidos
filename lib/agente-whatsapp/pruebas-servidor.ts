import { clienteServidor } from "@/lib/supabase-servidor";
import { enlacesDeDocumentos } from "./conocimiento-servidor";
import { leerAnuncio, mensajeDeFila, type MensajePrueba, type PruebaResumen } from "./pruebas";

/** Las conversaciones de prueba, la más reciente primero. */
export async function cargarPruebas(): Promise<PruebaResumen[]> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from("agente_pruebas")
    .select("id, titulo, anuncio, actualizado_en")
    .order("actualizado_en", { ascending: false })
    .limit(100);
  if (error) throw new Error(`No se pudieron leer las pruebas del agente: ${error.message}`);
  return (data ?? []).map((p) => ({
    id: p.id,
    titulo: p.titulo,
    anuncio: leerAnuncio(p.anuncio),
    actualizadoEn: p.actualizado_en,
  }));
}

/** Los mensajes de una prueba, en orden, con enlaces temporales a los archivos que mandó el agente. */
export async function cargarMensajesDePrueba(pruebaId: string): Promise<MensajePrueba[]> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from("agente_pruebas_mensajes")
    .select("id, rol, contenido, adjuntos, traza, derivado, creado_en")
    .eq("prueba_id", pruebaId)
    .order("creado_en", { ascending: true });
  if (error) throw new Error(`No se pudieron leer los mensajes: ${error.message}`);
  const mensajes = (data ?? []).map(mensajeDeFila);
  return conEnlaces(mensajes);
}

/** Les pone a los adjuntos su enlace temporal (si el archivo sigue existiendo). */
export async function conEnlaces(mensajes: MensajePrueba[]): Promise<MensajePrueba[]> {
  const enlaces = await enlacesDeDocumentos(mensajes.flatMap((m) => m.adjuntos.map((a) => a.documentoId)));
  return mensajes.map((m) => ({
    ...m,
    adjuntos: m.adjuntos.map((a) => ({ ...a, url: enlaces.get(a.documentoId) })),
  }));
}
