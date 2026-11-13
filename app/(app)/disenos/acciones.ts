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
import { exigirAdmin, exigirCad } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase-servidor";
import { mensajeDeError } from "@/lib/errores";
import {
  crearOReusarBorrador,
  guardarVersionDiseno,
  listarMensajes,
  renombrarSiPorDefecto,
  type MensajeCad,
} from "@/lib/cad/disenos-servidor";
import { obtenerPlantilla } from "@/lib/cad/motor";
import { aprobarVersionLibre, guardarMaterialLibre, obtenerVersionLibre } from "@/lib/cad/libre-servidor";
import type { MaterialDiseno, ParametrosCad, VersionLibreCad } from "@/lib/cad/tipos";
import type { Json } from "@/lib/supabase-tipos";

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

/**
 * Un diseño vacío, sin plantilla todavía: la primera versión llega al elegirla.
 * Si quien pide ya tiene uno sin tocar, se reutiliza ese (ver
 * `crearOReusarBorrador`).
 */
export async function crearDiseno(): Promise<{ id: string }> {
  const perfil = await exigirCad();
  return crearOReusarBorrador(perfil.id);
}

/** "porta_afiche_a4" → "Porta afiche a4", por si el motor no da el nombre. */
function nombreDeCodigo(codigo: string): string {
  const t = codigo.replace(/[_-]+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** El material elegido: un grupo del catálogo y, si el grupo lo pide, el color. */
const esquemaMaterial = z.object({
  grupoPlanchaId: z.uuid("El material no es válido."),
  color: z.string().trim().min(1).max(80).nullable(),
});

/**
 * La foto del acomodo: se guarda tal cual para saber qué se mandó a cortar, así
 * que basta con que sea un objeto y no sea enorme.
 */
const esquemaAcomodo = z
  .record(z.string(), z.unknown())
  .refine((a) => JSON.stringify(a).length <= 200_000, "El acomodo es demasiado grande.");

/**
 * Una versión nueva desde el formulario. Las del asistente las guarda el chat.
 * Sin `material`, la versión hereda el de la anterior.
 */
export async function guardarVersion(
  disenoId: string,
  plantilla: string,
  parametros: ParametrosCad,
  material?: MaterialDiseno | null,
  acomodo?: Record<string, unknown> | null,
): Promise<{ version: number }> {
  await exigirCad();

  const id = validar(esquemaId, disenoId);
  const codigo = validar(esquemaPlantilla, plantilla);
  const guardada = await guardarVersionDiseno({
    disenoId: id,
    plantilla: codigo,
    parametros: validar(esquemaParametros, parametros),
    origen: "formulario",
    material: material ? validar(esquemaMaterial, material) : null,
    acomodo: material && acomodo ? (validar(esquemaAcomodo, acomodo) as Json) : null,
  });

  // Hecho a mano sin pasar por el chat: el diseño toma el nombre de la plantilla.
  // Si ya tenía nombre (puesto a mano o por el chat) no se toca.
  if (guardada.version === 1) {
    try {
      const nombre = (await obtenerPlantilla(codigo).catch(() => null))?.nombre ?? nombreDeCodigo(codigo);
      await renombrarSiPorDefecto(id, nombre);
    } catch (e) {
      console.error("[cad] nombrar por la plantilla", e);
    }
  }
  return guardada;
}

/**
 * El material de un diseño libre (hecho con código): guarda el mismo código de
 * la versión vigente —lo lee la base, no el navegador— como versión nueva con el
 * material y su acomodo. Si el código ya estaba aprobado, sigue aprobado.
 * Devuelve la versión libre que quedó vigente (número y estado).
 */
export async function guardarMaterialDisenoLibre(
  disenoId: string,
  material: MaterialDiseno,
  acomodo?: Record<string, unknown> | null,
): Promise<VersionLibreCad | null> {
  await exigirCad();

  const id = validar(esquemaId, disenoId);
  await guardarMaterialLibre({
    disenoId: id,
    material: validar(esquemaMaterial, material),
    acomodo: acomodo ? (validar(esquemaAcomodo, acomodo) as Json) : null,
    origen: "formulario",
  });
  return obtenerVersionLibre(id);
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
  // La FK de `cotizacion_productos.diseno_version_id` lo impide si está cotizado.
  if (error?.code === "23503")
    throw new Error("Este diseño está en una cotización: no se puede borrar.");
  if (error) throw new Error(mensajeDeError(error));
  if (data.length === 0) throw new Error(ERROR_SIN_DISENO);
}

/** La conversación guardada de un diseño, para pintarla al abrirlo. */
export async function cargarMensajes(disenoId: string): Promise<MensajeCad[]> {
  await exigirCad();
  return listarMensajes(validar(esquemaId, disenoId));
}

/**
 * Aprueba la versión libre vigente de un diseño (diseño personalizado hecho con
 * código): desde aquí ya se puede bajar el DXF. Solo Administración; la base lo
 * vuelve a comprobar (`aprobar_version_diseno`).
 */
export async function aprobarDisenoLibre(disenoId: string, version: number): Promise<void> {
  await exigirAdmin();
  await aprobarVersionLibre(
    validar(esquemaId, disenoId),
    validar(z.number().int().min(1, "La versión no es válida."), version),
  );
}
