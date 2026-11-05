"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { FileText, MessageSquareText, Plus, Search } from "lucide-react";
import { coincide } from "@/lib/busqueda";
import {
  CANALES,
  referenciaDe,
  sumaLineas,
  textoBuscable,
  type Canal,
  type Cotizacion,
} from "@/lib/cotizaciones";
import { momentoEnLima } from "@/lib/fecha";
import { diaMesTexto, money } from "@/lib/formato";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Opciones } from "@/components/ui/campo";
import { CanalBadge, EstadoSincronizacion } from "./estado-cotizacion";
import { AvisoOdoo } from "./aviso-odoo";

type Filtro = Canal | "todas";

export function ListaCotizaciones({
  cotizaciones,
  puedeAsistente,
  odooListo,
}: {
  cotizaciones: Cotizacion[];
  puedeAsistente: boolean;
  odooListo: boolean;
}) {
  const [consulta, setConsulta] = useState("");
  const [canal, setCanal] = useState<Filtro>("todas");

  const visibles = useMemo(
    () =>
      cotizaciones.filter(
        (c) => (canal === "todas" || c.canal === canal) && coincide(textoBuscable(c), consulta),
      ),
    [cotizaciones, canal, consulta],
  );

  return (
    <div className="px-4 py-5 md:px-6 md:py-6">
      <header className="mb-5 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight">Cotizaciones</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            Cada una tiene su cotización en Odoo.
          </p>
        </div>
        {puedeAsistente && (
          <Button
            render={<Link href="/cotizaciones/asistente" />}
            nativeButton={false}
            variant="outline"
            className="gap-1.5"
          >
            <MessageSquareText />
            Asistente
          </Button>
        )}
        <Button
          render={<Link href="/cotizaciones/nueva" />}
          nativeButton={false}
          className="gap-1.5"
        >
          <Plus />
          Nueva cotización
        </Button>
      </header>

      {!odooListo && <AvisoOdoo className="mb-4" />}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            value={consulta}
            onChange={(e) => setConsulta(e.target.value)}
            placeholder="Cliente, RUC, referencia o producto…"
            aria-label="Filtrar cotizaciones"
            className="pl-8"
          />
        </div>
        <div role="group" aria-label="Canal">
          <Opciones
            valores={[canal]}
            onToggle={(v) => setCanal(v as Filtro)}
            opciones={[
              { valor: "todas", label: "Todas" },
              ...Object.entries(CANALES).map(([valor, label]) => ({ valor, label })),
            ]}
          />
        </div>
      </div>

      {visibles.length === 0 ? (
        <div className="text-muted-foreground grid place-items-center rounded-xl border border-dashed px-6 py-12 text-center text-sm">
          <FileText className="mb-2 size-5 opacity-50" />
          {cotizaciones.length === 0
            ? "Todavía no hay cotizaciones. Crea la primera."
            : "Ninguna cotización coincide con el filtro."}
        </div>
      ) : (
        <>
          {/* Escritorio: tabla. */}
          <div className="hidden overflow-hidden rounded-xl border md:block">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-muted-foreground text-left text-xs">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Cotización</th>
                  <th className="px-4 py-2.5 font-medium">Cliente</th>
                  <th className="px-4 py-2.5 font-medium">Canal</th>
                  <th className="px-4 py-2.5 text-right font-medium">Productos</th>
                  <th className="px-4 py-2.5 text-right font-medium">Total</th>
                  <th className="px-4 py-2.5 text-right font-medium">Fecha</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((c) => (
                  <tr key={c.id} className="hover:bg-muted/40 relative border-t">
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/cotizaciones/${c.id}`}
                        className="text-primary font-medium after:absolute after:inset-0"
                      >
                        {referenciaDe(c)}
                      </Link>
                      {c.sincronizacion !== "sincronizada" && (
                        <EstadoSincronizacion estado={c.sincronizacion} className="ml-2" />
                      )}
                    </td>
                    <td className="max-w-72 px-4 py-2.5">
                      <p className="truncate">{c.cliente.nombre}</p>
                      {c.cliente.documento && (
                        <p className="text-muted-foreground tnum text-xs">{c.cliente.documento}</p>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <CanalBadge canal={c.canal} />
                    </td>
                    <td className="tnum px-4 py-2.5 text-right">{c.lineas.length}</td>
                    <td className="tnum px-4 py-2.5 text-right font-medium">
                      {money(c.montoTotal ?? sumaLineas(c.lineas))}
                    </td>
                    <td className="text-muted-foreground px-4 py-2.5 text-right text-xs">
                      {diaMesTexto(momentoEnLima(c.creadoEn))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Celular: tarjetas. */}
          <ul className="flex flex-col gap-2 md:hidden">
            {visibles.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/cotizaciones/${c.id}`}
                  className="bg-card hover:bg-muted/40 flex flex-col gap-1 rounded-xl border p-3"
                >
                  <span className="flex items-center gap-2">
                    <span className="text-primary text-sm font-medium">{referenciaDe(c)}</span>
                    <CanalBadge canal={c.canal} />
                    {c.sincronizacion !== "sincronizada" && (
                      <EstadoSincronizacion estado={c.sincronizacion} />
                    )}
                    <span className="text-muted-foreground ml-auto text-xs">
                      {diaMesTexto(momentoEnLima(c.creadoEn))}
                    </span>
                  </span>
                  <span className="truncate text-sm">{c.cliente.nombre}</span>
                  <span className="text-muted-foreground flex items-center text-xs">
                    {c.lineas.length} {c.lineas.length === 1 ? "producto" : "productos"}
                    <span className="tnum text-foreground ml-auto text-sm font-medium">
                      {money(c.montoTotal ?? sumaLineas(c.lineas))}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
