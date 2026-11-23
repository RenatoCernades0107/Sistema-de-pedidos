"use client";

import { useActionState, useState, useTransition } from "react";
import { AlertCircle, LoaderCircle, MailCheck } from "lucide-react";
import { cerrarSesion } from "@/app/login/acciones";
import { CampoPasswordNueva } from "@/components/campo-password-nueva";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  cambiarPassword,
  comprobarCorreoConfirmado,
  registrarCorreoBienvenida,
  type EstadoCambioPassword,
  type EstadoCorreoBienvenida,
} from "./acciones";

/* Fuera de cualquier otro <form>: uno dentro de otro no es HTML válido. Está para que
   nadie se quede encerrado —una cuenta equivocada, un ordenador prestado— sin más
   salida que borrar las cookies. */
function CerrarSesion() {
  return (
    <form action={cerrarSesion} className="mt-4 text-center">
      <Button type="submit" variant="ghost" className="text-muted-foreground text-xs">
        Cerrar sesión
      </Button>
    </form>
  );
}

export function FormularioCambioPassword() {
  const [estado, enviar, pendiente] = useActionState<EstadoCambioPassword, FormData>(
    cambiarPassword,
    {},
  );

  return (
    <>
      <form action={enviar} className="flex flex-col gap-4">
        <CampoPasswordNueva autoFocus />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="confirmacion">Repite la contraseña</Label>
          <Input
            id="confirmacion"
            name="confirmacion"
            type="password"
            autoComplete="new-password"
            required
          />
        </div>

        {estado.error && (
          <p role="alert" className="text-destructive flex items-start gap-2 text-sm">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            {estado.error}
          </p>
        )}

        <Button type="submit" disabled={pendiente} className="mt-1 gap-2">
          {pendiente && <LoaderCircle className="size-4 animate-spin" />}
          {pendiente ? "Guardando…" : "Guardar y entrar"}
        </Button>
      </form>

      <CerrarSesion />
    </>
  );
}

export function FormularioCorreoBienvenida() {
  const [estado, enviar, pendiente] = useActionState<EstadoCorreoBienvenida, FormData>(
    registrarCorreoBienvenida,
    {},
  );
  const [comprobando, comprobar] = useTransition();
  const [aviso, setAviso] = useState<string | null>(null);

  return (
    <>
      <form action={enviar} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="correo">Correo de recuperación</Label>
          <Input
            id="correo"
            name="correo"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            required
            placeholder="tucorreo@ejemplo.com"
          />
        </div>

        {estado.error && (
          <p role="alert" className="text-destructive flex items-start gap-2 text-sm">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            {estado.error}
          </p>
        )}

        <Button type="submit" disabled={pendiente} className="mt-1 gap-2">
          {pendiente && <LoaderCircle className="size-4 animate-spin" />}
          {pendiente ? "Enviando…" : "Enviar enlace de confirmación"}
        </Button>
      </form>

      {estado.enviadoA && (
        <div className="mt-5 flex flex-col gap-3">
          <p role="status" className="flex items-start gap-2 text-sm leading-relaxed">
            <MailCheck className="mt-0.5 size-4 shrink-0" />
            Te enviamos un enlace a {estado.enviadoA}. Ábrelo para confirmar el correo y
            luego vuelve aquí.
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={comprobando}
            onClick={() =>
              comprobar(async () => {
                const r = await comprobarCorreoConfirmado();
                setAviso(r?.error ?? null);
              })
            }
            className="gap-2"
          >
            {comprobando && <LoaderCircle className="size-4 animate-spin" />}
            Ya lo confirmé
          </Button>
          {aviso && (
            <p role="alert" className="text-destructive flex items-start gap-2 text-sm">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              {aviso}
            </p>
          )}
        </div>
      )}

      <CerrarSesion />
    </>
  );
}
