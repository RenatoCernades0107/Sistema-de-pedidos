/**
 * Las versiones de diseño libre, del lado del servidor
 * (`supabase/migrations/20261118000100_cad_diseno_libre.sql` y
 * `20261122000100_cad_libre_material.sql`).
 *
 * Una versión libre guarda el código build123d en vez de los parámetros, con
 * `plantilla = 'libre'`, y nace en borrador. La geometría no se guarda: se
 * vuelve a calcular ejecutando el código en el sandbox (`lib/cad/sandbox.ts`).
 * Como las de plantilla, puede llevar material y la foto del acomodo.
 *
 * Igual que `disenos-servidor.ts`: con la sesión de quien pide, y la RLS manda.
 */

import { clienteServidor } from "@/lib/supabase-servidor";
import { mensajeDeError } from "@/lib/errores";
import type { MaterialesPorCopia } from "./materiales";
import type { Json } from "@/lib/supabase-tipos";
import type { MaterialDiseno, VersionLibreCad } from "./tipos";

/**
 * La versión vigente si es libre, con el acomodo guardado (lo que hace falta
 * para producción); `null` si es de plantilla, no hay versión o no existe.
 */
export async function obtenerProduccionLibre(
  disenoId: string,
): Promise<(VersionLibreCad & { acomodo: Json | null }) | null> {
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
    .select("version, codigo, estado, aprobado_en, acomodo")
    .eq("diseno_id", disenoId)
    .eq("version", diseno.version_actual)
    .maybeSingle();
  if (errorVersion) throw new Error(`No se pudo leer el diseño: ${errorVersion.message}`);
  if (!v?.codigo) return null;
  return {
    version: v.version,
    codigo: v.codigo,
    estado: v.estado === "aprobado" ? "aprobado" : "borrador",
    aprobadoEn: v.aprobado_en,
    acomodo: v.acomodo,
  };
}

/** La versión vigente si es libre; `null` si es de plantilla, no hay versión o no existe. */
export async function obtenerVersionLibre(disenoId: string): Promise<VersionLibreCad | null> {
  const v = await obtenerProduccionLibre(disenoId);
  if (!v) return null;
  return { version: v.version, codigo: v.codigo, estado: v.estado, aprobadoEn: v.aprobadoEn };
}

/**
 * Guarda el código como versión nueva. Nace en borrador, salvo que sea el mismo
 * código que la versión anterior ya aprobada (elegir material no cambia la
 * geometría): entonces conserva la aprobación. Lo decide la base.
 *
 * Sin `material`, la versión hereda el de la anterior; el `acomodo` no se hereda.
 */
export async function guardarVersionLibre(entrada: {
  disenoId: string;
  codigo: string;
  origen?: "chat" | "formulario";
  material?: MaterialDiseno | null;
  /** Foto del acomodo en planchas (`AcomodoGuardado` de `lib/cad/materiales.ts`). */
  acomodo?: Json | null;
  /** El material propio de cada copia. Sin él (y sin material), se heredan los de la anterior. */
  materiales?: MaterialesPorCopia | null;
}): Promise<{ version: number }> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase.rpc("guardar_version_diseno_libre", {
    p_diseno_id: entrada.disenoId,
    p_codigo: entrada.codigo,
    p_origen: entrada.origen ?? "chat",
    p_grupo_plancha_id: entrada.material?.grupoPlanchaId ?? undefined,
    p_color: entrada.material?.color ?? undefined,
    p_acomodo: entrada.acomodo ?? undefined,
    p_materiales: entrada.materiales ? ({ porCopia: entrada.materiales } as unknown as Json) : undefined,
  });
  if (error) throw new Error(mensajeDeError(error));
  return { version: data };
}

/**
 * Elige el material de la versión libre vigente: guarda el MISMO código (leído de
 * la base, nunca del navegador) como versión nueva con el material y su acomodo.
 */
export async function guardarMaterialLibre(entrada: {
  disenoId: string;
  material: MaterialDiseno | null;
  acomodo: Json | null;
  materiales?: MaterialesPorCopia | null;
  origen?: "chat" | "formulario";
}): Promise<{ version: number }> {
  const libre = await obtenerVersionLibre(entrada.disenoId);
  if (!libre) throw new Error("Este diseño no tiene una versión personalizada vigente.");
  return guardarVersionLibre({
    disenoId: entrada.disenoId,
    codigo: libre.codigo,
    origen: entrada.origen ?? "formulario",
    material: entrada.material,
    acomodo: entrada.acomodo,
    materiales: entrada.materiales,
  });
}

/** Aprueba una versión libre. La base exige Administración. */
export async function aprobarVersionLibre(disenoId: string, version: number): Promise<void> {
  const supabase = await clienteServidor();
  const { error } = await supabase.rpc("aprobar_version_diseno", {
    p_diseno_id: disenoId,
    p_version: version,
  });
  if (error) throw new Error(mensajeDeError(error));
}
