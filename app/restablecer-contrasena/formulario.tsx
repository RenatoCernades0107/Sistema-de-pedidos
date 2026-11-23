"use client";

import { useActionState } from "react";
import { AlertCircle, LoaderCircle } from "lucide-react";
import { CampoPasswordNueva } from "@/components/campo-password-nueva";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { restablecerPassword, type EstadoRestablecer } from "./acciones";

export function FormularioRestablecer() {
  const [estado, enviar, pendiente] = useActionState<EstadoRestablecer, FormData>(
    restablecerPassword,
    {},
  );

  return (
    <form action={enviar} className="flex flex-col gap-4">
      <CampoPasswordNueva autoFocus />

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="confirmacion">Repite la contraseña</Label>
        <Input id="confirmacion" name="confirmacion" type="password" autoComplete="new-password" required />
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
  );
}
