/**
 * Los proyectos de diseños, del lado del servidor (migración 20261226000100).
 *
 * Como `disenos-servidor.ts`: con la sesión de quien pide, y la RLS manda. Quién
 * puede llamar a esto lo comprueban las acciones y el route handler antes.
 */

import { clienteServidor } from "@/lib/supabase-servidor";
import { mensajeDeError } from "@/lib/errores";
import { copiarAdjuntos } from "@/lib/cad/adjuntos-servidor";
import type { AdjuntoCad } from "@/lib/cad/adjuntos";
import { agregarMensaje, crearDisenoEnProyecto, listarDisenos } from "@/lib/cad/disenos-servidor";
import {
  MAX_DISENOS_POR_LLAMADA,
  RESPUESTA_INICIAL_DE_DISENO,
  mensajeInicialDeDiseno,
  resumenDeProyecto,
  type ResumenProyecto,
} from "@/lib/cad/proyectos";
import type { DisenoCad } from "@/lib/cad/tipos";

export type ProyectoCad = {
  id: string;
  nombre: string;
  creado_en: string;
  actualizado_en: string;
};

export type ProyectoConResumen = ProyectoCad & { resumen: ResumenProyecto };

export async function crearProyecto(nombre: string): Promise<{ id: string }> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase.from("cad_proyectos").insert({ nombre }).select("id").single();
  if (error) throw new Error(mensajeDeError(error));
  return { id: data.id };
}

export async function renombrarProyecto(id: string, nombre: string): Promise<void> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase.from("cad_proyectos").update({ nombre }).eq("id", id).select("id");
  if (error) throw new Error(mensajeDeError(error));
  if (!data?.length) throw new Error("El proyecto ya no está disponible. Recarga la página.");
}

/** Borra el proyecto; sus diseños quedan sueltos. La base solo deja a quien lo creó o a Administración. */
export async function eliminarProyecto(id: string): Promise<void> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase.from("cad_proyectos").delete().eq("id", id).select("id");
  if (error) throw new Error(mensajeDeError(error));
  if (!data?.length) throw new Error("No se pudo borrar el proyecto: ya no existe o es de otra persona.");
}

/** Los proyectos, el tocado más recientemente primero, con cuántos diseños están listos. */
export async function listarProyectos(): Promise<ProyectoConResumen[]> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from("cad_proyectos")
    .select("id, nombre, creado_en, actualizado_en")
    .order("actualizado_en", { ascending: false });
  if (error) throw new Error(`No se pudieron leer los proyectos: ${error.message}`);
  if (!data?.length) return [];

  const disenos = await listarDisenos({ soloEnProyectos: true });
  const porProyecto = new Map<string, DisenoCad[]>();
  for (const d of disenos) {
    if (d.proyecto_id) porProyecto.set(d.proyecto_id, [...(porProyecto.get(d.proyecto_id) ?? []), d]);
  }
  return data.map((p) => ({ ...p, resumen: resumenDeProyecto((porProyecto.get(p.id) ?? []).map((d) => d.estado)) }));
}

/** Un proyecto con sus diseños, en su orden. `null` si no existe o no se puede ver. */
export async function obtenerProyecto(id: string): Promise<(ProyectoCad & { disenos: DisenoCad[]; resumen: ResumenProyecto }) | null> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from("cad_proyectos")
    .select("id, nombre, creado_en, actualizado_en")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer el proyecto: ${error.message}`);
  if (!data) return null;
  const disenos = await listarDisenos({ proyectoId: id });
  return { ...data, disenos, resumen: resumenDeProyecto(disenos.map((d) => d.estado)) };
}

/** Saca un diseño de su proyecto: queda suelto. */
export async function quitarDeProyecto(disenoId: string): Promise<void> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from("cad_disenos")
    .update({ proyecto_id: null, orden: null })
    .eq("id", disenoId)
    .select("id");
  if (error) throw new Error(mensajeDeError(error));
  if (!data?.length) throw new Error("El diseño ya no está disponible. Recarga la página.");
}

/** Mete un diseño suelto (o de otro proyecto) en `proyectoId`, al final. */
export async function asignarAProyecto(disenoId: string, proyectoId: string): Promise<void> {
  const supabase = await clienteServidor();
  const { data: ultimo, error: errorOrden } = await supabase
    .from("cad_disenos")
    .select("orden")
    .eq("proyecto_id", proyectoId)
    .order("orden", { ascending: false, nullsFirst: false })
    .limit(1);
  if (errorOrden) throw new Error(mensajeDeError(errorOrden));
  const { data, error } = await supabase
    .from("cad_disenos")
    .update({ proyecto_id: proyectoId, orden: (ultimo?.[0]?.orden ?? 0) + 1 })
    .eq("id", disenoId)
    .select("id");
  if (error) throw new Error(mensajeDeError(error));
  if (!data?.length) throw new Error("El diseño ya no está disponible. Recarga la página.");
}

/** Aprueba la versión vigente de los diseños personalizados en borrador del proyecto. Devuelve cuántos. */
export async function aprobarProyecto(id: string): Promise<number> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase.rpc("aprobar_proyecto", { p_proyecto: id });
  if (error) throw new Error(mensajeDeError(error));
  return data ?? 0;
}

/** El proyecto de un diseño, si lo tiene (para el enlace de la cabecera). */
export async function proyectoDeDiseno(proyectoId: string | null): Promise<{ id: string; nombre: string } | null> {
  if (!proyectoId) return null;
  const supabase = await clienteServidor();
  const { data, error } = await supabase.from("cad_proyectos").select("id, nombre").eq("id", proyectoId).maybeSingle();
  if (error) throw new Error(`No se pudo leer el proyecto: ${error.message}`);
  return data;
}

export type EntradaDisenosEnProyecto = {
  /** El diseño desde cuyo chat se pide: si no tiene proyecto, se crea uno y entra primero. */
  disenoActualId: string;
  /** Nombre del proyecto si hay que crearlo; si no, el del diseño actual. */
  proyectoNombre?: string;
  disenos: { nombre: string; descripcion: string }[];
  /** Los archivos de la conversación que se copian a cada diseño nuevo. */
  adjuntos: readonly AdjuntoCad[];
};

export type ResultadoDisenosEnProyecto = {
  proyecto: { id: string; nombre: string; creado: boolean };
  disenos: { id: string; nombre: string; ruta: string; adjuntosCopiados: number }[];
  /** Nombres de los archivos que no se pudieron copiar a algún diseño. */
  adjuntosFallidos: string[];
};

/**
 * Crea un diseño por cada elemento de `disenos` dentro de un proyecto, copia los
 * archivos de la conversación a cada uno y les deja un primer intercambio
 * (mensaje de la persona con su contexto y respuesta del asistente) para que
 * al abrirlos el asistente ya sepa de qué se trata. No genera geometría.
 */
export async function crearDisenosEnProyecto(
  entrada: EntradaDisenosEnProyecto,
  nombreDelDisenoActual: string,
): Promise<ResultadoDisenosEnProyecto> {
  if (entrada.disenos.length === 0 || entrada.disenos.length > MAX_DISENOS_POR_LLAMADA) {
    throw new Error(`Se pueden crear de 1 a ${MAX_DISENOS_POR_LLAMADA} diseños a la vez.`);
  }
  const supabase = await clienteServidor();

  const { data: actual, error } = await supabase
    .from("cad_disenos")
    .select("id, proyecto_id")
    .eq("id", entrada.disenoActualId)
    .maybeSingle();
  if (error) throw new Error(mensajeDeError(error));
  if (!actual) throw new Error("El diseño ya no está disponible. Recarga la página.");

  let proyecto: { id: string; nombre: string; creado: boolean };
  if (actual.proyecto_id) {
    const existente = await proyectoDeDiseno(actual.proyecto_id);
    if (!existente) throw new Error("El proyecto ya no está disponible. Recarga la página.");
    proyecto = { ...existente, creado: false };
  } else {
    const nombre = (entrada.proyectoNombre?.trim() || nombreDelDisenoActual).slice(0, 120);
    const { id } = await crearProyecto(nombre);
    await asignarAProyecto(entrada.disenoActualId, id);
    proyecto = { id, nombre, creado: true };
  }

  const nombres = entrada.disenos.map((d) => d.nombre);
  const creados: ResultadoDisenosEnProyecto["disenos"] = [];
  const fallidos = new Set<string>();

  for (const d of entrada.disenos) {
    const { id } = await crearDisenoEnProyecto(proyecto.id, d.nombre);
    const { copiados, fallidos: noCopiados } = await copiarAdjuntos(entrada.adjuntos, id);
    noCopiados.forEach((n) => fallidos.add(n));

    // Un par usuario/asistente, con el instante del segundo un poco después, para
    // que el historial que se le reenvía al modelo alterne bien los roles.
    const ahora = Date.now();
    await agregarMensaje({
      disenoId: id,
      rol: "usuario",
      contenido: mensajeInicialDeDiseno({ proyecto: proyecto.nombre, nombre: d.nombre, descripcion: d.descripcion, hermanos: nombres }),
      adjuntos: copiados,
      creadoEn: new Date(ahora).toISOString(),
    });
    await agregarMensaje({
      disenoId: id,
      rol: "asistente",
      contenido: RESPUESTA_INICIAL_DE_DISENO,
      creadoEn: new Date(ahora + 1000).toISOString(),
    });
    creados.push({ id, nombre: d.nombre, ruta: `/disenos/${id}`, adjuntosCopiados: copiados.length });
  }

  return { proyecto, disenos: creados, adjuntosFallidos: [...fallidos] };
}
