/**
 * Los diseños CAD guardados, del lado del servidor: el diseño, sus versiones y
 * la conversación con el asistente.
 *
 * Como el resto de la app, se lee y se escribe con la sesión de quien pide: la
 * RLS es la que dice que solo Administración entra aquí (`cad_*_admin`). Quién
 * puede llamar a esto lo comprueban las acciones y el route handler antes.
 *
 * La geometría no se guarda: una versión es una plantilla con sus parámetros, y
 * el motor (`lib/cad/motor.ts`) la vuelve a calcular cuando hace falta.
 */

import { clienteServidor } from "@/lib/supabase-servidor";
import { mensajeDeError } from "@/lib/errores";
import { leerMateriales, type MaterialesPorCopia } from "./materiales";
import type { Json } from "@/lib/supabase-tipos";
import { esquemaReferenciaCara, type ReferenciaCara } from "./caras";
import type { DisenoCad, MaterialDiseno, ParametrosCad } from "./tipos";
import { NOMBRE_POR_DEFECTO } from "./titulo";

export type OrigenVersion = "formulario" | "chat";

/** La versión vigente de un diseño, con de dónde vino el último cambio. */
export type VersionCad = {
  version: number;
  plantilla: string;
  versionPlantilla: number | null;
  parametros: ParametrosCad;
  origen: OrigenVersion;
  creadoEn: string;
};

/** Una herramienta que el asistente usó en un turno, como se guarda y se pinta. */
export type HerramientaUsada = {
  nombre: string;
  ok: boolean;
  /** Una línea para la ficha del chat: "Caja · 200 × 150 × 100 mm". */
  resumen: string;
};

export type RolMensajeCad = "usuario" | "asistente";

export type MensajeCad = {
  id: string;
  rol: RolMensajeCad;
  contenido: string;
  herramientas: HerramientaUsada[];
  /** Las caras del visor que la persona señaló con el mensaje. */
  referencias: ReferenciaCara[];
  creadoEn: string;
};

/** Lo que haya en `parametros`, quedándose con los valores planos que admite el motor. */
export function deParametros(valor: Json | null | undefined): ParametrosCad {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return {};
  const salida: ParametrosCad = {};
  for (const [clave, v] of Object.entries(valor)) {
    if (typeof v === "number" || typeof v === "boolean" || typeof v === "string") salida[clave] = v;
  }
  return salida;
}

function deHerramientas(valor: Json | null): HerramientaUsada[] {
  if (!Array.isArray(valor)) return [];
  const salida: HerramientaUsada[] = [];
  for (const h of valor) {
    if (!h || typeof h !== "object" || Array.isArray(h) || typeof h.nombre !== "string") continue;
    salida.push({
      nombre: h.nombre,
      ok: h.ok !== false,
      resumen: typeof h.resumen === "string" ? h.resumen : "",
    });
  }
  return salida;
}

/** Las caras guardadas con un mensaje; las que no se entiendan se saltan. */
export function deReferencias(valor: Json | null): ReferenciaCara[] {
  if (!Array.isArray(valor)) return [];
  const salida: ReferenciaCara[] = [];
  for (const r of valor) {
    const leida = esquemaReferenciaCara.safeParse(r);
    if (leida.success) salida.push(leida.data);
  }
  return salida;
}

interface FilaDiseno {
  id: string;
  nombre: string;
  version_actual: number;
  creado_en: string;
  actualizado_en: string;
}

interface FilaVersion {
  diseno_id: string;
  version: number;
  plantilla: string;
  version_plantilla: number | null;
  parametros: Json;
  origen: string;
  creado_en: string;
}

const COLUMNAS_DISENO = "id, nombre, version_actual, creado_en, actualizado_en";
const COLUMNAS_VERSION = "diseno_id, version, plantilla, version_plantilla, parametros, origen, creado_en";

const deDiseno = (d: FilaDiseno, v: FilaVersion | undefined): DisenoCad => ({
  id: d.id,
  nombre: d.nombre,
  // Recién creado no tiene versión: sin plantilla ni parámetros.
  plantilla: v?.plantilla ?? null,
  parametros: deParametros(v?.parametros),
  version: v ? v.version : 0,
  creado_en: d.creado_en,
  actualizado_en: d.actualizado_en,
});

/** De estos diseños, los que tienen al menos un mensaje en su conversación. */
async function idsConMensajes(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const supabase = await clienteServidor();
  const { data, error } = await supabase.from("cad_mensajes").select("diseno_id").in("diseno_id", ids);
  if (error) throw new Error(`No se pudieron leer los diseños: ${error.message}`);
  return new Set((data ?? []).map((m) => m.diseno_id));
}

/** Pasado este tiempo, un borrador sin tocar se borra al crear otro. */
const VIDA_BORRADOR_MS = 24 * 60 * 60 * 1000;

/**
 * Un diseño nuevo para `usuarioId`. Si ya tiene un borrador sin tocar (sin
 * versión ni conversación) se reutiliza ese en vez de crear otro, así entrar y
 * salir de "Nuevo diseño" no va dejando diseños vacíos. De paso se borran sus
 * borradores viejos; si eso falla, no importa.
 */
export async function crearOReusarBorrador(usuarioId: string): Promise<{ id: string }> {
  const supabase = await clienteServidor();
  const { data: candidatos, error } = await supabase
    .from("cad_disenos")
    .select("id, nombre, creado_en")
    .eq("creado_por", usuarioId)
    .eq("version_actual", 0)
    .order("creado_en", { ascending: false });
  if (error) throw new Error(mensajeDeError(error));

  const conMensajes = await idsConMensajes((candidatos ?? []).map((d) => d.id));
  const vacios = (candidatos ?? []).filter((d) => !conMensajes.has(d.id));

  const limite = Date.now() - VIDA_BORRADOR_MS;
  const [reciente, ...resto] = vacios;
  const viejos = resto.filter((d) => new Date(d.creado_en).getTime() < limite).map((d) => d.id);
  if (viejos.length > 0) {
    const { error: errorBorrar } = await supabase.from("cad_disenos").delete().in("id", viejos);
    if (errorBorrar) console.error("[cad] borrar borradores vacíos", errorBorrar.message);
  }

  if (reciente) return { id: reciente.id };

  const { data, error: errorCrear } = await supabase.from("cad_disenos").insert({}).select("id").single();
  if (errorCrear) throw new Error(mensajeDeError(errorCrear));
  return { id: data.id };
}

/**
 * Pone `nombre` solo si el diseño sigue con el nombre por defecto: así no se
 * pisa uno que la persona ya cambió a mano. Devuelve si lo cambió.
 */
export async function renombrarSiPorDefecto(disenoId: string, nombre: string): Promise<boolean> {
  const limpio = nombre.trim().slice(0, 120);
  if (!limpio || limpio === NOMBRE_POR_DEFECTO) return false;
  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from("cad_disenos")
    .update({ nombre: limpio })
    .eq("id", disenoId)
    .eq("nombre", NOMBRE_POR_DEFECTO)
    .select("id");
  if (error) throw new Error(mensajeDeError(error));
  return (data?.length ?? 0) > 0;
}

/** Todos los diseños, el tocado más recientemente primero. */
export async function listarDisenos(): Promise<DisenoCad[]> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from("cad_disenos")
    .select(COLUMNAS_DISENO)
    .order("actualizado_en", { ascending: false });
  if (error) throw new Error(`No se pudieron leer los diseños: ${error.message}`);
  let disenos = data;
  if (!disenos || disenos.length === 0) return [];

  // Los que no tienen versión ni conversación son borradores sin tocar: no se
  // listan, como un chat de Claude que todavía no tiene mensajes.
  const sinVersion = disenos.filter((d) => d.version_actual === 0).map((d) => d.id);
  const conMensajes = await idsConMensajes(sinVersion);
  disenos = disenos.filter((d) => d.version_actual > 0 || conMensajes.has(d.id));
  if (disenos.length === 0) return [];

  // Las versiones vigentes en una sola consulta. Se filtra por los números que
  // están en uso y se casa después: PostgREST no compara dos columnas entre sí.
  const conVersion = disenos.filter((d) => d.version_actual > 0);
  const vigentes = new Map<string, FilaVersion>();
  if (conVersion.length > 0) {
    const { data: versiones, error: errorVersiones } = await supabase
      .from("cad_diseno_versiones")
      .select(COLUMNAS_VERSION)
      .in("diseno_id", conVersion.map((d) => d.id))
      .in("version", [...new Set(conVersion.map((d) => d.version_actual))]);
    if (errorVersiones) throw new Error(`No se pudieron leer los diseños: ${errorVersiones.message}`);

    const actual = new Map(conVersion.map((d) => [d.id, d.version_actual]));
    for (const v of versiones ?? []) {
      if (actual.get(v.diseno_id) === v.version) vigentes.set(v.diseno_id, v);
    }
  }

  return disenos.map((d) => deDiseno(d, vigentes.get(d.id)));
}

async function leerDiseno(id: string): Promise<{ diseno: FilaDiseno; version: FilaVersion | undefined } | null> {
  const supabase = await clienteServidor();
  const { data: diseno, error } = await supabase
    .from("cad_disenos")
    .select(COLUMNAS_DISENO)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer el diseño: ${error.message}`);
  if (!diseno) return null;
  if (diseno.version_actual === 0) return { diseno, version: undefined };

  const { data: version, error: errorVersion } = await supabase
    .from("cad_diseno_versiones")
    .select(COLUMNAS_VERSION)
    .eq("diseno_id", id)
    .eq("version", diseno.version_actual)
    .maybeSingle();
  if (errorVersion) throw new Error(`No se pudo leer el diseño: ${errorVersion.message}`);
  return { diseno, version: version ?? undefined };
}

/** Un diseño con su versión vigente. `null` si no existe o no se puede ver. */
export async function obtenerDiseno(id: string): Promise<DisenoCad | null> {
  const leido = await leerDiseno(id);
  return leido ? deDiseno(leido.diseno, leido.version) : null;
}

/**
 * La versión vigente con su origen: el asistente necesita saber si lo último lo
 * cambió él o alguien desde el formulario. `null` si el diseño no tiene versión
 * todavía (o no existe).
 */
export async function obtenerVersionActual(disenoId: string): Promise<VersionCad | null> {
  const leido = await leerDiseno(disenoId);
  const v = leido?.version;
  if (!v) return null;
  return {
    version: v.version,
    plantilla: v.plantilla,
    versionPlantilla: v.version_plantilla,
    parametros: deParametros(v.parametros),
    origen: v.origen === "chat" ? "chat" : "formulario",
    creadoEn: v.creado_en,
  };
}

/**
 * Guarda una versión nueva y la deja como vigente. El número lo pone la base
 * (`guardar_version_diseno`), que es quien puede darlo sin carreras entre el
 * formulario y el asistente.
 */
export async function guardarVersionDiseno(entrada: {
  disenoId: string;
  plantilla: string;
  parametros: ParametrosCad;
  origen: OrigenVersion;
  versionPlantilla?: number | null;
  /** Sin material, la versión hereda el de la anterior (lo hace la base). */
  material?: MaterialDiseno | null;
  /** Foto del acomodo en planchas (`AcomodoGuardado` de `lib/cad/materiales.ts`). */
  acomodo?: Json | null;
  /** El material propio de cada copia. Sin él (y sin material), se heredan los de la anterior. */
  materiales?: MaterialesPorCopia | null;
}): Promise<{ version: number }> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase.rpc("guardar_version_diseno", {
    p_diseno_id: entrada.disenoId,
    p_plantilla: entrada.plantilla,
    p_parametros: entrada.parametros,
    p_origen: entrada.origen,
    p_version_plantilla: entrada.versionPlantilla ?? undefined,
    p_grupo_plancha_id: entrada.material?.grupoPlanchaId ?? undefined,
    p_color: entrada.material?.color ?? undefined,
    p_acomodo: entrada.acomodo ?? undefined,
    p_materiales: entrada.materiales ? ({ porCopia: entrada.materiales } as unknown as Json) : undefined,
  });
  if (error) throw new Error(mensajeDeError(error));
  return { version: data };
}

/** El material propio de cada copia en la versión vigente. Vacío si no hay. */
export async function obtenerMaterialesPorCopia(disenoId: string): Promise<MaterialesPorCopia> {
  const supabase = await clienteServidor();
  const { data: diseno, error } = await supabase
    .from("cad_disenos")
    .select("version_actual")
    .eq("id", disenoId)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer el diseño: ${error.message}`);
  if (!diseno || diseno.version_actual === 0) return {};
  const { data, error: errorVersion } = await supabase
    .from("cad_diseno_versiones")
    .select("materiales")
    .eq("diseno_id", disenoId)
    .eq("version", diseno.version_actual)
    .maybeSingle();
  if (errorVersion) throw new Error(`No se pudo leer el material del diseño: ${errorVersion.message}`);
  return leerMateriales(data?.materiales);
}

/** El material de la versión vigente de un diseño. `null` si no tiene. */
export async function obtenerMaterialDiseno(disenoId: string): Promise<MaterialDiseno | null> {
  const supabase = await clienteServidor();
  const { data: diseno, error } = await supabase
    .from("cad_disenos")
    .select("version_actual")
    .eq("id", disenoId)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer el diseño: ${error.message}`);
  if (!diseno || diseno.version_actual === 0) return null;

  const { data, error: errorVersion } = await supabase
    .from("cad_diseno_versiones")
    .select("grupo_plancha_id, color")
    .eq("diseno_id", disenoId)
    .eq("version", diseno.version_actual)
    .maybeSingle();
  if (errorVersion) throw new Error(`No se pudo leer el material del diseño: ${errorVersion.message}`);
  if (!data?.grupo_plancha_id) return null;
  return { grupoPlanchaId: data.grupo_plancha_id, color: data.color };
}

/**
 * La conversación de un diseño, en orden. Con `limite`, solo los últimos: es lo
 * que se le reenvía al modelo.
 */
export async function listarMensajes(disenoId: string, limite?: number): Promise<MensajeCad[]> {
  const supabase = await clienteServidor();
  let consulta = supabase
    .from("cad_mensajes")
    .select("id, rol, contenido, herramientas, referencias, creado_en")
    .eq("diseno_id", disenoId)
    .order("creado_en", { ascending: false });
  if (limite) consulta = consulta.limit(limite);

  const { data, error } = await consulta;
  if (error) throw new Error(`No se pudo leer la conversación: ${error.message}`);

  return (data ?? []).reverse().map((m) => ({
    id: m.id,
    rol: m.rol === "usuario" ? "usuario" : "asistente",
    contenido: m.contenido,
    herramientas: deHerramientas(m.herramientas),
    referencias: deReferencias(m.referencias),
    creadoEn: m.creado_en,
  }));
}

/** Añade un mensaje a la conversación. */
export async function agregarMensaje(entrada: {
  disenoId: string;
  rol: RolMensajeCad;
  contenido: string;
  herramientas?: HerramientaUsada[];
  referencias?: ReferenciaCara[];
  /** Solo para ordenar los dos mensajes de un turno que se guardan a la vez. */
  creadoEn?: string;
}): Promise<void> {
  const supabase = await clienteServidor();
  const { error } = await supabase.from("cad_mensajes").insert({
    diseno_id: entrada.disenoId,
    rol: entrada.rol,
    contenido: entrada.contenido,
    herramientas: entrada.herramientas?.length ? entrada.herramientas : null,
    referencias: entrada.referencias?.length ? (entrada.referencias as unknown as Json) : null,
    ...(entrada.creadoEn ? { creado_en: entrada.creadoEn } : {}),
  });
  if (error) throw new Error(mensajeDeError(error));
}
