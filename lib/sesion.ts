import { cache } from "react";
import { redirect } from "next/navigation";
import { ROLES, type Rol, type Vista } from "./dominio";
import { clienteServidor } from "./supabase-servidor";

export interface Perfil {
  id: string;
  nombre: string;
  /** Lo que la persona escribe para entrar. El correo es interno. */
  usuario: string;
  rol: Rol;
}

/**
 * Quién está pidiendo esta página. Devuelve `null` si no hay sesión o si la
 * cuenta está desactivada.
 *
 * Va envuelto en `cache` para que el layout, la página y sus guardas compartan
 * una sola consulta por render.
 */
export const perfilActual = cache(async (): Promise<Perfil | null> => {
  const supabase = await clienteServidor();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data } = await supabase
    .from("usuarios")
    .select("id, nombre, usuario, rol, activo")
    .eq("id", user.id)
    .maybeSingle();

  if (!data?.activo) return null;

  return { id: data.id, nombre: data.nombre, usuario: data.usuario, rol: data.rol };
});

export async function exigirSesion(): Promise<Perfil> {
  const perfil = await perfilActual();
  if (!perfil) redirect("/login");
  return perfil;
}

/**
 * Una vista que no le corresponde al rol no da error: devuelve a la persona a la
 * suya. Escribir `/tienda` en la barra de direcciones no es un ataque, casi
 * siempre es un enlace viejo o un dedo torpe.
 *
 * Esto es la segunda de las tres capas: el menú no ofrece la vista, esto la
 * cierra, y la RLS decide qué filas y columnas se pueden leer.
 */
export async function exigirVista(vista: Vista): Promise<Perfil> {
  const perfil = await exigirSesion();
  if (!ROLES[perfil.rol].vistas.includes(vista)) {
    redirect(`/${ROLES[perfil.rol].vistaInicial}`);
  }
  return perfil;
}

export async function exigirCrearPedido(): Promise<Perfil> {
  const perfil = await exigirSesion();
  if (!ROLES[perfil.rol].crearPedido) {
    redirect(`/${ROLES[perfil.rol].vistaInicial}`);
  }
  return perfil;
}
