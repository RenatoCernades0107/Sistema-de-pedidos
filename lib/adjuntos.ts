/**
 * Reglas de los archivos que acompañan a un pedido.
 *
 * Están aquí, y no dentro del formulario o de la Server Action, porque las corren
 * los dos: el navegador para avisar antes de gastar la subida, y el servidor
 * porque una Server Action es un POST público y nadie garantiza que venga del
 * formulario. Una sola definición evita que las dos copias se separen.
 *
 * El tope y la lista de tipos también están en el bucket
 * (`20260901000500_adjuntos_limites.sql`): lo de aquí es para dar un mensaje
 * decente, lo que de verdad corta es Storage.
 */

import type { TipoAdjunto } from "@/lib/dominio";

/** Lo que el taller y la oficina mandan de verdad: planos exportados y fotos. */
export const MIME_ADJUNTOS = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export const MAX_BYTES = 10 * 1024 * 1024;
export const MAX_ARCHIVOS = 10;

/** Para el atributo `accept` del input, que filtra el diálogo del sistema. */
export const ACEPTA = MIME_ADJUNTOS.join(",");

/** Lo mínimo que hace falta para juzgar un archivo: vale un `File` o un `Blob`. */
export interface ArchivoAJuzgar {
  name: string;
  type: string;
  size: number;
}

/** El motivo del rechazo, o `null` si el archivo pasa. */
export function validarArchivo(archivo: ArchivoAJuzgar): string | null {
  if (archivo.size === 0) return `“${archivo.name}” está vacío.`;

  if (!(MIME_ADJUNTOS as readonly string[]).includes(archivo.type)) {
    return `“${archivo.name}” no es un tipo admitido: solo PDF, PNG, JPEG o WebP.`;
  }

  if (archivo.size > MAX_BYTES) {
    return `“${archivo.name}” pesa más de 10 MB.`;
  }

  return null;
}

/**
 * Un nombre que el bucket admita y que no pueda salirse de su carpeta.
 *
 * Storage trata la clave como una ruta, así que un nombre con `../` subiría el
 * archivo al pedido de al lado —donde la RLS ya lo daría por bueno, porque mira la
 * ruta y no de dónde vino—. Por eso se descarta todo menos el nombre a secas.
 */
export function nombreSeguro(nombre: string): string {
  const soloNombre = nombre.split(/[\/]/).pop() ?? "";
  const punto = soloNombre.lastIndexOf(".");
  const base = punto > 0 ? soloNombre.slice(0, punto) : soloNombre;
  const extension = punto > 0 ? soloNombre.slice(punto + 1) : "";

  const limpiar = (texto: string) =>
    texto
      // Separa la tilde de su letra para poder quitarla sola: "ñ" → "n" + "~".
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

  const limpio = limpiar(base) || "archivo";
  const sufijo = limpiar(extension);

  return sufijo ? `${limpio}.${sufijo}` : limpio;
}

/**
 * Dónde vive el archivo dentro del bucket privado.
 *
 *   pedidos/<pedido_id>/<tipo_adjunto>/<uuid>-<nombre>
 *
 * El tipo va en el tercer segmento porque es lo que lee
 * `adjuntos_storage_lectura` para esconderle la factura y la guía al taller sin
 * tener que consultar la tabla. El uuid delante es lo que permite subir dos veces
 * el mismo `plano.pdf` sin que el segundo pise al primero.
 */
export function rutaAdjunto(pedidoId: string, tipo: TipoAdjunto, nombre: string): string {
  return `pedidos/${pedidoId}/${tipo}/${crypto.randomUUID()}-${nombreSeguro(nombre)}`;
}
