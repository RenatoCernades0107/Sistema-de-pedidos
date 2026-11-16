/**
 * Las lecturas del chat, iguales en el servidor (la primera página que llega con
 * el HTML) y en el navegador (lo que se pide después). Reciben el cliente de
 * Supabase ya armado: cuál sea lo decide quien llama.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase-tipos";
import {
  COLUMNAS_ADJUNTO,
  COLUMNAS_LECTURA,
  COLUMNAS_MENSAJE,
  aAdjunto,
  aLectura,
  aMensaje,
  type Adjunto,
  type FilaAdjunto,
  type FilaMensaje,
  type Lectura,
  type Mensaje,
  type Participante,
} from "./tipos";

type Cliente = SupabaseClient<Database>;

/** Cuántos mensajes trae cada página: la de entrada y cada "Cargar anteriores". */
export const MENSAJES_POR_PAGINA = 60;

/** Los adjuntos de unos mensajes, agrupados por mensaje. */
export async function leerAdjuntos(supabase: Cliente, mensajeIds: string[]): Promise<Map<string, Adjunto[]>> {
  const porMensaje = new Map<string, Adjunto[]>();
  if (mensajeIds.length === 0) return porMensaje;
  const { data, error } = await supabase
    .from("mensaje_adjuntos")
    .select(COLUMNAS_ADJUNTO)
    .in("mensaje_id", mensajeIds)
    .order("posicion");
  if (error) throw new Error(error.message);
  for (const fila of (data ?? []) as FilaAdjunto[]) {
    const a = aAdjunto(fila);
    porMensaje.set(a.mensajeId, [...(porMensaje.get(a.mensajeId) ?? []), a]);
  }
  return porMensaje;
}

/**
 * Una página de mensajes, de los más nuevos hacia atrás, ya en orden de lectura.
 * `hasta` es el `creado_en` del más viejo que ya se tiene: se pide con `<=` y no
 * `<` para no perder mensajes que comparten instante; los repetidos los quita
 * quien une.
 */
export async function leerMensajes(
  supabase: Cliente,
  conversacionId: string,
  hasta?: string,
): Promise<{ mensajes: Mensaje[]; hayAnteriores: boolean }> {
  let consulta = supabase
    .from("mensajes")
    .select(COLUMNAS_MENSAJE)
    .eq("conversacion_id", conversacionId)
    .order("creado_en", { ascending: false })
    .order("id", { ascending: false })
    .limit(MENSAJES_POR_PAGINA);
  if (hasta) consulta = consulta.lte("creado_en", hasta);

  const { data, error } = await consulta;
  if (error) throw new Error(error.message);
  const filas = ((data ?? []) as FilaMensaje[]).reverse();
  const adjuntos = await leerAdjuntos(
    supabase,
    filas.map((f) => f.id),
  );
  return {
    mensajes: filas.map((f) => aMensaje(f, adjuntos.get(f.id))),
    hayAnteriores: filas.length === MENSAJES_POR_PAGINA,
  };
}

/** Los mensajes posteriores a uno (inclusive), para ponerse al día sin Realtime. */
export async function leerDesde(supabase: Cliente, conversacionId: string, desde: string): Promise<Mensaje[]> {
  const { data, error } = await supabase
    .from("mensajes")
    .select(COLUMNAS_MENSAJE)
    .eq("conversacion_id", conversacionId)
    .gte("creado_en", desde)
    .order("creado_en")
    .limit(200);
  if (error) throw new Error(error.message);
  const filas = (data ?? []) as FilaMensaje[];
  const adjuntos = await leerAdjuntos(
    supabase,
    filas.map((f) => f.id),
  );
  return filas.map((f) => aMensaje(f, adjuntos.get(f.id)));
}

/** Quién vio cada uno de estos mensajes. */
export async function leerLecturas(supabase: Cliente, mensajeIds: string[]): Promise<Lectura[]> {
  if (mensajeIds.length === 0) return [];
  const { data, error } = await supabase.from("mensaje_lecturas").select(COLUMNAS_LECTURA).in("mensaje_id", mensajeIds);
  if (error) throw new Error(error.message);
  return (data ?? []).map(aLectura);
}

export async function leerParticipantes(supabase: Cliente, conversacionId: string): Promise<Participante[]> {
  const { data, error } = await supabase.rpc("participantes_conversacion", { p_conversacion_id: conversacionId });
  if (error) throw new Error(error.message);
  return (data ?? []).map((p) => ({ usuarioId: p.usuario_id, nombre: p.nombre, rol: p.rol, desde: p.desde }));
}

/** Todo lo que la conversación necesita para pintarse la primera vez. */
export interface ChatInicial {
  mensajes: Mensaje[];
  hayAnteriores: boolean;
  lecturas: Lectura[];
  participantes: Participante[];
}

export async function leerChatInicial(supabase: Cliente, conversacionId: string): Promise<ChatInicial> {
  const [{ mensajes, hayAnteriores }, participantes] = await Promise.all([
    leerMensajes(supabase, conversacionId),
    leerParticipantes(supabase, conversacionId),
  ]);
  const lecturas = await leerLecturas(
    supabase,
    mensajes.map((m) => m.id),
  );
  return { mensajes, hayAnteriores, lecturas, participantes };
}
