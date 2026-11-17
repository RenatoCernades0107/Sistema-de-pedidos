import type { Metadata } from "next";
import { CircleCheck, Mail } from "lucide-react";
import { exigirSesion } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase-servidor";
import { FormularioCorreo } from "./formulario";

export const metadata: Metadata = {
  title: "Correo de recuperación · Plexiacril",
};

/**
 * El correo al que llega el enlace de "olvidé mi contraseña". Se llega por el menú
 * de usuario. El usuario con el que se entra no cambia: solo la dirección a la que
 * Auth le escribe.
 */
export default async function CorreoPage({
  searchParams,
}: {
  searchParams: Promise<{ confirmado?: string }>;
}) {
  const [{ confirmado }, sesion] = await Promise.all([searchParams, exigirSesion()]);

  const supabase = await clienteServidor();
  // Por id: Administración ve todas las filas de `usuarios`, no solo la suya.
  const [{ data: perfil }, { data: { user } }] = await Promise.all([
    supabase.from("usuarios").select("email_recuperacion").eq("id", sesion.id).maybeSingle(),
    supabase.auth.getUser(),
  ]);

  const actual = perfil?.email_recuperacion ?? null;
  const pendiente = user?.new_email ?? null;

  return (
    <div className="mx-auto w-full max-w-sm px-4 py-6">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Correo de recuperación</h1>
        <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
          Si algún día olvidas tu contraseña, el enlace para elegir otra llega a este correo.
          Sigues entrando con tu usuario de siempre.
        </p>
      </header>

      {confirmado && actual && (
        <p role="status" className="bg-muted mb-5 flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm">
          <CircleCheck className="mt-0.5 size-4 shrink-0" />
          Listo, tu correo quedó confirmado.
        </p>
      )}

      <div className="mb-6 flex items-start gap-2.5 text-sm">
        <Mail className="text-muted-foreground mt-0.5 size-4 shrink-0" />
        <div>
          {actual ? (
            <>
              <p className="font-medium">{actual}</p>
              <p className="text-muted-foreground text-xs">Correo de recuperación actual</p>
            </>
          ) : (
            <>
              <p className="font-medium">Sin correo registrado</p>
              <p className="text-muted-foreground text-xs">
                Mientras no registres uno, no podrás recuperar la contraseña por tu cuenta.
              </p>
            </>
          )}
          {pendiente && (
            <p className="text-muted-foreground mt-1.5 text-xs">
              Pendiente de confirmar: {pendiente}
            </p>
          )}
        </div>
      </div>

      <FormularioCorreo actual={actual} />
    </div>
  );
}
