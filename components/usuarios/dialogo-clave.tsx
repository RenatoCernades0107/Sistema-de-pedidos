"use client";

import { useState } from "react";
import { Check, Copy, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
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
 * Muestra la contraseña temporal. Se enseña una sola vez: no se guarda en ningún
 * sitio, así que si se cierra sin copiarla, hay que generar otra.
 */
export function DialogoClave({
  clave,
  nombre,
  alCerrar,
}: {
  clave: { password: string; motivo: "creada" | "restablecida" } | null;
  nombre: string;
  alCerrar: () => void;
}) {
  const [copiada, setCopiada] = useState(false);

  async function copiar() {
    if (!clave) return;
    try {
      await navigator.clipboard.writeText(clave.password);
      setCopiada(true);
      setTimeout(() => setCopiada(false), 2000);
    } catch {
      // Sin permiso al portapapeles: la contraseña sigue a la vista para seleccionarla.
    }
  }

  return (
    <Dialog open={clave !== null} onOpenChange={(v) => !v && alCerrar()} triggerId={null}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-4" />
            Contraseña temporal
          </DialogTitle>
          <DialogDescription>
            {clave?.motivo === "creada"
              ? `La cuenta de ${nombre} está creada.`
              : `Se restableció la contraseña de ${nombre}.`}{" "}
            Pásasela por WhatsApp o de viva voz: al entrar tendrá que elegir una propia.
            <strong className="text-foreground block pt-2">
              Solo se muestra ahora. Si la pierdes, genera otra.
            </strong>
          </DialogDescription>
        </DialogHeader>

        <div className="bg-muted flex items-center justify-between gap-2 rounded-lg px-4 py-3">
          <code
            className="font-mono text-lg tracking-wider select-all"
            data-testid="clave-temporal"
          >
            {clave?.password}
          </code>
          <Button type="button" variant="outline" size="sm" onClick={copiar} className="gap-1.5">
            {copiada ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copiada ? "Copiada" : "Copiar"}
          </Button>
        </div>

        <DialogFooter>
          <DialogClose render={<Button type="button" />}>Listo</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
