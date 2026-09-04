"use server";

import { actualizarPasswordAuth } from "@/lib/contrasena";
import { esquemaCambioPassword } from "@/lib/esquemas";
import { exigirSesion } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase-servidor";

export interface EstadoActualizarPassword {
  error?: string;
  exito?: boolean;
}

/**
 * Cambio de contraseña voluntario, para quien ya pasó el de bienvenida.
 *
 * No pide la contraseña actual por la misma razón que el otro formulario: la
 * cookie de sesión ya demuestra quién es. Y a diferencia de aquel, aquí no hay
 * marca que bajar ni sitio al que mandar a nadie: la persona se queda en la
 * pantalla y sigue con lo suyo.
 */
export async function actualizarPassword(
  _previo: EstadoActualizarPassword,
  datos: FormData,
): Promise<EstadoActualizarPassword> {
  await exigirSesion();

  const analisis = esquemaCambioPassword.safeParse({
    password: String(datos.get("password") ?? ""),
    confirmacion: String(datos.get("confirmacion") ?? ""),
  });

  if (!analisis.success) {
    return { error: analisis.error.issues[0].message };
  }

  const supabase = await clienteServidor();
  const error = await actualizarPasswordAuth(supabase, analisis.data.password);

  if (error) return { error };

  return { exito: true };
}
