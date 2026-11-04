"use client";

import { useActionState, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertCircle, ArrowRight, Eye, EyeOff, LoaderCircle, LockKeyhole, UserRound } from "lucide-react";
import { iniciarSesion, type EstadoLogin } from "./acciones";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function FormularioLogin() {
  const [estado, enviar, pendiente] = useActionState<EstadoLogin, FormData>(
    iniciarSesion,
    {},
  );
  const [verPassword, setVerPassword] = useState(false);
  const siguiente = useSearchParams().get("siguiente") ?? "";

  return (
    <form action={enviar} className="flex flex-col gap-5">
      <input type="hidden" name="siguiente" value={siguiente} />

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
            aria-invalid={estado.error ? true : undefined}
            className="h-11 pl-9"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Contraseña</Label>
        <div className="relative">
          <LockKeyhole className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            id="password"
            name="password"
            type={verPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            placeholder="Ingresa tu contraseña"
            aria-invalid={estado.error ? true : undefined}
            className="h-11 pr-11 pl-9"
          />
          <button
            type="button"
            onClick={() => setVerPassword((v) => !v)}
            aria-pressed={verPassword}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 absolute top-1/2 right-1.5 grid size-8 -translate-y-1/2 place-items-center rounded-md transition-colors outline-none focus-visible:ring-3"
          >
            {/* Nombre por contenido, no aria-label: así `getByLabel("Contraseña")` sigue
                apuntando solo al campo. */}
            <span className="sr-only">{verPassword ? "Ocultar contraseña" : "Mostrar contraseña"}</span>
            {verPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
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

      <Button
        type="submit"
        disabled={pendiente}
        className="group mt-2 h-11 w-full gap-2 text-sm font-semibold"
      >
        {pendiente ? (
          <>
            <LoaderCircle className="size-4 animate-spin" />
            Ingresando…
          </>
        ) : (
          <>
            Ingresar
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </>
        )}
      </Button>
    </form>
  );
}
