"use server";

/**
 * Guardar las fotos PNG de los modelos 3D (ver `lib/cad/miniatura.ts`, que las
 * saca en el navegador). Una para cada producto del catálogo con modelo y otra
 * para cada versión guardada de un diseño.
 */

import { z } from "zod";
import { exigirAdmin, perfilConCad } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase-servidor";
import { mensajeDeError } from "@/lib/errores";
import { deParametros } from "@/lib/cad/disenos-servidor";
import { PLANTILLA_LIBRE } from "@/lib/cad/tipos";
import { BUCKET_MINIATURAS, urlMiniatura } from "@/lib/cad/miniatura-url";

const MAX_BYTES = 1024 * 1024;

/** El PNG que mandó el navegador, revisado. */
function leerPng(form: FormData): Blob {
  const archivo = form.get("archivo");
  if (!(archivo instanceof Blob) || archivo.size === 0) throw new Error("Falta la imagen.");
  if (archivo.type !== "image/png") throw new Error("La imagen debe ser PNG.");
  if (archivo.size > MAX_BYTES) throw new Error("La imagen es demasiado grande.");
  return archivo;
}

/** Los parámetros con las claves ordenadas, para comparar dos versiones. */
function firma(plantilla: string, parametros: Record<string, unknown>): string {
  const ordenados = Object.keys(parametros)
    .sort()
    .map((k) => [k, parametros[k]]);
  return JSON.stringify([plantilla, ordenados]);
}

const esquemaDiseno = z.object({
  disenoId: z.uuid("El diseño no es válido."),
  plantilla: z.string().regex(/^[a-z0-9_-]{1,80}$/, "La plantilla no es válida."),
  parametros: z.string().max(50_000),
});

/**
 * La foto de la versión vigente de un diseño. Se manda con la plantilla y los
 * parámetros que se fotografiaron: si entretanto se guardó otra versión, o la
 * vigente ya tiene foto, no se hace nada. Devuelve si la guardó.
 */
export async function guardarMiniaturaDiseno(form: FormData): Promise<boolean> {
  // Se llama sola desde el visor: sin permiso no se hace nada (ni se redirige).
  if (!(await perfilConCad())) return false;
  const datos = esquemaDiseno.safeParse({
    disenoId: form.get("disenoId"),
    plantilla: form.get("plantilla"),
    parametros: form.get("parametros"),
  });
  if (!datos.success) throw new Error(datos.error.issues[0]?.message ?? "Los datos no son válidos.");
  const { disenoId, plantilla } = datos.data;
  let parametros: Record<string, unknown>;
  try {
    parametros = JSON.parse(datos.data.parametros) as Record<string, unknown>;
  } catch {
    throw new Error("Los parámetros no son válidos.");
  }
  const png = leerPng(form);

  const supabase = await clienteServidor();
  const { data: diseno, error } = await supabase
    .from("cad_disenos")
    .select("version_actual")
    .eq("id", disenoId)
    .maybeSingle();
  if (error) throw new Error(mensajeDeError(error));
  if (!diseno || diseno.version_actual === 0) return false;

  const { data: version, error: errorVersion } = await supabase
    .from("cad_diseno_versiones")
    .select("id, plantilla, parametros, miniatura_path")
    .eq("diseno_id", disenoId)
    .eq("version", diseno.version_actual)
    .maybeSingle();
  if (errorVersion) throw new Error(mensajeDeError(errorVersion));
  if (!version || version.miniatura_path) return false;
  if (version.plantilla !== plantilla) return false;
  // Un diseño libre no tiene parámetros que comparar: su código vive en la versión.
  if (plantilla !== PLANTILLA_LIBRE && firma(plantilla, deParametros(version.parametros)) !== firma(plantilla, parametros)) {
    return false;
  }

  const ruta = `disenos/${version.id}.png`;
  const { error: errorSubida } = await supabase.storage
    .from(BUCKET_MINIATURAS)
    .upload(ruta, png, { contentType: "image/png", upsert: true });
  if (errorSubida) throw new Error(`No se pudo guardar la miniatura: ${errorSubida.message}`);

  const { error: errorFila } = await supabase
    .from("cad_diseno_versiones")
    .update({ miniatura_path: ruta })
    .eq("id", version.id)
    .is("miniatura_path", null);
  if (errorFila) throw new Error(mensajeDeError(errorFila));
  return true;
}

const esquemaCodigo = z.string().regex(/^[A-Z0-9-]{1,20}$/, "El producto no es válido.");

/**
 * La foto del modelo 3D de un producto del catálogo (`pt_productos.miniatura_path`;
 * `imagen_url` es su foto de referencia y no se toca). Cada foto va con un nombre
 * nuevo para que el navegador no muestre la anterior de su caché; la anterior se
 * borra. Devuelve la URL pública.
 */
export async function guardarMiniaturaProducto(form: FormData): Promise<string> {
  await exigirAdmin();
  const codigo = esquemaCodigo.safeParse(form.get("codigo"));
  if (!codigo.success) throw new Error(codigo.error.issues[0]?.message ?? "El producto no es válido.");
  const png = leerPng(form);

  const supabase = await clienteServidor();
  const { data: producto, error } = await supabase
    .from("pt_productos")
    .select("miniatura_path")
    .eq("codigo", codigo.data)
    .maybeSingle();
  if (error) throw new Error(mensajeDeError(error));
  if (!producto) throw new Error("El producto ya no existe.");

  const ruta = `productos/${codigo.data}-${Date.now()}.png`;
  const { error: errorSubida } = await supabase.storage
    .from(BUCKET_MINIATURAS)
    .upload(ruta, png, { contentType: "image/png" });
  if (errorSubida) throw new Error(`No se pudo guardar la miniatura: ${errorSubida.message}`);

  const { error: errorFila } = await supabase
    .from("pt_productos")
    .update({ miniatura_path: ruta })
    .eq("codigo", codigo.data);
  if (errorFila) {
    await supabase.storage.from(BUCKET_MINIATURAS).remove([ruta]);
    throw new Error(mensajeDeError(errorFila));
  }

  // La foto anterior ya no la usa nadie.
  if (producto.miniatura_path) {
    const { error: errorBorrar } = await supabase.storage.from(BUCKET_MINIATURAS).remove([producto.miniatura_path]);
    if (errorBorrar) console.error("[miniaturas] borrar la anterior", errorBorrar.message);
  }
  return urlMiniatura(ruta)!;
}
