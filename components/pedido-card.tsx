"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/store";
import {
  UBICACIONES,
  saldoDe,
  type Pedido,
} from "@/lib/dominio";
import {
  diaMes,
  diaMesTexto,
  fechaCompleta,
  money,
  urgenciaDe,
} from "@/lib/formato";
import { BARRA_ESTADO, EstadoBadge } from "@/components/estado-badge";
import { ResumenItems } from "@/components/resumen-items";

const CLASE_URGENCIA = {
  vencido: "text-st-observado",
  hoy: "text-st-en_transito",
  proximo: "text-foreground",
  normal: "text-muted-foreground",
  cerrado: "text-muted-foreground",
} as const;

/**
 * Jerarquía decidida: el cliente manda, el código lo sigue, y la fecha solo
 * grita cuando está vencida o vence hoy. Todo lo demás es contexto en gris.
 * Para quien no puede ver al cliente, el código hereda el primer puesto.
 */
export function PedidoCard({
  pedido: p,
  conAño = false,
}: {
  pedido: Pedido;
  /** Fechas con año: en el historial se mezclan años. */
  conAño?: boolean;
}) {
  const { permisos } = useStore();
  const urgencia = urgenciaDe(p);
  const saldo = saldoDe(p);

  return (
    <li className="relative">
      <Link
        href={`/pedidos/${p.codigo}`}
        className={cn(
          "bg-card group relative flex gap-3 overflow-hidden rounded-xl border p-3 pl-4 transition-colors",
          "hover:border-ring/40 focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "absolute inset-y-0 left-0 w-1",
            BARRA_ESTADO[p.estado],
          )}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            {/* Sin permiso para ver al cliente, el código pasa a ser el título:
                la tarjeta necesita algo con lo que nombrarse. */}
            <p
              className={cn(
                "min-w-0 flex-1 truncate font-medium",
                !permisos.verCliente && "text-primary tabular-nums",
              )}
            >
              {permisos.verCliente ? p.cliente : p.codigo}
            </p>
            <span
              className={cn(
                "tnum shrink-0 text-xs font-medium",
                CLASE_URGENCIA[urgencia],
              )}
            >
              {(conAño ? fechaCompleta : diaMes)(p.fechaPrometida)}
              {urgencia === "vencido" && " · vencido"}
              {urgencia === "hoy" && " · hoy"}
            </span>
          </div>

          <p className="text-primary mt-0.5 truncate text-xs font-medium tabular-nums">
            {permisos.verCliente && <>{p.codigo} · </>}
            {p.esProvincia && (
              <span className="text-st-en_transito font-semibold">
                PROVINCIA ·{" "}
              </span>
            )}
            {/* Con la palabra delante: suelta, se leería como la prometida. */}
            <span className="text-muted-foreground font-normal">
              Registrado {diaMesTexto(p.fechaCreacion, conAño)}
            </span>
          </p>

          {/* Lo que lleva: el primer ítem y cuántos más. */}
          <ResumenItems items={p.items} className="text-foreground/80 mt-1.5 text-xs" />
          <p className="text-muted-foreground mt-0.5 truncate text-xs">
            {UBICACIONES[p.ubicacion]}
            {p.responsable ? ` · ${p.responsable}` : ""}
          </p>

          <div className="mt-2.5 flex items-center gap-2">
            <EstadoBadge estado={p.estado} size="sm" />
            {permisos.verMontos && (
              <span
                className={cn(
                  "tnum ml-auto text-xs",
                  saldo > 0
                    ? "text-saldo-alerta parpadeo-alerta font-bold"
                    : "text-muted-foreground font-medium",
                )}
              >
                {saldo > 0 ? money(saldo) : "Pagado"}
              </span>
            )}
            <ChevronRight
              className={cn(
                "text-muted-foreground/50 size-4 shrink-0",
                permisos.verMontos ? "" : "ml-auto",
              )}
            />
          </div>
        </div>
      </Link>
    </li>
  );
}
