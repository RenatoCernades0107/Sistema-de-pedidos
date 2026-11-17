import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { KeyRound } from "lucide-react";
import { perfilActual } from "@/lib/sesion";
import { FormularioRestablecer } from "./formulario";

export const metadata: Metadata = {
  title: "Contraseña nueva · Plexiacril",
};

/**
 * A donde llega el enlace del correo de recuperación. Fuera de `(app)` a propósito,
 * igual que el cambio de bienvenida: sin cabecera ni pedidos cargados.
 */
export default async function RestablecerContrasenaPage() {
  const perfil = await perfilActual();
  if (!perfil) redirect("/olvide-contrasena?error=enlace");

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <span className="bg-primary text-brand grid size-10 place-items-center rounded-lg">
            <KeyRound className="size-5" />
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Elige una contraseña nueva</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Hola, {perfil.nombre}. Escribe la contraseña con la que vas a entrar de ahora en adelante.
            </p>
          </div>
        </div>

        <FormularioRestablecer />
      </div>
    </main>
  );
}
