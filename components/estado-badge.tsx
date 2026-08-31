import { cn } from "@/lib/utils";
import { ESTADOS, type Estado } from "@/lib/dominio";

/**
 * El estado se codifica en color Y en texto: nunca solo en color.
 * Las clases van completas (no interpoladas) para que Tailwind las conserve.
 */
const ESTILOS: Record<Estado, string> = {
  registrado: "text-st-registrado bg-st-registrado-soft",
  en_proceso: "text-st-en_proceso bg-st-en_proceso-soft",
  observado: "text-st-observado bg-st-observado-soft",
  listo: "text-st-listo bg-st-listo-soft",
  en_transito: "text-st-en_transito bg-st-en_transito-soft",
  entregado: "text-st-entregado bg-st-entregado-soft",
  anulado: "text-st-anulado bg-st-anulado-soft",
};

const PUNTOS: Record<Estado, string> = {
  registrado: "bg-st-registrado",
  en_proceso: "bg-st-en_proceso",
  observado: "bg-st-observado",
  listo: "bg-st-listo",
  en_transito: "bg-st-en_transito",
  entregado: "bg-st-entregado",
  anulado: "bg-st-anulado",
};

export function EstadoBadge({
  estado,
  className,
  size = "md",
}: {
  estado: Estado;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full font-medium whitespace-nowrap",
        "ring-1 ring-current/15 ring-inset",
        size === "sm" ? "px-2 py-0.5 text-2xs" : "px-2.5 py-1 text-xs",
        ESTILOS[estado],
        className,
      )}
    >
      <span
        aria-hidden
        className={cn("size-1.5 shrink-0 rounded-full", PUNTOS[estado])}
      />
      {ESTADOS[estado]}
    </span>
  );
}

/** Barra vertical de color para el borde izquierdo de tarjetas y filas. */
export const BARRA_ESTADO: Record<Estado, string> = {
  registrado: "bg-st-registrado",
  en_proceso: "bg-st-en_proceso",
  observado: "bg-st-observado",
  listo: "bg-st-listo",
  en_transito: "bg-st-en_transito",
  entregado: "bg-st-entregado",
  anulado: "bg-st-anulado",
};
