"use client";

import { Square, SquareDashed, X } from "lucide-react";
import type { ReferenciaCara } from "@/lib/cad/caras";
import { cn } from "@/lib/utils";

/**
 * Una cara señalada en el visor, como ficha: encima del cuadro de texto (con
 * ✕ para quitarla) y en el mensaje ya enviado (solo lectura).
 */
export function ChipCara({
  cara,
  alQuitar,
  className,
}: {
  cara: ReferenciaCara;
  alQuitar?: () => void;
  className?: string;
}) {
  const Icono = cara.tipo === "cara" ? Square : SquareDashed;
  const detalle = `${cara.ancho_mm} × ${cara.alto_mm} mm`;
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
        className,
      )}
      title={`${cara.etiqueta} · ${detalle}`}
    >
      <Icono className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{cara.etiqueta}</span>
      {alQuitar && (
        <button
          type="button"
          onClick={alQuitar}
          aria-label={`Quitar ${cara.etiqueta}`}
          className="hover:bg-foreground/10 -mr-1 rounded-full p-0.5"
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  );
}
