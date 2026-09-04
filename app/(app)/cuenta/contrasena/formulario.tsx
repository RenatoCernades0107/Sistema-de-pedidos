"use client";

import { useActionState, useEffect, useRef } from "react";
import { AlertCircle, CircleCheck, LoaderCircle } from "lucide-react";
import { LARGO_MINIMO_PASSWORD } from "@/lib/esquemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { actualizarPassword, type EstadoActualizarPassword } from "./acciones";

export function FormularioActualizarPassword() {
  const [estado, enviar, pendiente] = useActionState<EstadoActualizarPassword, FormData>(
    actualizarPassword,
    {},
  );
  const formulario = useRef<HTMLFormElement>(null);

  // No hay a dónde redirigir: se queda en la misma pantalla, así que hay que
  // vaciar a mano los campos que la marca de éxito no borra sola.
  useEffect(() => {
    if (estado.exito) formulario.current?.reset();
  }, [estado.exito]);

  return (
    <form ref={formulario} action={enviar} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">Contraseña nueva</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={LARGO_MINIMO_PASSWORD}
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

      {estado.exito && (
        <p role="status" className="flex items-start gap-2 text-sm">
          <CircleCheck className="mt-0.5 size-4 shrink-0" />
          Contraseña actualizada.
        </p>
      )}

      <Button type="submit" disabled={pendiente} className="mt-1 gap-2">
        {pendiente && <LoaderCircle className="size-4 animate-spin" />}
        {pendiente ? "Guardando…" : "Guardar cambios"}
      </Button>
    </form>
  );
}
