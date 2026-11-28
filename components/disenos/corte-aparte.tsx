"use client";

import { useState } from "react";
import { Check, Scissors } from "lucide-react";
import type { MaterialRef } from "@/lib/cad/materiales";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Para una copia que se corta en un material que NO está en el catálogo de
 * planchas (MDF, por ejemplo): no se acomoda en una plancha ni da error, y se baja
 * aparte como DXF suelto. El nombre es libre («MDF 12 mm»).
 */
export function CorteAparte({
  material,
  deshabilitado,
  alElegir,
}: {
  /** El material vigente de la copia. */
  material: MaterialRef | null;
  deshabilitado: boolean;
  alElegir: (m: MaterialRef) => void;
}) {
  const actual = material?.corteAparte ? material.material : null;
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState(actual ?? "MDF");

  const aplicar = () => {
    const limpio = nombre.trim().slice(0, 80);
    if (!limpio) return;
    setAbierto(false);
    alElegir({ material: limpio, variante: "", detalle: "", color: null, corteAparte: true });
  };

  if (!abierto) {
    return (
      <div className="flex flex-col gap-1">
        {actual && (
          <p className="text-xs break-words">
            <span className="font-medium">Corte aparte:</span> {actual}. No va en una plancha: se baja como DXF suelto.
          </p>
        )}
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 self-start text-xs underline-offset-2 hover:underline disabled:opacity-50"
          disabled={deshabilitado}
          onClick={() => {
            setNombre(actual ?? nombre);
            setAbierto(true);
          }}
        >
          <Scissors className="size-3" aria-hidden />
          {actual ? "Cambiar el material de corte aparte" : "Corte aparte (material que no está en el catálogo)"}
        </button>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        aplicar();
      }}
    >
      <label className="text-muted-foreground text-xs font-medium" htmlFor="corte-aparte-nombre">
        Material de corte aparte
      </label>
      <div className="flex items-center gap-1.5">
        <Input
          id="corte-aparte-nombre"
          autoFocus
          value={nombre}
          maxLength={80}
          placeholder="MDF 12 mm"
          onChange={(e) => setNombre(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setAbierto(false)}
        />
        <Button type="submit" size="icon-sm" disabled={deshabilitado || !nombre.trim()}>
          <Check />
          <span className="sr-only">Aplicar</span>
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        Sin plancha del catálogo: no entra en el acomodo y se descarga aparte, por diseño.
      </p>
    </form>
  );
}
