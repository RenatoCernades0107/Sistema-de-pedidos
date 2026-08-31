import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { KeyRound } from "lucide-react";
import { perfilActual } from "@/lib/sesion";
import { FormularioCambioPassword } from "./formulario";

export const metadata: Metadata = {
  title: "Cambia tu contraseña · Plexiacril",
};

/**
 * La primera pantalla de una cuenta nueva. Vive fuera del grupo `(app)` a
 * propósito: sin la cabecera y sin cargar un solo pedido, porque hasta que la
 * contraseña no cambie no hay nada que esta persona deba llegar a ver.
 *
 * Lee el perfil con `perfilActual` y no con `exigirSesion`, que es justo el que
 * manda aquí: llamarlo sería redirigirse a sí misma sin fin.
 */
export default async function CambiarContrasenaPage() {
  const perfil = await perfilActual();

  if (!perfil) redirect("/login");
  if (!perfil.debeCambiarPassword) redirect("/");

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <span className="bg-primary text-brand grid size-10 place-items-center rounded-lg">
            <KeyRound className="size-5" />
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">
              Cambia tu contraseña
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Hola, {perfil.nombre}. Entraste con la contraseña que te dieron al crear
              tu cuenta. Elige una que sepas solo tú para poder continuar.
            </p>
          </div>
        </div>

        <FormularioCambioPassword />
      </div>
    </main>
  );
}
