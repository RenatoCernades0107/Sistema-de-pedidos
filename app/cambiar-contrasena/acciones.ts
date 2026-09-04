"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { actualizarPasswordAuth } from "@/lib/contrasena";
import { esquemaCambioPassword } from "@/lib/esquemas";
import { perfilActual } from "@/lib/sesion";
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
  if (!perfil.debeCambiarPassword) redirect("/");

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
