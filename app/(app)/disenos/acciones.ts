"use server";

/**
 * Lo que se guarda desde `/disenos`: crear un diseño, guardar una versión desde
 * el formulario, renombrarlo y borrarlo.
 *
 * Las mismas reglas que el resto de acciones: se escribe con la sesión de quien
 * pide, se revalida con Zod —el navegador no es de fiar— y un UPDATE que no toca
 * filas se dice. Fallan lanzando: quien llama las envuelve en su `try`.
 *
 * Hablar con el asistente NO está aquí: va por `app/api/disenos/chat`, porque la
 * respuesta llega en streaming y una Server Action no transmite.
 */

import { z } from "zod";
import { exigirCad } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase-servidor";
import { mensajeDeError } from "@/lib/errores";
import { guardarVersionDiseno, listarMensajes, type MensajeCad } from "@/lib/cad/disenos-servidor";
import type { ParametrosCad } from "@/lib/cad/tipos";

const ERROR_SIN_DISENO = "El diseño ya no está disponible. Recarga la página.";

const esquemaId = z.uuid("El diseño no es válido.");

const esquemaNombre = z
  .string()
  .trim()
  .min(1, "El nombre no puede quedar vacío.")
  .max(120, "El nombre es demasiado largo.");

/** El código de una plantilla del motor: "caja", "porta_afiche_a4". */
const esquemaPlantilla = z
  .string()
  .trim()
  .regex(/^[a-z0-9_-]{1,80}$/, "La plantilla no es válida.");

/** Solo valores planos, como los del esquema del motor (`docs/API_cad.md`). */
const esquemaParametros = z
  .record(z.string().min(1).max(80), z.union([z.number(), z.boolean(), z.string().max(500)]))
  .refine((p) => Object.keys(p).length <= 100, "El diseño tiene demasiados parámetros.");

/** Lo validado, o el primer problema dicho en una frase. */
function validar<T>(esquema: z.ZodType<T>, valor: unknown): T {
  const r = esquema.safeParse(valor);
  if (!r.success) throw new Error(r.error.issues[0]?.message ?? "Los datos no son válidos.");
  return r.data;
}

/** Un diseño vacío, sin plantilla todavía: la primera versión llega al elegirla. */
export async function crearDiseno(): Promise<{ id: string }> {
  await exigirCad();

  const supabase = await clienteServidor();
  const { data, error } = await supabase.from("cad_disenos").insert({}).select("id").single();
  if (error) throw new Error(mensajeDeError(error));
  return { id: data.id };
}

/** Una versión nueva desde el formulario. Las del asistente las guarda el chat. */
export async function guardarVersion(
  disenoId: string,
  plantilla: string,
  parametros: ParametrosCad,
): Promise<{ version: number }> {
  await exigirCad();

  return guardarVersionDiseno({
    disenoId: validar(esquemaId, disenoId),
    plantilla: validar(esquemaPlantilla, plantilla),
    parametros: validar(esquemaParametros, parametros),
    origen: "formulario",
  });
}

export async function renombrarDiseno(disenoId: string, nombre: string): Promise<void> {
  await exigirCad();
  const id = validar(esquemaId, disenoId);
  const limpio = validar(esquemaNombre, nombre);

  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from("cad_disenos")
    .update({ nombre: limpio })
    .eq("id", id)
    .select("id");
  if (error) throw new Error(mensajeDeError(error));
  if (data.length === 0) throw new Error(ERROR_SIN_DISENO);
}

/** Se lleva sus versiones y su conversación (cascada en la base). */
export async function eliminarDiseno(disenoId: string): Promise<void> {
  await exigirCad();
  const id = validar(esquemaId, disenoId);

  const supabase = await clienteServidor();
  const { data, error } = await supabase.from("cad_disenos").delete().eq("id", id).select("id");
  if (error) throw new Error(mensajeDeError(error));
  if (data.length === 0) throw new Error(ERROR_SIN_DISENO);
}

/** La conversación guardada de un diseño, para pintarla al abrirlo. */
export async function cargarMensajes(disenoId: string): Promise<MensajeCad[]> {
  await exigirCad();
  return listarMensajes(validar(esquemaId, disenoId));
}
