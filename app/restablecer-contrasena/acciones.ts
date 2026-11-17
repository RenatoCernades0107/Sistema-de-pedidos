"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { actualizarPasswordAuth } from "@/lib/contrasena";
import { esquemaCambioPassword } from "@/lib/esquemas";
import { perfilActual } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase-servidor";

export interface EstadoRestablecer {
  error?: string;
}

/**
 * Elegir la contraseña nueva tras abrir el enlace del correo. El enlace ya dejó
 * una sesión, así que no se pide la anterior —es justo la que se olvidó—.
 *
 * Como la eligió su dueña, baja también la marca de "contraseña inicial": no tiene
 * sentido mandarla después a la pantalla de bienvenida a cambiar lo que acaba de
 * cambiar.
 */
export async function restablecerPassword(
  _previo: EstadoRestablecer,
  datos: FormData,
): Promise<EstadoRestablecer> {
  const perfil = await perfilActual();
  if (!perfil) redirect("/olvide-contrasena?error=enlace");

  const analisis = esquemaCambioPassword.safeParse({
    password: String(datos.get("password") ?? ""),
    confirmacion: String(datos.get("confirmacion") ?? ""),
  });

  if (!analisis.success) return { error: analisis.error.issues[0].message };

  const supabase = await clienteServidor();
  const error = await actualizarPasswordAuth(supabase, analisis.data.password);

  if (error) return { error };

  if (perfil.debeCambiarPassword) await supabase.rpc("marcar_password_cambiada");

  revalidatePath("/", "layout");
  redirect("/");
}
