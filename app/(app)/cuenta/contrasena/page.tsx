import type { Metadata } from "next";
import { exigirSesion } from "@/lib/sesion";
import { FormularioActualizarPassword } from "./formulario";

export const metadata: Metadata = {
  title: "Cambiar contraseña · Plexiacril",
};

/**
 * El cambio de contraseña de quien ya entró alguna vez, no el de bienvenida.
 * Se llega por el menú de usuario, no por la navegación de pedidos.
 */
export default async function ContrasenaPage() {
  await exigirSesion();

  return (
    <div className="mx-auto w-full max-w-sm px-4 py-6">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Cambiar contraseña</h1>
        <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
          Elige una contraseña nueva para tu cuenta. No hace falta escribir la actual:
          ya entraste con ella.
        </p>
      </header>

      <FormularioActualizarPassword />
    </div>
  );
}
