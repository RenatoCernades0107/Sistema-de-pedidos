"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertCircle, LoaderCircle } from "lucide-react";
import { iniciarSesion, type EstadoLogin } from "./acciones";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function FormularioLogin() {
  const [estado, enviar, pendiente] = useActionState<EstadoLogin, FormData>(
    iniciarSesion,
    {},
  );
  const siguiente = useSearchParams().get("siguiente") ?? "";

  return (
    <form action={enviar} className="flex flex-col gap-4">
      <input type="hidden" name="siguiente" value={siguiente} />

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="usuario">Usuario</Label>
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
          placeholder="ana"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">Contraseña</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>

      {estado.error && (
        <p
          role="alert"
          className="text-destructive flex items-start gap-2 text-sm"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {estado.error}
        </p>
      )}

      <Button type="submit" disabled={pendiente} className="mt-1 gap-2">
        {pendiente && <LoaderCircle className="size-4 animate-spin" />}
        {pendiente ? "Entrando…" : "Entrar"}
      </Button>
    </form>
  );
}
