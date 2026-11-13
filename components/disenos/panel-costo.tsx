"use client";

import Link from "next/link";
import { useMemo } from "react";
import { FilePlus2, TriangleAlert } from "lucide-react";
import { costoDiseno } from "@/lib/cad/costo";
import { PLANTILLA_LIBRE } from "@/lib/cad/tipos";
import { Button } from "@/components/ui/button";
import { useDiseno } from "./diseno-contexto";
import { versionLibre } from "./diseno-libre";

const soles = (n: number) => `S/ ${n.toFixed(2)}`;
const num = (x: number, d = 1) =>
  x.toLocaleString("es-PE", { maximumFractionDigits: d });

/**
 * Lo que cuesta fabricar el diseño: material y corte láser. No es el precio al
 * cliente —ese lo pone quien cotiza— y no incluye plegado ni armado.
 *
 * Los montos solo los ve Administración (`costos` llega `null` a los demás),
 * como en la ficha de un producto terminado.
 */
export function PanelCosto() {
  const {
    disenoId,
    resultado,
    grupo,
    acomodo,
    problemasMaterial,
    costos,
    plantilla,
    cargando,
  } = useDiseno();

  const costo = useMemo(
    () =>
      costos && grupo && resultado
        ? costoDiseno({
            piezas: resultado.piezas,
            grupo,
            acomodo,
            precios: costos.precios,
            config: costos.config,
          })
        : null,
    [costos, grupo, resultado, acomodo],
  );

  const esLibre = plantilla === PLANTILLA_LIBRE;
  const sinAprobar = esLibre && versionLibre(resultado)?.estado !== "aprobado";
  const errores =
    resultado?.validaciones.some((v) => v.nivel === "error") ?? false;
  const bloqueo = !grupo
    ? "Elige el material en la pestaña Planchas."
    : sinAprobar
      ? "Un diseño personalizado necesita la aprobación de Administración antes de cotizarse."
      : errores
        ? "El diseño tiene errores: corrígelos antes de cotizarlo."
        : problemasMaterial.length > 0
          ? "El diseño no entra en el material elegido."
          : null;

  return (
    <div className="flex flex-col gap-4">
      {!costos ? (
        <p className="text-muted-foreground text-sm">
          El costo solo lo ve Administración.
        </p>
      ) : !grupo ? (
        <p className="text-muted-foreground text-sm">
          Elige el material en la pestaña Planchas para ver el costo.
        </p>
      ) : !costo ? (
        <p className="text-muted-foreground text-sm">
          El costo aparece cuando las piezas se acomodan en la plancha.
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div className="bg-card rounded-lg border px-3 py-2">
              <dt className="text-muted-foreground text-xs">Material</dt>
              <dd className="font-medium tabular-nums">
                {soles(costo.material)}
              </dd>
              <dd className="text-muted-foreground text-xs tabular-nums">
                {num(costo.planchas, 2)}{" "}
                {costo.planchas === 1 ? "plancha" : "planchas"}{" "}
                {costo.formato.codigo}
              </dd>
            </div>
            <div className="bg-card rounded-lg border px-3 py-2">
              <dt className="text-muted-foreground text-xs">Láser</dt>
              <dd className="font-medium tabular-nums">
                {num(costo.minutosLaser)} min
              </dd>
            </div>
            <div className="bg-card rounded-lg border px-3 py-2">
              <dt className="text-muted-foreground text-xs">
                Servicio de corte
              </dt>
              <dd className="font-medium tabular-nums">
                {soles(costo.servicio)}
              </dd>
            </div>
            <div className="bg-card rounded-lg border px-3 py-2">
              <dt className="text-muted-foreground text-xs">Total</dt>
              <dd className="font-semibold tabular-nums">
                {soles(costo.total)}
              </dd>
            </div>
          </dl>
          {costo.problema && (
            <p
              role="alert"
              className="text-destructive flex items-start gap-2 text-sm"
            >
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              {costo.problema}
            </p>
          )}
          <p className="text-muted-foreground text-xs">
            Es el costo de material y corte láser (con el perímetro real de cada
            pieza), no el precio al cliente: no incluye plegado, pegado ni
            armado.
          </p>
        </>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        {bloqueo || cargando ? (
          <Button size="sm" className="gap-1.5" disabled>
            <FilePlus2 />
            Agregar a cotización
          </Button>
        ) : (
          <Button
            size="sm"
            className="gap-1.5"
            render={
              <Link
                href={`/cotizaciones/nueva?diseno=${encodeURIComponent(disenoId)}`}
              />
            }
            nativeButton={false}
          >
            <FilePlus2 />
            Agregar a cotización
          </Button>
        )}
        {bloqueo && <p className="text-muted-foreground text-xs">{bloqueo}</p>}
      </div>
    </div>
  );
}
