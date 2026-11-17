import { esquemaCorreoRecuperacion } from "./esquemas";
import type { clienteServidor } from "./supabase-servidor";
import { urlBase } from "./url-base";

export interface ResultadoCorreo {
  error?: string;
  /** Se mandó el enlace de confirmación a esta dirección. */
  enviadoA?: string;
}

/**
 * Pide a Auth cambiar el correo de la sesión actual; Auth manda un enlace de
 * confirmación a la dirección nueva y solo al abrirlo queda puesta (el trigger
 * `sincronizar_email_de_usuario` la copia entonces al perfil). Así nadie puede
 * apuntar la recuperación de su cuenta a una bandeja que no es suya.
 *
 * Lo comparten el formulario del menú y el paso de bienvenida: los dos terminan en
 * lo mismo y traducen los mismos errores de GoTrue.
 */
export async function pedirCambioDeCorreo(
  supabase: Awaited<ReturnType<typeof clienteServidor>>,
  correo: string,
): Promise<ResultadoCorreo> {
  const analisis = esquemaCorreoRecuperacion.safeParse({ correo });
  if (!analisis.success) return { error: analisis.error.issues[0].message };

  const { error } = await supabase.auth.updateUser(
    { email: analisis.data.correo },
    { emailRedirectTo: `${await urlBase()}/auth/confirmar` },
  );

  if (error) {
    switch (error.code) {
      case "email_exists":
        return { error: "Ese correo ya está en uso por otra cuenta." };
      case "over_email_send_rate_limit":
        return { error: "Se pidieron demasiados correos. Espera unos minutos e inténtalo otra vez." };
      case "same_email":
        return { error: "Ese ya es tu correo de recuperación." };
      default:
        return { error: "No se pudo guardar el correo. Inténtalo otra vez." };
    }
  }

  return { enviadoA: analisis.data.correo };
}
