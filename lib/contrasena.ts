import type { clienteServidor } from "./supabase-servidor";

/**
 * Cambia la contraseña de la sesión actual en Supabase Auth. Devuelve el mensaje
 * a mostrar en el formulario, o `null` si salió bien.
 *
 * Comparten esto el cambio forzado de bienvenida y el voluntario desde el menú:
 * los dos terminan llamando a lo mismo y traduciendo el mismo aviso de GoTrue, así
 * que más vale que lo hagan en un solo sitio y no en dos que se puedan desalinear.
 *
 * GoTrue devuelve `same_password` cuando la nueva es la de siempre. Es el único
 * caso que vale la pena distinguir: los demás no dependen de lo que se escribió y
 * no hay nada que corregir en el formulario.
 */
export async function actualizarPasswordAuth(
  supabase: Awaited<ReturnType<typeof clienteServidor>>,
  password: string,
): Promise<string | null> {
  const { error } = await supabase.auth.updateUser({ password });

  if (!error) return null;

  return error.code === "same_password"
    ? "Esa es la contraseña que ya tenías. Elige una distinta."
    : "No se pudo cambiar la contraseña. Inténtalo otra vez.";
}
