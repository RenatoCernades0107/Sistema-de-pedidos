"use client";

/**
 * El camino de subida, compartido por el formulario de alta y el detalle.
 *
 * Son dos pasos y en este orden:
 *
 *   1. El archivo va del navegador al bucket, con la sesión de quien lo manda.
 *      No pasa por el servidor de Next porque el cuerpo de una Server Action está
 *      limitado a 1 MB y un plano exportado pesa más; la RLS del bucket ya decide
 *      quién puede escribir y en qué carpeta.
 *   2. `registrarAdjunto` anota la fila. Si ese paso falla, la propia acción borra
 *      el objeto recién subido: un archivo sin fila no lo encontraría nadie.
 *
 * Si el navegador se cierra entre los dos pasos queda un objeto huérfano. Es la
 * única ventana, dura lo que tarda un POST, y la alternativa —escribir la fila
 * primero— dejaría en pantalla un archivo que no existe, que es peor.
 */

import { registrarAdjunto } from "@/app/(app)/adjuntos-acciones";
import { clienteNavegador } from "@/lib/supabase-cliente";
import { MAX_ARCHIVOS, rutaAdjunto, validarArchivo } from "@/lib/adjuntos";
import type { TipoAdjunto } from "@/lib/dominio";

export interface ResultadoSubida {
  subidos: number;
  /** Un motivo por archivo que no entró. Se enseñan todos: si alguien manda seis
   *  y fallan dos, saber cuáles es lo único que sirve para reintentar. */
  errores: string[];
}

export async function subirAdjuntos(
  codigo: string,
  tipo: TipoAdjunto,
  archivos: File[],
): Promise<ResultadoSubida> {
  const supabase = clienteNavegador();
  const errores: string[] = [];
  let subidos = 0;

  if (archivos.length > MAX_ARCHIVOS) {
    return { subidos: 0, errores: [`No se pueden subir más de ${MAX_ARCHIVOS} archivos a la vez.`] };
  }

  /* La carpeta va por uuid, no por código, que es lo que dice la convención de
     rutas de `20260830000800_adjuntos.sql`. El código es lo que se dicta por
     teléfono; el uuid es lo que no cambia nunca. `id` está en el GRANT de
     `pedidos` para los tres roles, así que esta consulta la puede hacer
     cualquiera que ya vea el pedido. */
  const { data: pedido } = await supabase
    .from("pedidos")
    .select("id")
    .eq("codigo", codigo)
    .maybeSingle();

  if (!pedido) return { subidos: 0, errores: ["Ese pedido ya no está disponible."] };
  const pedidoId = pedido.id;

  for (const archivo of archivos) {
    const problema = validarArchivo(archivo);
    if (problema) {
      errores.push(problema);
      continue;
    }

    const ruta = rutaAdjunto(pedidoId, tipo, archivo.name);

    const { error } = await supabase.storage
      .from("adjuntos")
      .upload(ruta, archivo, { contentType: archivo.type });

    if (error) {
      errores.push(`No se pudo subir “${archivo.name}”.`);
      continue;
    }

    const anotado = await registrarAdjunto({
      codigo,
      tipo,
      ruta,
      nombre: archivo.name,
      mime: archivo.type,
      tamano: archivo.size,
    });

    if (anotado.ok) subidos += 1;
    else errores.push(anotado.error);
  }

  return { subidos, errores };
}
