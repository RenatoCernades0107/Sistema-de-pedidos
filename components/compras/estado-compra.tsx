import { ESTADOS_COMPRA, type EstadoCompra } from "@/lib/compras";
import { cn } from "@/lib/utils";

/** El estado de una compra. Color y texto, nunca solo color. */
const ESTILOS: Record<EstadoCompra, string> = {
  borrador: "text-muted-foreground bg-muted",
  confirmada: "text-st-en_proceso bg-st-en_proceso-soft",
  recibida_parcial: "text-st-en_proceso bg-st-en_proceso-soft",
  recibida: "text-primary bg-primary/10",
  liquidada: "text-st-entregado bg-st-entregado-soft",
  anulada: "text-st-anulado bg-st-anulado-soft",
};

export function EstadoCompraBadge({ estado, className }: { estado: EstadoCompra; className?: string }) {
  return (
    <span
      className={cn(
        "text-2xs inline-flex shrink-0 items-center rounded-full px-2 py-0.5 font-medium whitespace-nowrap ring-1 ring-current/15 ring-inset",
        ESTILOS[estado],
        className,
      )}
    >
      {ESTADOS_COMPRA[estado]}
    </span>
  );
}
