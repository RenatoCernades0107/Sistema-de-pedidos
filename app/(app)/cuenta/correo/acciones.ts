"use server";

import { pedirCambioDeCorreo, type ResultadoCorreo } from "@/lib/correo-recuperacion";
import { exigirSesion } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase-servidor";

export type EstadoCorreo = ResultadoCorreo;

/** Registra o cambia el correo de recuperación desde el menú (ver `pedirCambioDeCorreo`). */
export async function guardarCorreo(
  _previo: EstadoCorreo,
  datos: FormData,
): Promise<EstadoCorreo> {
  await exigirSesion();
  return pedirCambioDeCorreo(await clienteServidor(), String(datos.get("correo") ?? ""));
}
