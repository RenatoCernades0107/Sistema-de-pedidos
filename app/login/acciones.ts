"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { clienteServidor } from "@/lib/supabase-servidor";

export interface EstadoLogin {
  error?: string;
  usuario?: string;
}

/**
 * Entrar al sistema con usuario y contraseña. El rol no se elige: sale del
 * perfil ligado a la cuenta.
 *
 * Supabase Auth solo autentica por correo, así que el usuario se traduce a su
 * correo interno con `email_de_usuario` antes de autenticar.
 *
 * Los errores no distinguen entre usuario inexistente y contraseña equivocada:
 * decir "ese usuario no existe" le regala a cualquiera la lista de cuentas.
 */
export async function iniciarSesion(
  _previo: EstadoLogin,
  datos: FormData,
): Promise<EstadoLogin> {
  const usuario = String(datos.get("usuario") ?? "").trim();
  const password = String(datos.get("password") ?? "");
  const siguiente = String(datos.get("siguiente") ?? "");

  if (!usuario || !password) {
    return { error: "Escribe tu usuario y tu contraseña.", usuario };
  }

  const supabase = await clienteServidor();

  const { data: email } = await supabase.rpc("email_de_usuario", {
    nombre_usuario: usuario,
  });

  if (!email) {
    return { error: "Usuario o contraseña incorrectos.", usuario };
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: "Usuario o contraseña incorrectos.", usuario };
  }

  const { data: { user } } = await supabase.auth.getUser();
  const { data: perfil } = await supabase
    .from("usuarios")
    .select("activo")
    .eq("id", user!.id)
    .maybeSingle();

  // Una cuenta desactivada puede autenticarse pero no ve nada: mejor decirlo
  // aquí que dejarla dando vueltas contra una app vacía.
  if (!perfil?.activo) {
    await supabase.auth.signOut();
    return { error: "Tu cuenta está desactivada. Habla con Administración.", usuario };
  }

  revalidatePath("/", "layout");
  redirect(siguiente && siguiente.startsWith("/") ? siguiente : "/");
}

export async function cerrarSesion() {
  const supabase = await clienteServidor();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
