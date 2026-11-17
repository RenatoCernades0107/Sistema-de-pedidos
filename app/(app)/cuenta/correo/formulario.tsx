"use client";

import { useActionState } from "react";
import { AlertCircle, LoaderCircle, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { guardarCorreo, type EstadoCorreo } from "./acciones";

export function FormularioCorreo({ actual }: { actual: string | null }) {
  const [estado, enviar, pendiente] = useActionState<EstadoCorreo, FormData>(guardarCorreo, {});

  return (
    <form action={enviar} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="correo">{actual ? "Correo nuevo" : "Correo de recuperación"}</Label>
        <Input
          id="correo"
          name="correo"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
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

      {estado.enviadoA && (
        <p role="status" className="flex items-start gap-2 text-sm leading-relaxed">
          <MailCheck className="mt-0.5 size-4 shrink-0" />
          Te enviamos un enlace a {estado.enviadoA}. Ábrelo para confirmar el correo; hasta
          entonces no se usa.
        </p>
      )}

      <Button type="submit" disabled={pendiente} className="mt-1 gap-2">
        {pendiente && <LoaderCircle className="size-4 animate-spin" />}
        {pendiente ? "Enviando…" : "Enviar enlace de confirmación"}
      </Button>
    </form>
  );
}
