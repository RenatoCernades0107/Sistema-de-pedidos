import { redirect } from "next/navigation";
import { RUTA_PEDIDOS } from "@/lib/dominio";
import { exigirSesion } from "@/lib/sesion";

/**
 * La raíz no muestra nada: manda a la vista de pedidos, que abre con el alcance
 * de cada rol (Administración todos, Logística provincia, el taller el taller).
 */
export default async function Home() {
  await exigirSesion();
  redirect(RUTA_PEDIDOS);
}
