"use client";

import { Children, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  planchasPorPaginaDefecto,
  rangoDePlanchas,
  ventanaDePagina,
  type PlanchasPorPagina,
} from "@/lib/cortes/paginacion";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/** El mismo corte que `md:` de Tailwind (48rem): desde ahí caben varios planos a la vez. */
const ANCHO_ESCRITORIO = "(min-width: 48rem)";

function useEsAncho() {
  return useSyncExternalStore(
    (aviso) => {
      const consulta = window.matchMedia(ANCHO_ESCRITORIO);
      consulta.addEventListener("change", aviso);
      return () => consulta.removeEventListener("change", aviso);
    },
    () => window.matchMedia(ANCHO_ESCRITORIO).matches,
    () => false,
  );
}

/**
 * Los planos de un corte por páginas: una plancha por página en el móvil y 2 o 4
 * (cuadrícula 2×2) en pantallas anchas. Con una cotización de decenas de planchas
 * evita un scroll interminable.
 *
 * Cada plano llega como un hijo (así lo puede usar un componente de servidor).
 * Si todos caben en una página, se muestran sin controles. Con flechas ←/→
 * (y Inicio/Fin) se cambia de página cuando el bloque tiene el foco.
 */
export function PlanchasPaginadas({
  children,
  etiqueta = "Planchas del corte",
  porPagina,
  columnas = "grid-cols-1 md:grid-cols-2",
  className,
}: {
  children: ReactNode;
  /** Nombre de la navegación para lectores de pantalla. */
  etiqueta?: string;
  /** Planchas por página en móvil y en escritorio. Por defecto: 1, y 4 (o 2 si hay menos de 4). */
  porPagina?: PlanchasPorPagina;
  /** Clases de columnas de la cuadrícula (se usan cuando hay más de un plano por página). */
  columnas?: string;
  className?: string;
}) {
  const ancho = useEsAncho();
  // Se guarda la plancha por la que se va (no el número de página): al girar el
  // teléfono o cambiar el tamaño de la ventana se sigue viendo la misma.
  const [inicio, setInicio] = useState(0);
  const planos = Children.toArray(children);
  const total = planos.length;
  if (total === 0) return null;

  const por = porPagina ? (ancho ? porPagina.escritorio : porPagina.movil) : planchasPorPaginaDefecto(total, ancho);
  const { desde, hasta, pagina, paginas } = ventanaDePagina(total, inicio, por);
  const conControles = paginas > 1;
  const irA = (p: number) => setInicio(Math.max(0, Math.min(paginas - 1, p)) * Math.max(1, por));

  const alTeclear = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!conControles || e.target !== e.currentTarget) return;
    if (e.key === "ArrowLeft") irA(pagina - 1);
    else if (e.key === "ArrowRight") irA(pagina + 1);
    else if (e.key === "Home") irA(0);
    else if (e.key === "End") irA(paginas - 1);
    else return;
    e.preventDefault();
  };

  return (
    <div
      tabIndex={conControles ? 0 : undefined}
      onKeyDown={alTeclear}
      data-testid="planchas-paginadas"
      className={cn(
        "focus-visible:ring-ring flex flex-col gap-3 rounded-lg focus-visible:ring-2 focus-visible:outline-none",
        className,
      )}
    >
      {conControles && (
        <nav aria-label={etiqueta} className="flex items-center print:hidden justify-between gap-3 text-sm">
          <Button type="button" variant="outline" size="sm" disabled={pagina === 0} onClick={() => irA(pagina - 1)}>
            <ChevronLeft />
            Anterior
          </Button>
          <span className="text-muted-foreground tnum text-center" aria-live="polite" aria-atomic="true">
            {rangoDePlanchas(desde, hasta, total)}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pagina === paginas - 1}
            onClick={() => irA(pagina + 1)}
          >
            Siguiente
            <ChevronRight />
          </Button>
        </nav>
      )}

      {/* Los de otras páginas quedan ocultos en pantalla, pero al imprimir salen todos. */}
      <div className={cn("grid gap-3 print:grid-cols-2", por > 1 ? columnas : "grid-cols-1")}>
        {planos.map((plano, i) => (
          <div key={i} className={cn("contents", (i < desde || i >= hasta) && "hidden print:contents")}>
            {plano}
          </div>
        ))}
      </div>
    </div>
  );
}
