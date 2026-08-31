"use client";

import { useActionState } from "react";
import { AlertCircle, LoaderCircle } from "lucide-react";
import { cerrarSesion } from "@/app/login/acciones";
import { LARGO_MINIMO_PASSWORD } from "@/lib/esquemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cambiarPassword, type EstadoCambioPassword } from "./acciones";

export function FormularioCambioPassword() {
  const [estado, enviar, pendiente] = useActionState<EstadoCambioPassword, FormData>(
    cambiarPassword,
    {},
  );

  return (
    <>
      <form action={enviar} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Contraseña nueva</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={LARGO_MINIMO_PASSWORD}
            autoFocus
            required
            aria-describedby="ayuda-password"
          />
          <p id="ayuda-password" className="text-muted-foreground text-xs">
            Al menos {LARGO_MINIMO_PASSWORD} caracteres.
          </p>
        </div>

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

      {/* Fuera del formulario de arriba: un <form> dentro de otro no es HTML válido.
          Está aquí para que nadie se quede encerrado —una cuenta equivocada, un
          ordenador prestado— sin más salida que borrar las cookies. */}
      <form action={cerrarSesion} className="mt-4 text-center">
        <Button type="submit" variant="ghost" className="text-muted-foreground text-xs">
          Cerrar sesión
        </Button>
      </form>
    </>
  );
}
