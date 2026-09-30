"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useStore } from "@/lib/store";
import { hoy as hoyEnLima } from "@/lib/fecha";
import { PERIODOS, etiquetaDia, resolverPeriodo, type ClavePeriodo } from "@/lib/metricas";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SelectorPeriodo } from "./selector-periodo";
import { PestanaResumen } from "./resumen";
import { PestanaVentas } from "./ventas";
import { PestanaCobranza } from "./cobranza";
import { PestanaCumplimiento } from "./cumplimiento";
import { PestanaClientes } from "./clientes";

const PESTANAS = {
  resumen: "Resumen",
  ventas: "Ventas",
  cobranza: "Cobranza",
  cumplimiento: "Cumplimiento",
  clientes: "Clientes y equipo",
} as const;

type Pestana = keyof typeof PESTANAS;

const esFecha = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

/** `2026-09-01`/`2026-09-29` → "1 set – 29 set 2026" */
const textoRango = (desde: string, hasta: string) =>
  desde.slice(0, 4) === hasta.slice(0, 4)
    ? `${etiquetaDia(desde)} – ${etiquetaDia(hasta)} ${hasta.slice(0, 4)}`
    : `${etiquetaDia(desde)} ${desde.slice(0, 4)} – ${etiquetaDia(hasta)} ${hasta.slice(0, 4)}`;

/**
 * El dashboard de Administración. Trabaja sobre los pedidos que el layout ya cargó
 * —no pide nada a la base— y todo lo que se ve se recalcula al cambiar de período.
 *
 * El período y la pestaña viven en la URL (`?p=mes&v=cobranza`) para que una
 * recarga o un enlace compartido abran lo mismo. Se escriben con `replaceState`,
 * que Next sincroniza con `useSearchParams` sin ir al servidor: cambiar de período
 * es solo volver a calcular.
 */
export function DashboardMetricas() {
  const { pedidos } = useStore();
  const params = useSearchParams();
  const hoy = hoyEnLima();

  const clave = (params.get("p") ?? "mes") as ClavePeriodo;
  const desde = esFecha(params.get("desde"));
  const hasta = esFecha(params.get("hasta"));
  const periodo = useMemo(
    () => resolverPeriodo(Object.hasOwn(PERIODOS, clave) ? clave : "mes", hoy, { desde, hasta }),
    [clave, hoy, desde, hasta],
  );

  const pedida = params.get("v") ?? "resumen";
  const pestana: Pestana = Object.hasOwn(PESTANAS, pedida) ? (pedida as Pestana) : "resumen";

  function actualizar(cambios: Record<string, string | undefined>) {
    const siguiente = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(cambios)) {
      if (v === undefined) siguiente.delete(k);
      else siguiente.set(k, v);
    }
    const q = siguiente.toString();
    window.history.replaceState(null, "", q ? `?${q}` : window.location.pathname);
  }

  const props = { pedidos, periodo, hoy };

  return (
    <div className="px-4 py-5 md:px-6 md:py-6">
      <header className="mb-4 flex flex-wrap items-start gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">Métricas</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            {textoRango(periodo.desde, periodo.hasta)} · comparado con {periodo.nombreAnterior}
          </p>
        </div>
        <div className="flex-1" />
        <SelectorPeriodo
          periodo={periodo}
          hoy={hoy}
          onCambiar={({ p, desde, hasta }) =>
            actualizar({
              p: p === "mes" ? undefined : p,
              desde: p === "rango" ? desde : undefined,
              hasta: p === "rango" ? hasta : undefined,
            })
          }
        />
      </header>

      <Tabs
        value={pestana}
        onValueChange={(v) => actualizar({ v: v === "resumen" ? undefined : String(v) })}
        className="gap-4"
      >
        {/* En el celular las cinco pestañas no caben: la fila se desplaza. */}
        <div className="-mx-4 overflow-x-auto px-4 md:-mx-6 md:px-6">
          <TabsList>
            {(Object.keys(PESTANAS) as Pestana[]).map((p) => (
              <TabsTrigger key={p} value={p} className="px-2.5">
                {PESTANAS[p]}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="resumen">
          <PestanaResumen {...props} />
        </TabsContent>
        <TabsContent value="ventas">
          <PestanaVentas {...props} />
        </TabsContent>
        <TabsContent value="cobranza">
          <PestanaCobranza {...props} />
        </TabsContent>
        <TabsContent value="cumplimiento">
          <PestanaCumplimiento {...props} />
        </TabsContent>
        <TabsContent value="clientes">
          <PestanaClientes {...props} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
