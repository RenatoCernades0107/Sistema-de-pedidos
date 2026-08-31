"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/store";
import {
  ESTADOS,
  ORDEN_ESTADOS,
  etiquetaTipos,
  type Estado,
  type Pedido,
} from "@/lib/dominio";
import {
  ETIQUETA_SEMAFORO,
  cantidadCorta,
  diaMes,
  semaforoDe,
  urgenciaDe,
  type Semaforo,
} from "@/lib/formato";
import { BARRA_ESTADO } from "@/components/estado-badge";

const PUNTO: Record<Estado, string> = BARRA_ESTADO;

/** Verde a tiempo, naranja la víspera, rojo el día prometido en adelante. */
const SEMAFORO: Record<Semaforo, string> = {
  verde: "bg-st-entregado",
  naranja: "bg-st-en_transito",
  rojo: "bg-st-observado",
  cerrado: "bg-muted-foreground/30",
};

export function PedidosKanban({ pedidos }: { pedidos: Pedido[] }) {
  const { permisos } = useStore();

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2 md:-mx-6 md:px-6">
      <div className="flex min-w-max gap-3">
        {ORDEN_ESTADOS.map((estado) => {
          const columna = pedidos.filter((p) => p.estado === estado);
          return (
            <section
              key={estado}
              className="bg-muted/40 flex w-64 shrink-0 flex-col gap-2 rounded-xl border p-2"
            >
              <header className="flex items-center gap-2 px-1 py-1">
                <span
                  className={cn("size-2 rounded-full", PUNTO[estado])}
                  aria-hidden
                />
                <h3 className="text-xs font-medium">{ESTADOS[estado]}</h3>
                <span className="tnum text-muted-foreground ml-auto text-xs">
                  {columna.length}
                </span>
              </header>

              {columna.length === 0 ? (
                <p className="text-muted-foreground/70 rounded-lg border border-dashed py-6 text-center text-xs">
                  Sin pedidos
                </p>
              ) : (
                columna.map((p, i) => (
                  <motion.div
                    key={p.codigo}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: 0.16,
                      delay: Math.min(i * 0.02, 0.12),
                    }}
                  >
                    <Link
                      href={`/pedidos/${p.codigo}`}
                      className={cn(
                        "bg-card hover:border-ring/40 focus-visible:ring-ring block rounded-lg border p-2.5 transition-colors focus-visible:ring-2 focus-visible:outline-none",
                      )}
                    >
                      <p className="text-primary text-2xs font-medium tabular-nums">
                        {p.codigo}
                      </p>
                      {permisos.verCliente && (
                        <p className="mt-1 line-clamp-2 text-xs font-medium">
                          {p.cliente}
                        </p>
                      )}

                      {/* El semáforo mira la fecha prometida; el nombre dice a
                          quién preguntarle. Juntos son la línea que se escanea
                          de un vistazo al repartir el trabajo del día. */}
                      <p
                        className={cn(
                          "flex items-center gap-1.5 text-xs",
                          permisos.verCliente ? "mt-1.5" : "mt-1",
                        )}
                      >
                        <span
                          className={cn(
                            "size-2 shrink-0 rounded-full",
                            SEMAFORO[semaforoDe(p)],
                          )}
                          aria-hidden
                        />
                        <span
                          className={cn(
                            "truncate",
                            p.responsable
                              ? "font-medium"
                              : "text-muted-foreground/70",
                          )}
                        >
                          {p.responsable ?? "Sin asignar"}
                        </span>
                        <span className="sr-only">
                          · {ETIQUETA_SEMAFORO[semaforoDe(p)]}
                        </span>
                      </p>

                      <p className="text-muted-foreground mt-1.5 flex items-center gap-1.5 text-2xs">
                        <span className="truncate">
                          <span className="tnum">{cantidadCorta(p)}</span> ·{" "}
                          {etiquetaTipos(p.tipos)}
                        </span>
                        <span
                          className={cn(
                            "tnum ml-auto shrink-0",
                            urgenciaDe(p) === "vencido" &&
                              "text-st-observado font-medium",
                            urgenciaDe(p) === "hoy" &&
                              "text-st-en_transito font-medium",
                          )}
                        >
                          {diaMes(p.fechaPrometida)}
                        </span>
                      </p>
                    </Link>
                  </motion.div>
                ))
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
