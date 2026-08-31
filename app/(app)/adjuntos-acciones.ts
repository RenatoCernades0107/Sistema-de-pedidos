"use server";

/**
 * Los archivos del pedido: anotarlos, abrirlos y borrarlos.
 *
 * Están aparte de `acciones.ts` porque el archivo no pasa por aquí. Sube del
 * navegador a Storage directamente, con la sesión de quien lo manda, y por dos
 * razones:
 *
 *   1. El cuerpo de una Server Action está limitado a 1 MB, y un plano exportado
 *      pesa más. Subirlo por aquí obligaría a subir ese tope para toda la app.
 *   2. La RLS del bucket ya decide quién escribe y dónde. Pasar por el servidor
 *      no añadiría ni un control; solo un salto más.
 *
 * Lo que sí pasa por aquí es la escritura en la base, como todo lo demás: la fila
 * de `adjuntos` es el registro de que el archivo existe, y quien la escribe firma
 * la auditoría con su `auth.uid()`.
 */

import { refresh } from "next/cache";
import { clienteServidor } from "@/lib/supabase-servidor";
import { exigirSesion } from "@/lib/sesion";
import { ROLES, type TipoAdjunto } from "@/lib/dominio";
import { ERROR_SIN_FILAS, mensajeDeError } from "@/lib/errores";
import { MAX_BYTES, MIME_ADJUNTOS } from "@/lib/adjuntos";
import type { Resultado } from "./acciones";

const BUCKET = "adjuntos";

/** Lo que dura una URL firmada. Da para abrir el archivo, no para repartirla. */
const SEGUNDOS_URL = 60;

const fallo = (error: string): Resultado => ({ ok: false, error });

/**
 * Quién puede tocar los archivos de un pedido.
 *
 * Es la misma condición que la política `adjuntos_storage_escritura`. Se repite
 * aquí para poder contestar con una frase en vez de con un 403 de Storage.
 */
async function exigirEscrituraDeAdjuntos() {
  const perfil = await exigirSesion();
  return ROLES[perfil.rol].adjuntarArchivos ? perfil : null;
}

/**
 * Anota un archivo que ya está en el bucket.
 *
 * Se llama después de subirlo, no antes: si la fila se escribiera primero, un
 * fallo de red dejaría en pantalla un archivo que no existe. Al revés, el peor
 * caso es un objeto sin fila, y por eso, si el insert se cae, se borra el objeto
 * en el mismo paso.
 *
 * La ruta llega del navegador, así que no se cree: se comprueba que empiece por la
 * carpeta de este pedido y que el tipo sea el que dice, porque es el tercer
 * segmento el que le esconde la factura al taller.
 */
export async function registrarAdjunto(entrada: {
  codigo: string;
  tipo: TipoAdjunto;
  ruta: string;
  nombre: string;
  mime: string;
  tamano: number;
}): Promise<Resultado> {
  const perfil = await exigirEscrituraDeAdjuntos();
  const supabase = await clienteServidor();

  const limpiar = () => supabase.storage.from(BUCKET).remove([entrada.ruta]);

  if (!perfil) {
    await limpiar();
    return fallo("Tu rol no adjunta archivos.");
  }

  if (!(MIME_ADJUNTOS as readonly string[]).includes(entrada.mime)) {
    await limpiar();
    return fallo("Solo se admiten PDF, PNG, JPEG o WebP.");
  }

  if (entrada.tamano <= 0 || entrada.tamano > MAX_BYTES) {
    await limpiar();
    return fallo("El archivo pesa más de 10 MB.");
  }

  const { data: pedido } = await supabase
    .from("pedidos")
    .select("id")
    .eq("codigo", entrada.codigo)
    .maybeSingle();

  if (!pedido) {
    await limpiar();
    return fallo(ERROR_SIN_FILAS);
  }

  if (!entrada.ruta.startsWith(`pedidos/${pedido.id}/${entrada.tipo}/`)) {
    await limpiar();
    return fallo("La ruta del archivo no corresponde a este pedido.");
  }

  const { error } = await supabase.from("adjuntos").insert({
    pedido_id: pedido.id,
    tipo: entrada.tipo,
    storage_path: entrada.ruta,
    nombre_archivo: entrada.nombre,
    mime_type: entrada.mime,
    tamano_bytes: entrada.tamano,
    subido_por: perfil.id,
  });

  if (error) {
    // Sin fila que lo apunte, el objeto no lo encontraría nadie: se va con ella.
    await limpiar();
    return fallo(mensajeDeError(error));
  }

  refresh();
  return { ok: true };
}

/**
 * Una URL para abrir el archivo, válida un minuto.
 *
 * La ruta se busca aquí por el id de la fila y no llega del navegador: `adjuntos`
 * tiene su propia política de lectura —Operaciones solo ve diseños y fotos—, así
 * que si el `select` no devuelve nada es que ese rol no tenía por qué verlo.
 */
export async function urlAdjunto(id: string): Promise<{ url: string } | { error: string }> {
  await exigirSesion();

  const supabase = await clienteServidor();
  const { data } = await supabase
    .from("adjuntos")
    .select("storage_path")
    .eq("id", id)
    .maybeSingle();

  if (!data) return { error: "Ese archivo ya no está disponible." };

  const { data: firmada, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(data.storage_path, SEGUNDOS_URL);

  if (error || !firmada) return { error: "No se pudo abrir el archivo." };

  return { url: firmada.signedUrl };
}

/**
 * Borra el archivo y su fila.
 *
 * En ese orden: si Storage falla, no se ha destruido nada y se puede reintentar.
 * Al revés, un fallo después de borrar la fila dejaría el objeto en el bucket sin
 * nada que lo apunte —ocupando sitio y sin forma de encontrarlo desde la app—,
 * que es justo lo que no puede pasar.
 *
 * Quién lo borró lo anota solo el trigger `adjuntos_auditoria` al irse la fila.
 */
export async function eliminarAdjunto(id: string): Promise<Resultado> {
  const perfil = await exigirEscrituraDeAdjuntos();
  if (!perfil) return fallo("Tu rol no borra archivos.");

  const supabase = await clienteServidor();
  const { data: adjunto } = await supabase
    .from("adjuntos")
    .select("storage_path")
    .eq("id", id)
    .maybeSingle();

  if (!adjunto) return fallo("Ese archivo ya no está.");

  const { error: falloStorage } = await supabase.storage
    .from(BUCKET)
    .remove([adjunto.storage_path]);

  if (falloStorage) return fallo("No se pudo borrar el archivo del almacenamiento.");

  const { data, error } = await supabase.from("adjuntos").delete().eq("id", id).select("id");

  if (error) return fallo(mensajeDeError(error));
  if (!data || data.length === 0) return fallo(ERROR_SIN_FILAS);

  refresh();
  return { ok: true };
}
