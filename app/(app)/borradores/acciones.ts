"use server";

/**
 * Guardar y borrar los borradores de "Nuevo pedido" y "Nueva cotización".
 *
 * Se escribe con la sesión de quien pide: la RLS deja tocar solo los propios.
 */

import { exigirCotizaciones, exigirCrearPedido, exigirSesion } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase-servidor";
import { mensajeDeError } from "@/lib/errores";
import { MAX_BYTES_BORRADOR, esquemaGuardarBorrador, leerDatos } from "@/lib/borradores";
import type { Json } from "@/lib/supabase-tipos";

export type ResultadoBorrador = { ok: true; id: string } | { ok: false; error: string };

export async function guardarBorrador(entrada: unknown): Promise<ResultadoBorrador> {
  const v = esquemaGuardarBorrador.safeParse(entrada);
  if (!v.success) return { ok: false, error: "El borrador no es válido." };
  const { id, tipo, cotizacionId, resumen } = v.data;

  if (tipo === "pedido") await exigirCrearPedido();
  else await exigirCotizaciones();

  const datos = leerDatos(tipo, v.data.datos);
  if (!datos) return { ok: false, error: "El borrador no es válido." };
  if (JSON.stringify(datos).length > MAX_BYTES_BORRADOR) {
    return { ok: false, error: "El borrador es demasiado grande para guardarlo." };
  }

  const supabase = await clienteServidor();
  const fila = { datos: datos as unknown as Json, resumen, cotizacion_id: tipo === "pedido" ? cotizacionId : null };

  if (id) {
    const { data, error } = await supabase
      .from("borradores")
      .update(fila)
      .eq("id", id)
      .eq("tipo", tipo)
      .select("id")
      .maybeSingle();
    if (error) return { ok: false, error: mensajeDeError(error) };
    // Si ya no existe (se eliminó o venció), se crea otro: lo de pantalla manda.
    if (data) return { ok: true, id: data.id };
  }

  const { data, error } = await supabase.from("borradores").insert({ ...fila, tipo }).select("id").single();
  if (error) return { ok: false, error: mensajeDeError(error) };
  return { ok: true, id: data.id };
}

export async function eliminarBorrador(id: string): Promise<{ ok: boolean; error?: string }> {
  await exigirSesion();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: "El borrador no es válido." };
  const supabase = await clienteServidor();
  const { error } = await supabase.from("borradores").delete().eq("id", id);
  if (error) return { ok: false, error: mensajeDeError(error) };
  return { ok: true };
}
