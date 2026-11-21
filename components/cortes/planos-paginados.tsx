"use client";

import { useState, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { CalculoCorte } from "@/lib/cortes/calcular";
import { resumenCortes } from "@/lib/cortes/metros";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { LeyendaPlano, PlanoCorte } from "./plano-corte";

/**
 * Los planos de un corte, de a uno por página.
 *
 * Con muchas planchas, cada plano sale grande y legible en vez de una cuadrícula
 * de miniaturas. Con una sola plancha no hay controles.
 */
export function PlanosPaginados({
  planchas,
  className,
}: {
  planchas: CalculoCorte["planchas"];
  className?: string;
}) {
  const [pagina, setPagina] = useState(0);
  const total = planchas.length;
  if (total === 0) return null;

  // Si al editar las piezas quedan menos planchas, la página se queda en la última.
  const actual = Math.min(pagina, total - 1);
  const p = planchas[actual];
  const irA = (n: number) => setPagina(Math.max(0, Math.min(total - 1, n)));

  const alTeclear = (e: KeyboardEvent<HTMLDivElement>) => {
    if (total < 2 || e.target !== e.currentTarget) return;
    if (e.key === "ArrowLeft") irA(actual - 1);
    else if (e.key === "ArrowRight") irA(actual + 1);
    else return;
    e.preventDefault();
  };

  return (
    <div
      tabIndex={total > 1 ? 0 : undefined}
      onKeyDown={alTeclear}
      className={cn(
        "focus-visible:ring-ring flex flex-col gap-3 rounded-lg focus-visible:ring-2 focus-visible:outline-none",
        className,
      )}
    >
      {total > 1 && (
        <nav aria-label="Planchas del corte" className="flex items-center justify-between gap-3 text-sm">
          <Button type="button" variant="outline" size="sm" disabled={actual === 0} onClick={() => irA(actual - 1)}>
            <ChevronLeft />
            Anterior
          </Button>
          <span className="text-muted-foreground tnum" aria-live="polite">
            Plancha {actual + 1} de {total}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={actual === total - 1}
            onClick={() => irA(actual + 1)}
          >
            Siguiente
            <ChevronRight />
          </Button>
        </nav>
      )}

      <figure className="flex flex-col gap-1.5">
        <PlanoCorte plancha={p} cortes={p.cortes} titulo={`Plancha ${actual + 1} de ${total}`} />
        <figcaption className="text-muted-foreground text-xs">
          {p.origen.tipo === "sobrante" ? (
            <span className="text-foreground font-medium">Sobrante {p.origen.id} · </span>
          ) : (
            `Plancha ${actual + 1} · `
          )}
          {p.piezas} {p.piezas === 1 ? "pieza" : "piezas"} · {Math.round(p.usoPct)} % usado
          {p.cortes && <> · {resumenCortes(p.cortes)}</>}
        </figcaption>
      </figure>

      <LeyendaPlano
        conSobrante={planchas.some((x) => x.cobro.factor < 1)}
        conCortes={planchas.some((x) => !!x.cortes?.length)}
      />
    </div>
  );
}
