"use server";

/**
 * Lo que Administración cambia en `/agente-whatsapp`: los archivos de la base de
 * conocimiento, los ajustes del agente y las conversaciones de prueba.
 *
 * El procesamiento de un archivo (leerlo, trocearlo, vectorizarlo) y la
 * respuesta del agente van por route handlers: tardan más de lo que conviene
 * en una Server Action.
 */

import { refresh } from "next/cache";
import { z } from "zod";
import { exigirAgenteWhatsapp } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase-servidor";
import { mensajeDeError } from "@/lib/errores";
import type { Json } from "@/lib/supabase-tipos";
import { CLAVE_AJUSTES_AGENTE, esquemaAjustesAgente } from "@/lib/agente-whatsapp/ajustes";
import { cargarMensajesDePrueba } from "@/lib/agente-whatsapp/pruebas-servidor";
import { leerAnuncio, type MensajePrueba } from "@/lib/agente-whatsapp/pruebas";
import {
  BUCKET_CONOCIMIENTO,
  MAX_BYTES_DOCUMENTO,
  MIMES_DOCUMENTO,
  TIPOS_DOCUMENTO,
} from "@/lib/agente-whatsapp/tipos";

type Resultado<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const fallo = (error: string) => ({ ok: false as const, error });

const id = z.uuid("El identificador no es válido");

/** Un nombre de archivo que se puede usar en una ruta de Storage. */
function nombreSeguro(nombre: string, mime: string): string {
  const extension = mime === "application/pdf" ? "pdf" : mime.split("/")[1];
  const base = nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${base || "archivo"}.${extension}`;
}

/* ── Documentos ────────────────────────────────────────────────────────────── */

const esquemaNuevoDocumento = z.object({
  nombre: z.string().trim().min(1, "El archivo no tiene nombre").max(200, "El nombre es demasiado largo"),
  mime: z.enum(MIMES_DOCUMENTO, "Solo PDF o imágenes (PNG, JPG, WEBP)"),
  tamano: z
    .number()
    .int()
    .positive("El archivo está vacío")
    .max(MAX_BYTES_DOCUMENTO, `El archivo pesa más de ${MAX_BYTES_DOCUMENTO / 1024 / 1024} MB`),
  tipo: z.enum(Object.keys(TIPOS_DOCUMENTO) as [keyof typeof TIPOS_DOCUMENTO], "Elige qué tipo de archivo es"),
});

/**
 * Registra un archivo antes de subirlo: el navegador lo sube después a la ruta
 * que devuelve (la política del bucket solo deja subir a la ruta de un
 * documento registrado) y luego pide procesarlo.
 */
export async function crearDocumento(entrada: unknown): Promise<Resultado<{ id: string; ruta: string }>> {
  await exigirAgenteWhatsapp();
  const datos = esquemaNuevoDocumento.safeParse(entrada);
  if (!datos.success) return fallo(datos.error.issues[0]?.message ?? "Los datos no son válidos.");

  const nuevo = crypto.randomUUID();
  const ruta = `${nuevo}/${nombreSeguro(datos.data.nombre, datos.data.mime)}`;
  const supabase = await clienteServidor();
  const { error } = await supabase.from("agente_documentos").insert({
    id: nuevo,
    nombre: datos.data.nombre,
    mime: datos.data.mime,
    tamano: datos.data.tamano,
    tipo: datos.data.tipo,
    ruta,
  });
  if (error) return fallo(mensajeDeError(error));
  return { ok: true, id: nuevo, ruta };
}

/** Borra un documento, sus fragmentos y su archivo. */
export async function eliminarDocumento(documentoId: unknown): Promise<Resultado> {
  await exigirAgenteWhatsapp();
  const r = id.safeParse(documentoId);
  if (!r.success) return fallo("El documento no es válido.");
  const supabase = await clienteServidor();
  const { data: doc } = await supabase.from("agente_documentos").select("ruta").eq("id", r.data).maybeSingle();
  if (!doc) return fallo("El documento ya no existe.");
  // Primero el archivo: si falla, el documento sigue ahí y se puede reintentar.
  const { error: errorArchivo } = await supabase.storage.from(BUCKET_CONOCIMIENTO).remove([doc.ruta]);
  if (errorArchivo) return fallo(`No se pudo borrar el archivo: ${errorArchivo.message}`);
  const { error } = await supabase.from("agente_documentos").delete().eq("id", r.data);
  if (error) return fallo(mensajeDeError(error));
  refresh();
  return { ok: true };
}

const esquemaCambioDocumento = z.object({
  id,
  nombre: z.string().trim().min(1, "Escribe un nombre").max(200, "El nombre es demasiado largo"),
  tipo: esquemaNuevoDocumento.shape.tipo,
  descripcion: z.string().trim().max(4000, "La descripción no puede pasar de 4000 caracteres"),
  enviable: z.boolean(),
});

/**
 * Cambia el nombre, el tipo, la descripción o si se puede enviar. Si cambió lo
 * que se indexa (nombre, tipo o descripción), avisa que hay que reindexar.
 */
export async function actualizarDocumento(entrada: unknown): Promise<Resultado<{ reindexar: boolean }>> {
  await exigirAgenteWhatsapp();
  const datos = esquemaCambioDocumento.safeParse(entrada);
  if (!datos.success) return fallo(datos.error.issues[0]?.message ?? "Los datos no son válidos.");
  const supabase = await clienteServidor();
  const { data: antes } = await supabase
    .from("agente_documentos")
    .select("nombre, tipo, descripcion")
    .eq("id", datos.data.id)
    .maybeSingle();
  if (!antes) return fallo("El documento ya no existe.");
  const { error } = await supabase
    .from("agente_documentos")
    .update({
      nombre: datos.data.nombre,
      tipo: datos.data.tipo,
      descripcion: datos.data.descripcion,
      enviable: datos.data.enviable,
      actualizado_en: new Date().toISOString(),
    })
    .eq("id", datos.data.id);
  if (error) return fallo(mensajeDeError(error));
  refresh();
  const reindexar =
    antes.nombre !== datos.data.nombre || antes.tipo !== datos.data.tipo || antes.descripcion !== datos.data.descripcion;
  return { ok: true, reindexar };
}

/* ── Ajustes ───────────────────────────────────────────────────────────────── */

export async function guardarAjustesAgente(entrada: unknown): Promise<Resultado> {
  await exigirAgenteWhatsapp();
  const datos = esquemaAjustesAgente.safeParse(entrada);
  if (!datos.success) return fallo(datos.error.issues[0]?.message ?? "Los datos no son válidos.");
  const supabase = await clienteServidor();
  const { error } = await supabase
    .from("configuracion")
    .upsert({ clave: CLAVE_AJUSTES_AGENTE, valor: datos.data as unknown as Json }, { onConflict: "clave" });
  if (error) return fallo(mensajeDeError(error));
  refresh();
  return { ok: true };
}

/* ── Pruebas ───────────────────────────────────────────────────────────────── */

/** Una conversación nueva, opcionalmente "desde" un anuncio de Meta. */
export async function crearPrueba(entrada: unknown): Promise<Resultado<{ id: string }>> {
  await exigirAgenteWhatsapp();
  const anuncio = leerAnuncio((entrada as { anuncio?: unknown } | null)?.anuncio);
  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from("agente_pruebas")
    .insert({ titulo: anuncio ? "Desde un anuncio" : "Prueba", anuncio: anuncio as unknown as Json })
    .select("id")
    .single();
  if (error || !data) return fallo(mensajeDeError(error));
  refresh();
  return { ok: true, id: data.id };
}

export async function eliminarPrueba(pruebaId: unknown): Promise<Resultado> {
  await exigirAgenteWhatsapp();
  const r = id.safeParse(pruebaId);
  if (!r.success) return fallo("La prueba no es válida.");
  const supabase = await clienteServidor();
  const { error } = await supabase.from("agente_pruebas").delete().eq("id", r.data);
  if (error) return fallo(mensajeDeError(error));
  refresh();
  return { ok: true };
}

/** Los mensajes de una prueba, para abrirla. */
export async function leerPrueba(pruebaId: unknown): Promise<Resultado<{ mensajes: MensajePrueba[] }>> {
  await exigirAgenteWhatsapp();
  const r = id.safeParse(pruebaId);
  if (!r.success) return fallo("La prueba no es válida.");
  try {
    return { ok: true, mensajes: await cargarMensajesDePrueba(r.data) };
  } catch (e) {
    return fallo(e instanceof Error ? e.message : "No se pudo abrir la prueba.");
  }
}
