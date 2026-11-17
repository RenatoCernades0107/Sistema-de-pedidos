"use client";

/**
 * La subida de los adjuntos del chat de diseños, del navegador directo al
 * bucket `cad_adjuntos`. No pasa por el servidor de Next: un plano escaneado no
 * cabe en el cuerpo de una petición a Vercel (4.5 MB), y la política del bucket
 * ya decide quién escribe. La ruta del chat recibe solo la lista.
 *
 * Las fotos grandes se achican antes de subir: el modelo no aprovecha más de
 * unos 2000 px por lado, y cada turno se le vuelven a mandar en base64.
 */

import { clienteNavegador } from "@/lib/supabase-cliente";
import {
  BUCKET_CAD_ADJUNTOS,
  MAX_ADJUNTOS,
  MAX_BYTES_ADJUNTO,
  esTipoAdjunto,
  rutaNueva,
  type AdjuntoCad,
  type TipoAdjunto,
} from "@/lib/cad/adjuntos";

/** Un archivo elegido en el compositor, todavía sin mandar. */
export interface AdjuntoLocal {
  id: string;
  archivo: File;
  /** La miniatura (object URL) si es una imagen. Hay que revocarla al quitarlo. */
  vistaPrevia: string | null;
}

/** El lado mayor con que se suben las fotos. */
const LADO_MAXIMO = 2000;

/** Por qué no se agregaron algunos archivos, para decirlo en un aviso. */
export type ResultadoAgregar = { agregados: AdjuntoLocal[]; avisos: string[] };

/**
 * Los archivos que se pueden sumar a los que ya hay: del tipo que el modelo
 * lee, que no pesen de más y hasta el máximo por mensaje.
 */
export function filtrarArchivos(elegidos: File[], yaHay: number): ResultadoAgregar {
  const avisos: string[] = [];
  const porTipo = elegidos.filter((a) => esTipoAdjunto(a.type));
  if (porTipo.length < elegidos.length) {
    const n = elegidos.length - porTipo.length;
    avisos.push(
      n === 1
        ? "Un archivo no se agregó: solo imágenes (PNG, JPEG, WebP) o PDF."
        : `${n} archivos no se agregaron: solo imágenes (PNG, JPEG, WebP) o PDF.`,
    );
  }
  // Las imágenes se achican al subir: solo el PDF tiene que entrar tal cual.
  const porPeso = porTipo.filter((a) => a.type.startsWith("image/") || a.size <= MAX_BYTES_ADJUNTO);
  if (porPeso.length < porTipo.length) {
    avisos.push(`Un PDF pesa más de ${MAX_BYTES_ADJUNTO / 1024 / 1024} MB y no se agregó.`);
  }
  const espacio = Math.max(0, MAX_ADJUNTOS - yaHay);
  const admitidos = porPeso.slice(0, espacio);
  if (admitidos.length < porPeso.length) {
    avisos.push(`Se pueden adjuntar hasta ${MAX_ADJUNTOS} archivos por mensaje.`);
  }
  return {
    agregados: admitidos.map((archivo) => ({
      id: crypto.randomUUID(),
      archivo,
      vistaPrevia: archivo.type.startsWith("image/") ? URL.createObjectURL(archivo) : null,
    })),
    avisos,
  };
}

export const liberarVistaPrevia = (a: AdjuntoLocal) => {
  if (a.vistaPrevia) URL.revokeObjectURL(a.vistaPrevia);
};

/** Una foto con el lado mayor en `LADO_MAXIMO`, o la misma si ya cabe (o no se pudo leer). */
async function achicar(archivo: File): Promise<{ blob: Blob; mime: TipoAdjunto }> {
  const mime = archivo.type as TipoAdjunto;
  if (!mime.startsWith("image/")) return { blob: archivo, mime };
  try {
    const imagen = await createImageBitmap(archivo);
    const escala = LADO_MAXIMO / Math.max(imagen.width, imagen.height);
    if (escala >= 1 && archivo.size <= MAX_BYTES_ADJUNTO) {
      imagen.close();
      return { blob: archivo, mime };
    }
    const lienzo = document.createElement("canvas");
    lienzo.width = Math.max(1, Math.round(imagen.width * Math.min(1, escala)));
    lienzo.height = Math.max(1, Math.round(imagen.height * Math.min(1, escala)));
    lienzo.getContext("2d")?.drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
    imagen.close();
    // Un PNG (un plano, un boceto) sigue en PNG para no ensuciar las líneas; las fotos, a JPEG.
    const salida: TipoAdjunto = mime === "image/png" ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob | null>((r) => lienzo.toBlob(r, salida, 0.88));
    return blob && blob.size <= MAX_BYTES_ADJUNTO ? { blob, mime: salida } : { blob: archivo, mime };
  } catch {
    return { blob: archivo, mime };
  }
}

/**
 * Sube los archivos a la carpeta del diseño y devuelve lo que la ruta del chat
 * espera. Si uno falla, rechaza con un mensaje para la persona.
 */
export async function subirAdjuntos(disenoId: string, locales: AdjuntoLocal[]): Promise<AdjuntoCad[]> {
  const storage = clienteNavegador().storage.from(BUCKET_CAD_ADJUNTOS);
  return Promise.all(
    locales.map(async ({ archivo }): Promise<AdjuntoCad> => {
      const { blob, mime } = await achicar(archivo);
      if (blob.size > MAX_BYTES_ADJUNTO) {
        throw new Error(`«${archivo.name}» pesa más de ${MAX_BYTES_ADJUNTO / 1024 / 1024} MB.`);
      }
      const ruta = rutaNueva(disenoId, mime);
      const { error } = await storage.upload(ruta, blob, { contentType: mime, upsert: false });
      if (error) throw new Error(`No se pudo subir «${archivo.name}». Intenta de nuevo.`);
      return { ruta, nombre: archivo.name, mime, tamano: blob.size };
    }),
  );
}
