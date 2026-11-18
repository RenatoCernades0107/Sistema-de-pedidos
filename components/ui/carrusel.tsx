"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Varias vistas en el mismo hueco, una a la vez: flechas a los lados y puntos
 * abajo. No se cambia arrastrando, porque una de las vistas puede ser un 3D que
 * se gira arrastrando; con el foco puesto, también con ← y →.
 *
 * Con una sola vista no hay controles; sin ninguna, no pinta nada.
 */
export function Carrusel({
  diapositivas,
  etiqueta,
  className,
}: {
  diapositivas: { clave: string; nombre: string; contenido: React.ReactNode }[];
  /** Qué se está mostrando, para el lector de pantalla: «Vistas del producto». */
  etiqueta: string;
  className?: string;
}) {
  const [i, setI] = useState(0);
  const total = diapositivas.length;
  if (total === 0) return null;
  const actual = Math.min(i, total - 1);
  const ir = (n: number) => setI((n + total) % total);

  return (
    <section
      aria-roledescription="carrusel"
      aria-label={etiqueta}
      tabIndex={total > 1 ? 0 : undefined}
      onKeyDown={(e) => {
        if (total < 2) return;
        if (e.key === "ArrowLeft") ir(actual - 1);
        else if (e.key === "ArrowRight") ir(actual + 1);
        else return;
        e.preventDefault();
      }}
      className={cn(
        "group/carrusel focus-visible:ring-ring relative overflow-hidden rounded-lg focus-visible:ring-2 focus-visible:outline-none",
        className,
      )}
    >
      <div
        className="flex transition-transform duration-300 ease-out motion-reduce:transition-none"
        style={{ transform: `translateX(-${actual * 100}%)` }}
      >
        {diapositivas.map((d, n) => (
          <div
            key={d.clave}
            className="w-full shrink-0"
            aria-roledescription="diapositiva"
            aria-label={`${n + 1} de ${total}: ${d.nombre}`}
            aria-hidden={n !== actual}
            inert={n !== actual}
          >
            {d.contenido}
          </div>
        ))}
      </div>

      {total > 1 && (
        <>
          <Flecha lado="izquierda" alPulsar={() => ir(actual - 1)} />
          <Flecha lado="derecha" alPulsar={() => ir(actual + 1)} />
          <div className="absolute inset-x-0 bottom-1.5 flex justify-center gap-1.5">
            {diapositivas.map((d, n) => (
              <button
                key={d.clave}
                type="button"
                onClick={() => setI(n)}
                aria-label={`Ver ${d.nombre}`}
                aria-current={n === actual}
                className={cn(
                  "size-2 rounded-full ring-1 ring-black/10 transition-colors",
                  n === actual ? "bg-primary" : "bg-white/80 hover:bg-white",
                )}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function Flecha({ lado, alPulsar }: { lado: "izquierda" | "derecha"; alPulsar: () => void }) {
  const Icono = lado === "izquierda" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={alPulsar}
      aria-label={lado === "izquierda" ? "Anterior" : "Siguiente"}
      className={cn(
        "bg-card/90 text-foreground absolute top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full border shadow-sm",
        "hover:bg-card focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
        lado === "izquierda" ? "left-1.5" : "right-1.5",
      )}
    >
      <Icono className="size-4" />
    </button>
  );
}
