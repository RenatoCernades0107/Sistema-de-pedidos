"use client";

/**
 * La subida de los archivos del chat, del navegador directo al bucket `chat`.
 *
 * No pasa por el servidor de Next por lo mismo que `lib/adjuntos-navegador.ts`:
 * un video de 50 MB no cabe en el cuerpo de una Server Action, y la RLS del bucket
 * ya decide quién escribe en la carpeta de qué conversación.
 *
 * Va con `XMLHttpRequest` y no con `supabase.storage.upload` porque el SDK no
 * informa el avance, y un video por datos móviles tarda lo suficiente como para
 * que una barra quieta parezca colgada. La petición es la misma que arma el SDK
 * (POST multipart a `/storage/v1/object/<bucket>/<ruta>` con la sesión).
 */

import { clienteNavegador } from "@/lib/supabase-cliente";
import { BUCKET_CHAT, esImagen, esVideo } from "@/lib/chat/tipos";

/** Lo que `enviar_mensaje` espera de cada archivo ya subido. */
export interface AdjuntoSubido {
  ruta: string;
  nombre: string;
  mime: string;
  tamano: number;
  ancho?: number;
  alto?: number;
  duracion?: number;
}

export interface Medidas {
  ancho?: number;
  alto?: number;
  duracion?: number;
}

/** Cuánto se espera a que el navegador lea las medidas antes de seguir sin ellas. */
const ESPERA_MEDIDAS_MS = 4000;

/**
 * Ancho y alto de una foto o video, y la duración del video. Con eso la burbuja
 * reserva el espacio antes de que llegue la imagen y no salta al cargar. Si el
 * navegador no sabe abrirlo (HEIC fuera de Safari) se sube igual, sin medidas.
 */
export function medirArchivo(archivo: Blob, mime: string): Promise<Medidas> {
  if (!esImagen(mime) && !esVideo(mime)) return Promise.resolve({});
  const url = URL.createObjectURL(archivo);

  const medir = new Promise<Medidas>((resolve) => {
    if (esImagen(mime)) {
      const img = new Image();
      img.onload = () => resolve({ ancho: img.naturalWidth || undefined, alto: img.naturalHeight || undefined });
      img.onerror = () => resolve({});
      img.src = url;
      return;
    }
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () =>
      resolve({
        ancho: video.videoWidth || undefined,
        alto: video.videoHeight || undefined,
        duracion: Number.isFinite(video.duration) ? Math.round(video.duration * 100) / 100 : undefined,
      });
    video.onerror = () => resolve({});
    video.src = url;
  });

  const tope = new Promise<Medidas>((resolve) => setTimeout(() => resolve({}), ESPERA_MEDIDAS_MS));
  return Promise.race([medir, tope]).finally(() => URL.revokeObjectURL(url));
}

/**
 * Sube un archivo y va avisando el avance (0 a 1). Rechaza con un mensaje para
 * la persona si Storage no lo acepta.
 */
export async function subirArchivo(
  ruta: string,
  archivo: Blob,
  alAvanzar: (fraccion: number) => void,
  senal?: AbortSignal,
): Promise<void> {
  const {
    data: { session },
  } = await clienteNavegador().auth.getSession();
  if (!session) throw new Error("Tu sesión venció. Vuelve a entrar.");

  const cuerpo = new FormData();
  cuerpo.append("cacheControl", "3600");
  cuerpo.append("", archivo);

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/${BUCKET_CHAT}/${ruta}`);
    xhr.setRequestHeader("Authorization", `Bearer ${session.access_token}`);
    xhr.setRequestHeader("apikey", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) alAvanzar(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        alAvanzar(1);
        resolve();
        return;
      }
      reject(new Error(motivoDeStorage(xhr.status, xhr.responseText)));
    };
    xhr.onerror = () => reject(new Error("Se cortó la conexión mientras subía."));
    xhr.onabort = () => reject(new DOMException("Cancelado", "AbortError"));
    senal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(cuerpo);
  });
}

function motivoDeStorage(estado: number, cuerpo: string): string {
  if (estado === 413) return "Pesa más de lo que admite el chat (50 MB).";
  if (estado === 401 || estado === 403) return "No tienes permiso para enviar archivos aquí.";
  try {
    const { message } = JSON.parse(cuerpo) as { message?: string };
    if (message) return message;
  } catch {
    // Cuerpo no JSON: el mensaje genérico de abajo.
  }
  return "No se pudo subir.";
}

/** Borra lo subido de un mensaje que no llegó a enviarse. La política solo deja borrar lo propio sin mensaje. */
export async function borrarSubidos(rutas: string[]): Promise<void> {
  if (rutas.length === 0) return;
  const { error } = await clienteNavegador().storage.from(BUCKET_CHAT).remove(rutas);
  if (error) console.warn("[chat] no se borraron los archivos huérfanos", error.message);
}
