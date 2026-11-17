"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { actualizarPasswordAuth } from "@/lib/contrasena";
import { pedirCambioDeCorreo, type ResultadoCorreo } from "@/lib/correo-recuperacion";
import { esquemaCambioPassword } from "@/lib/esquemas";
import { RUTA_CAMBIO_PASSWORD, bienvenidaPendiente, perfilActual } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase-servidor";

export interface EstadoCambioPassword {
  error?: string;
}

/**
 * Cambiar la contraseña con la que a uno le crearon la cuenta.
 *
 * No pide la contraseña actual: para llegar hasta aquí hubo que escribirla en el
 * login hace un momento, y la cookie de sesión ya lo demuestra.
 *
 * El orden importa. Primero se cambia la contraseña y solo después se baja la
 * marca: al revés, un fallo en medio dejaría la puerta abierta con la contraseña
 * vieja todavía puesta. Si falla el segundo paso lo peor que pasa es que el
 * formulario vuelva a salir, que es el lado seguro en el que quedarse.
 */
export async function cambiarPassword(
  _previo: EstadoCambioPassword,
  datos: FormData,
): Promise<EstadoCambioPassword> {
  const perfil = await perfilActual();
  if (!perfil) redirect("/login");
  if (!perfil.debeCambiarPassword) redirect(RUTA_CAMBIO_PASSWORD);

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

  const { error: fallo } = await supabase.rpc("marcar_password_cambiada");

  if (fallo) {
    // Raro, pero deja un estado incómodo: la contraseña ya es la nueva y la marca
    // sigue puesta, así que este formulario volverá a salir y repetir la misma
    // contraseña chocaría con `same_password`. Se dice explícitamente qué hacer.
    return {
      error:
        "Tu contraseña sí cambió, pero no se pudo terminar el ingreso. Entra con " +
        "la contraseña nueva y elige otra distinta cuando vuelva a pedírtelo.",
    };
  }

  revalidatePath("/", "layout");
  redirect("/");
}

export type EstadoCorreoBienvenida = ResultadoCorreo;

/**
 * Paso 2 de la bienvenida: registrar el correo de recuperación. Solo cuando la
 * contraseña ya es la propia —el orden del formulario— y no hay correo todavía.
 */
export async function registrarCorreoBienvenida(
  _previo: EstadoCorreoBienvenida,
  datos: FormData,
): Promise<EstadoCorreoBienvenida> {
  const perfil = await perfilActual();
  if (!perfil) redirect("/login");
  if (perfil.debeCambiarPassword) return { error: "Primero cambia tu contraseña." };
  if (!perfil.debeRegistrarCorreo) redirect("/");

  return pedirCambioDeCorreo(await clienteServidor(), String(datos.get("correo") ?? ""));
}

export interface EstadoConfirmacion {
  error?: string;
}

/**
 * "Ya lo confirmé": el enlace del correo se abre fuera de esta pantalla (a veces
 * en otro aparato), así que la página no se entera sola. Aquí se vuelve a leer el
 * perfil: si el correo ya quedó, se entra; si no, se dice.
 */
export async function comprobarCorreoConfirmado(): Promise<EstadoConfirmacion> {
  const perfil = await perfilActual();
  if (!perfil) redirect("/login");

  if (bienvenidaPendiente(perfil)) {
    return { error: "Todavía no vemos tu correo confirmado. Abre el enlace que te enviamos y vuelve a intentar." };
  }

  revalidatePath("/", "layout");
  redirect("/");
}
