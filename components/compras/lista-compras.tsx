"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Plus, Search, ShoppingCart } from "lucide-react";
import { coincide } from "@/lib/busqueda";
import { TIPOS_COMPRA, type CompraResumen, type EstadoCompra } from "@/lib/compras";
import { momentoEnLima } from "@/lib/fecha";
import { diaMesTexto, montoEn } from "@/lib/formato";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Opciones } from "@/components/ui/campo";
import { EstadoSincronizacion } from "@/components/cotizaciones/estado-cotizacion";
import { EstadoCompraBadge } from "./estado-compra";

type Filtro = "abiertas" | "borrador" | "por_recibir" | "por_liquidar" | "liquidada" | "todas";

const FILTROS: Record<Filtro, { label: string; estados: EstadoCompra[] | null }> = {
  abiertas: { label: "En curso", estados: ["borrador", "confirmada", "recibida_parcial", "recibida"] },
  borrador: { label: "Pre-compras", estados: ["borrador"] },
  por_recibir: { label: "Por recibir", estados: ["confirmada", "recibida_parcial"] },
  por_liquidar: { label: "Por liquidar", estados: ["recibida"] },
  liquidada: { label: "Liquidadas", estados: ["liquidada"] },
  todas: { label: "Todas", estados: null },
};

/**
 * Las compras: pre-compras, órdenes confirmadas que esperan mercadería, las que
 * ya llegaron y falta liquidar, y las liquidadas. Arriba, para crear una nueva.
 */
export function ListaCompras({ compras, odooListo }: { compras: CompraResumen[]; odooListo: boolean }) {
  const [consulta, setConsulta] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("abiertas");

  const visibles = useMemo(() => {
    const estados = FILTROS[filtro].estados;
    return compras.filter(
      (c) =>
        (!estados || estados.includes(c.estado)) &&
        coincide(`${c.codigo} ${c.proveedor} ${c.documentoProveedor ?? ""} ${c.almacen}`, consulta),
    );
  }, [compras, filtro, consulta]);

  const enlace = (c: CompraResumen) => `/compras/${c.codigo}`;

  return (
    <div className="px-4 py-5 md:px-6 md:py-6">
      <header className="mb-5 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight">Compras</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            De la pre-compra a la orden de compra en Odoo, la recepción y la liquidación del costo.
          </p>
        </div>
        <Button render={<Link href="/compras/nueva" />} nativeButton={false} className="gap-1.5">
          <Plus />
          Nueva compra
        </Button>
      </header>

      {!odooListo && (
        <p className="border-st-en_proceso/30 bg-st-en_proceso-soft/40 mb-4 rounded-xl border px-4 py-3 text-sm">
          Odoo no está configurado: las pre-compras se guardan, pero no se pueden confirmar.
        </p>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            value={consulta}
            onChange={(e) => setConsulta(e.target.value)}
            placeholder="Código, proveedor o proforma…"
            aria-label="Filtrar compras"
            className="pl-8"
          />
        </div>
        <div role="group" aria-label="Estado">
          <Opciones
            valores={[filtro]}
            onToggle={(v) => setFiltro(v as Filtro)}
            opciones={Object.entries(FILTROS).map(([valor, f]) => ({ valor, label: f.label }))}
          />
        </div>
      </div>

      {visibles.length === 0 ? (
        <div className="text-muted-foreground grid place-items-center rounded-xl border border-dashed px-6 py-12 text-center text-sm">
          <ShoppingCart className="mb-2 size-5 opacity-50" />
          {compras.length === 0 ? "Todavía no hay compras. Registra la primera pre-compra." : "Ninguna compra coincide con el filtro."}
        </div>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-xl border md:block">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-muted-foreground text-left text-xs">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Compra</th>
                  <th className="px-4 py-2.5 font-medium">Proveedor</th>
                  <th className="px-4 py-2.5 font-medium">Tipo</th>
                  <th className="px-4 py-2.5 font-medium">Almacén</th>
                  <th className="px-4 py-2.5 text-right font-medium">Mercadería</th>
                  <th className="px-4 py-2.5 text-right font-medium">Llegada</th>
                  <th className="px-4 py-2.5 text-right font-medium">Creada</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((c) => (
                  <tr key={c.id} className="hover:bg-muted/40 relative border-t">
                    <td className="px-4 py-2.5">
                      <Link href={enlace(c)} className="text-primary font-medium after:absolute after:inset-0">
                        {c.codigo}
                      </Link>
                      <EstadoCompraBadge estado={c.estado} className="ml-2" />
                      {c.sincronizacion && c.sincronizacion !== "sincronizada" && (
                        <EstadoSincronizacion estado={c.sincronizacion} className="ml-2" />
                      )}
                    </td>
                    <td className="max-w-72 px-4 py-2.5">
                      <p className="truncate">{c.proveedor}</p>
                      {c.documentoProveedor && <p className="text-muted-foreground text-xs">{c.documentoProveedor}</p>}
                    </td>
                    <td className="px-4 py-2.5">{TIPOS_COMPRA[c.tipo]}</td>
                    <td className="px-4 py-2.5">{c.almacen}</td>
                    <td className="tnum px-4 py-2.5 text-right font-medium">{montoEn(c.totalMercaderia, c.monedaMercaderia)}</td>
                    <td className="text-muted-foreground px-4 py-2.5 text-right text-xs">
                      {c.fechaLlegadaEstimada ? diaMesTexto(c.fechaLlegadaEstimada) : "—"}
                    </td>
                    <td className="text-muted-foreground px-4 py-2.5 text-right text-xs">{diaMesTexto(momentoEnLima(c.creadoEn))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="flex flex-col gap-2 md:hidden">
            {visibles.map((c) => (
              <li key={c.id}>
                <Link href={enlace(c)} className="bg-card hover:bg-muted/40 flex flex-col gap-1 rounded-xl border p-3">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-primary text-sm font-medium">{c.codigo}</span>
                    <EstadoCompraBadge estado={c.estado} />
                    <span className="text-muted-foreground ml-auto text-xs">{TIPOS_COMPRA[c.tipo]}</span>
                  </span>
                  <span className="truncate text-sm">{c.proveedor}</span>
                  <span className="text-muted-foreground flex items-center text-xs">
                    {c.almacen}
                    {c.fechaLlegadaEstimada && ` · llega ${diaMesTexto(c.fechaLlegadaEstimada)}`}
                    <span className="tnum text-foreground ml-auto text-sm font-medium">
                      {montoEn(c.totalMercaderia, c.monedaMercaderia)}
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
