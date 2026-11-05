import { CANALES, SINCRONIZACION, type Canal, type Sincronizacion } from "@/lib/cotizaciones";
import { cn } from "@/lib/utils";

/** Si ya está en Odoo. Color y texto, nunca solo color. */
const ESTILOS: Record<Sincronizacion, string> = {
  sincronizada: "text-st-entregado bg-st-entregado-soft",
  pendiente: "text-st-en_proceso bg-st-en_proceso-soft",
  error: "text-st-anulado bg-st-anulado-soft",
};

const PUNTOS: Record<Sincronizacion, string> = {
  sincronizada: "bg-st-entregado",
  pendiente: "bg-st-en_proceso",
  error: "bg-st-anulado",
};

export function EstadoSincronizacion({
  estado,
  className,
}: {
  estado: Sincronizacion;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "text-2xs inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 font-medium whitespace-nowrap ring-1 ring-current/15 ring-inset",
        ESTILOS[estado],
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", PUNTOS[estado])} />
      {SINCRONIZACION[estado]}
    </span>
  );
}

export function CanalBadge({ canal, className }: { canal: Canal; className?: string }) {
  return (
    <span
      className={cn(
        "text-2xs inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 font-medium whitespace-nowrap",
        canal === "whatsapp" ? "border-emerald-600/30 text-emerald-700 dark:text-emerald-400" : "text-muted-foreground",
        className,
      )}
    >
      {CANALES[canal]}
    </span>
  );
}

/** La cotización ya salió a producción: el pedido que generó. */
export function PedidoBadge({ codigo, className }: { codigo: string; className?: string }) {
  return (
    <span
      className={cn(
        "text-2xs text-st-entregado bg-st-entregado-soft tnum inline-flex shrink-0 items-center rounded-full px-2 py-0.5 font-medium whitespace-nowrap ring-1 ring-current/15 ring-inset",
        className,
      )}
    >
      Pedido {codigo}
    </span>
  );
}
