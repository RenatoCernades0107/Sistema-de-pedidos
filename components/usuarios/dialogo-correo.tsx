"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { fijarCorreoDe } from "@/app/(app)/usuarios/acciones";
import { Button } from "@/components/ui/button";
import { Campo } from "@/components/ui/campo";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Registra o cambia el correo de recuperación de una cuenta. Queda confirmado de
 * una vez —no sale ningún enlace—: Administración responde por la dirección que
 * escribe, así que conviene mirar bien que esté bien escrita.
 */
export function DialogoCorreo({
  cuenta,
  alCerrar,
}: {
  cuenta: { id: string; nombre: string; correo: string | null } | null;
  alCerrar: () => void;
}) {
  return (
    <Dialog open={cuenta !== null} onOpenChange={(v) => !v && alCerrar()} triggerId={null}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Correo de recuperación</DialogTitle>
          <DialogDescription>
            A este correo le llega el enlace cuando {cuenta?.nombre} olvide su contraseña. Se
            usa tal cual, sin pedirle que lo confirme.
          </DialogDescription>
        </DialogHeader>
        {/* Se monta de nuevo con cada apertura para no arrastrar lo escrito antes. */}
        {cuenta && <Formulario key={cuenta.id} cuenta={cuenta} alCerrar={alCerrar} />}
      </DialogContent>
    </Dialog>
  );
}

function Formulario({
  cuenta,
  alCerrar,
}: {
  cuenta: { id: string; nombre: string; correo: string | null };
  alCerrar: () => void;
}) {
  const [correo, setCorreo] = useState(cuenta.correo ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    iniciar(async () => {
      const r = await fijarCorreoDe({ id: cuenta.id, correo });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      toast.success("Correo guardado", { description: correo.trim().toLowerCase() });
      alCerrar();
    });
  }

  return (
    <form onSubmit={guardar} noValidate className="flex flex-col gap-4">
      <Campo label="Correo" requerido error={error ?? undefined}>
        <Input
          type="email"
          inputMode="email"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus
          value={correo}
          onChange={(e) => setCorreo(e.target.value)}
          placeholder="trabajador@ejemplo.com"
          aria-invalid={!!error}
        />
      </Campo>
      <DialogFooter>
        <DialogClose render={<Button variant="outline" type="button" />}>Cancelar</DialogClose>
        <Button type="submit" disabled={pendiente || !correo.trim()}>
          {pendiente ? "Guardando…" : "Guardar correo"}
        </Button>
      </DialogFooter>
    </form>
  );
}
