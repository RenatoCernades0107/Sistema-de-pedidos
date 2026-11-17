"use server";

import { esquemaCorreoRecuperacion } from "@/lib/esquemas";
import { exigirSesion } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase-servidor";
import { urlBase } from "@/lib/url-base";

export interface EstadoCorreo {
  error?: string;
  /** Se mandó el enlace de confirmación a esta dirección. */
  enviadoA?: string;
}

/**
 * Registra el correo de recuperación. No lo guarda directamente: pide a Auth el
 * cambio de correo de la cuenta, y Auth manda un enlace a la dirección nueva. Solo
 * cuando se abre ese enlace el correo queda puesto (y el trigger de
 * `sincronizar_email_de_usuario` lo copia al perfil). Así nadie puede apuntar la
 * recuperación de su cuenta —ni la de otra persona— a una bandeja que no es suya.
 */
export async function guardarCorreo(
  _previo: EstadoCorreo,
  datos: FormData,
): Promise<EstadoCorreo> {
  await exigirSesion();

  const analisis = esquemaCorreoRecuperacion.safeParse({
    correo: String(datos.get("correo") ?? ""),
  });

  if (!analisis.success) return { error: analisis.error.issues[0].message };

  const supabase = await clienteServidor();
  const { error } = await supabase.auth.updateUser(
    { email: analisis.data.correo },
    { emailRedirectTo: `${await urlBase()}/auth/confirmar` },
  );

  if (error) {
    if (error.code === "email_exists") {
      return { error: "Ese correo ya está en uso por otra cuenta." };
    }
    if (error.code === "over_email_send_rate_limit") {
      return { error: "Se pidieron demasiados correos. Espera unos minutos e inténtalo otra vez." };
    }
    if (error.code === "same_email") {
      return { error: "Ese ya es tu correo de recuperación." };
    }
    return { error: "No se pudo guardar el correo. Inténtalo otra vez." };
  }

  return { enviadoA: analisis.data.correo };
}
