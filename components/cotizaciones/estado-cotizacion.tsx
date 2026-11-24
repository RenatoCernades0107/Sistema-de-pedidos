import {
  CANALES,
  ESTADOS_COTIZACION,
  SINCRONIZACION,
  etiquetaVersion,
  type Canal,
  type Cotizacion,
  type EstadoCotizacion,
  type Sincronizacion,
} from "@/lib/cotizaciones";
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

const ESTILOS_ESTADO: Record<EstadoCotizacion, string> = {
  borrador: "text-st-registrado bg-st-registrado-soft",
  enviada: "text-primary bg-primary/10",
  reemplazada: "text-muted-foreground bg-muted line-through decoration-muted-foreground/50",
};

/**
 * Borrador (se edita), enviada (bloqueada) o reemplazada (hay una versión más
 * nueva), con "v2", "v3"… desde la segunda versión. Una cotización con pedido ya
 * no es nada de eso: lo dice `PedidoBadge`, y aquí no se muestra.
 */
export function EstadoDeCotizacion({
  cotizacion: c,
  className,
}: {
  cotizacion: Pick<Cotizacion, "estado" | "version" | "pedido">;
  className?: string;
}) {
  const version = etiquetaVersion(c);
  if (c.pedido && c.estado !== "reemplazada") {
    return version ? <VersionBadge version={version} className={className} /> : null;
  }
  return (
    <span
      data-testid="estado-cotizacion"
      className={cn(
        "text-2xs inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-medium whitespace-nowrap ring-1 ring-current/15 ring-inset",
        ESTILOS_ESTADO[c.estado],
        className,
      )}
    >
      {ESTADOS_COTIZACION[c.estado]}
      {version && <span className="tnum">· {version}</span>}
    </span>
  );
}

function VersionBadge({ version, className }: { version: string; className?: string }) {
  return (
    <span
      className={cn(
        "text-2xs text-muted-foreground tnum inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 font-medium",
        className,
      )}
    >
      {version}
    </span>
  );
}
