"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { CircleAlert, RotateCw } from "lucide-react";
import * as acciones from "@/app/(app)/almacen/acciones";
import { diaEnLima } from "@/lib/fecha";
import { fechaCompleta, money } from "@/lib/formato";
import { TIPOS_INGRESO, type IngresoResumen } from "@/lib/inventario";
import { Button } from "@/components/ui/button";
import { cantidad } from "./comun";

/** Los últimos ingresos de stock: compras y ajustes, y si llegaron a Odoo. */
export function ListaIngresos({ ingresos }: { ingresos: IngresoResumen[] }) {
  const [pendiente, iniciar] = useTransition();

  const reintentar = (i: IngresoResumen) =>
    iniciar(async () => {
      const r = await acciones.reintentarIngreso(i.id);
      if (r.ok) toast.success(`${i.codigo} ya está en Odoo`);
      else toast.error("Odoo no lo registró", { description: r.error });
    });

  if (ingresos.length === 0) {
    return (
      <p className="text-muted-foreground rounded-xl border border-dashed px-4 py-8 text-center text-sm">
        Todavía no hay ingresos. Las compras y los ajustes que registres aparecen aquí.
      </p>
    );
  }

  return (
    <ul className="bg-card divide-y rounded-xl border" aria-label="Ingresos de stock">
      {ingresos.map((i) => {
        const total = i.lineas.reduce((t, l) => t + l.cantidad * (l.costo ?? 0), 0);
        return (
          <li key={i.id} className="flex flex-col gap-2 px-4 py-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-primary font-mono text-sm font-semibold">{i.codigo}</span>
              <span className="text-sm font-medium">{TIPOS_INGRESO[i.tipo]}</span>
              <span className="text-muted-foreground text-xs">
                {i.almacen}
                {i.proveedor && ` · ${i.proveedor}`}
                {i.documento && ` · ${i.documento}`}
                {` · ${fechaCompleta(diaEnLima(i.creadoEn))}`}
                {i.creadoPor && ` · ${i.creadoPor}`}
              </span>
              {i.tipo === "compra" && total > 0 && <span className="tnum ml-auto text-sm font-medium">{money(total)}</span>}
            </div>
            <ul className="text-muted-foreground flex flex-col gap-0.5 text-xs">
              {i.lineas.map((l, n) => (
                <li key={n} className="flex flex-wrap gap-x-2">
                  <span className="font-mono">{l.codigo}</span>
                  <span className="text-foreground">{l.nombre}</span>
                  <span className="tnum">
                    {i.tipo === "ajuste"
                      ? `${l.anterior === null ? "?" : cantidad(l.anterior)} → ${l.cantidad}`
                      : `+${l.cantidad}${l.costo !== null ? ` × ${money(l.costo)}` : ""}`}
                  </span>
                </li>
              ))}
            </ul>
            {i.nota && <p className="text-xs">{i.nota}</p>}
            {i.sincronizacion !== "sincronizada" && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-st-observado flex items-center gap-1 text-xs">
                  <CircleAlert className="size-3.5" />
                  {i.error ?? "Todavía no está en Odoo"}
                </span>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => reintentar(i)} disabled={pendiente}>
                  <RotateCw className="size-3.5" />
                  Reintentar
                </Button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
