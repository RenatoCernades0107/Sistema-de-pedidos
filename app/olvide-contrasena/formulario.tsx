"use client";

import { useActionState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowLeft, LoaderCircle, MailCheck, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { solicitarRecuperacion, type EstadoRecuperacion } from "./acciones";

export function FormularioRecuperacion({ enlaceInvalido }: { enlaceInvalido: boolean }) {
  const [estado, enviar, pendiente] = useActionState<EstadoRecuperacion, FormData>(
    solicitarRecuperacion,
    {},
  );

  if (estado.enviado) {
    return (
      <div className="flex flex-col gap-5">
        <p
          role="status"
          className="bg-muted flex items-start gap-2.5 rounded-lg px-3 py-3 text-sm leading-relaxed"
        >
          <MailCheck className="mt-0.5 size-4 shrink-0" />
          <span>
            Si la cuenta <strong>{estado.usuario}</strong> tiene un correo de recuperación,
            te enviamos un enlace para elegir una contraseña nueva. Revisa también la carpeta
            de spam. Si no llega nada, pídele a Administración que te restablezca la contraseña.
          </span>
        </p>
        <Button variant="ghost" nativeButton={false} render={<Link href="/login" />} className="gap-2">
          <ArrowLeft className="size-4" />
          Volver a iniciar sesión
        </Button>
      </div>
    );
  }

  return (
    <form action={enviar} className="flex flex-col gap-5">
      {enlaceInvalido && !estado.error && (
        <p
          role="alert"
          className="border-destructive/25 bg-destructive/8 text-destructive flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          El enlace ya venció o no es válido. Pide uno nuevo.
        </p>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="usuario">Usuario</Label>
        <div className="relative">
          <UserRound className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            id="usuario"
            name="usuario"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            required
            defaultValue={estado.usuario}
            placeholder="Ingresa tu usuario"
            className="h-11 pl-9"
          />
        </div>
      </div>

      {estado.error && (
        <p
          role="alert"
          className="border-destructive/25 bg-destructive/8 text-destructive flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {estado.error}
        </p>
      )}

      <Button type="submit" disabled={pendiente} className="h-11 w-full gap-2 text-sm font-semibold">
        {pendiente && <LoaderCircle className="size-4 animate-spin" />}
        {pendiente ? "Enviando…" : "Enviar enlace"}
      </Button>

      <Button variant="ghost" nativeButton={false} render={<Link href="/login" />} className="gap-2">
        <ArrowLeft className="size-4" />
        Volver a iniciar sesión
      </Button>
    </form>
  );
}
