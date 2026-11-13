/**
 * Las versiones de diseño libre, del lado del servidor
 * (`supabase/migrations/20261118000100_cad_diseno_libre.sql`).
 *
 * Una versión libre guarda el código build123d en vez de los parámetros, con
 * `plantilla = 'libre'`, y nace en borrador. La geometría no se guarda: se
 * vuelve a calcular ejecutando el código en el sandbox (`lib/cad/sandbox.ts`).
 *
 * Igual que `disenos-servidor.ts`: con la sesión de quien pide, y la RLS manda.
 */

import { clienteServidor } from "@/lib/supabase-servidor";
import { mensajeDeError } from "@/lib/errores";
import type { VersionLibreCad } from "./tipos";

/** La versión vigente si es libre; `null` si es de plantilla, no hay versión o no existe. */
export async function obtenerVersionLibre(
  disenoId: string,
): Promise<VersionLibreCad | null> {
  const supabase = await clienteServidor();
  const { data: diseno, error } = await supabase
    .from("cad_disenos")
    .select("version_actual")
    .eq("id", disenoId)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer el diseño: ${error.message}`);
  if (!diseno || diseno.version_actual === 0) return null;

  const { data: v, error: errorVersion } = await supabase
    .from("cad_diseno_versiones")
    .select("version, codigo, estado, aprobado_en")
    .eq("diseno_id", disenoId)
    .eq("version", diseno.version_actual)
    .maybeSingle();
  if (errorVersion)
    throw new Error(`No se pudo leer el diseño: ${errorVersion.message}`);
  if (!v?.codigo) return null;
  return {
    version: v.version,
    codigo: v.codigo,
    estado: v.estado === "aprobado" ? "aprobado" : "borrador",
    aprobadoEn: v.aprobado_en,
  };
}

/** Guarda el código como versión nueva, en borrador. */
export async function guardarVersionLibre(entrada: {
  disenoId: string;
  codigo: string;
  origen?: "chat" | "formulario";
}): Promise<{ version: number }> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase.rpc("guardar_version_diseno_libre", {
    p_diseno_id: entrada.disenoId,
    p_codigo: entrada.codigo,
    p_origen: entrada.origen ?? "chat",
  });
  if (error) throw new Error(mensajeDeError(error));
  return { version: data };
}

/** Aprueba una versión libre. La base exige Administración. */
export async function aprobarVersionLibre(
  disenoId: string,
  version: number,
): Promise<void> {
  const supabase = await clienteServidor();
  const { error } = await supabase.rpc("aprobar_version_diseno", {
    p_diseno_id: disenoId,
    p_version: version,
  });
  if (error) throw new Error(mensajeDeError(error));
}
