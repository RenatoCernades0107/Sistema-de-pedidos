import { redirect } from "next/navigation";
import { ROLES } from "@/lib/dominio";
import { exigirSesion } from "@/lib/sesion";

/**
 * La raíz no muestra nada: manda a cada rol a la vista con la que trabaja.
 * Administración a todos los pedidos, Logística a provincia, el taller al taller.
 */
export default async function Home() {
  const perfil = await exigirSesion();
  redirect(`/${ROLES[perfil.rol].vistaInicial}`);
}
