import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { KeyRound } from "lucide-react";
import { bienvenidaPendiente, perfilActual } from "@/lib/sesion";
import { FormularioCambioPassword, FormularioCorreoBienvenida } from "./formulario";

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
  if (!bienvenidaPendiente(perfil)) redirect("/");

  const cambiaPassword = perfil.debeCambiarPassword;

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <span className="bg-primary text-brand grid size-10 place-items-center rounded-lg">
            <KeyRound className="size-5" />
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">
              {cambiaPassword ? "Cambia tu contraseña" : "Registra tu correo"}
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {cambiaPassword
                ? `Hola, ${perfil.nombre}. Entraste con la contraseña que te dieron al crear tu cuenta. Elige una que sepas solo tú para poder continuar.`
                : `Hola, ${perfil.nombre}. Falta un paso: tu correo de recuperación. Si algún día olvidas tu contraseña, el enlace para elegir otra llega ahí.`}
            </p>
          </div>
        </div>

        {cambiaPassword ? <FormularioCambioPassword /> : <FormularioCorreoBienvenida />}
      </div>
    </main>
  );
}
