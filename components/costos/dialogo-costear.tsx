"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { coincide } from "@/lib/busqueda";
import { TIPOS_COMPRA, type CompraResumen } from "@/lib/compras";
import { momentoEnLima } from "@/lib/fecha";
import { diaMesTexto, montoEn } from "@/lib/formato";
import { Input } from "@/components/ui/input";
import { Opciones } from "@/components/ui/campo";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EstadoCompraBadge } from "@/components/compras/estado-compra";

type Filtro = "por_costear" | "costeadas" | "todas";

/**
 * Elegir la compra a costear: las que ya llegaron (o llegan por partes) y las ya
 * costeadas, para revisarlas. Al elegir una se abre su costeo.
 */
export function DialogoCostear({ compras, alCerrar }: { compras: CompraResumen[]; alCerrar: () => void }) {
  const [consulta, setConsulta] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("por_costear");
  const visibles = useMemo(
    () =>
      compras.filter(
        (c) =>
          (filtro === "todas" || (filtro === "costeadas") === (c.estado === "liquidada")) &&
          coincide(`${c.codigo} ${c.proveedor} ${c.documentoProveedor ?? ""} ${c.almacen}`, consulta),
      ),
    [compras, filtro, consulta],
  );

  return (
    <Dialog open onOpenChange={(a) => !a && alCerrar()}>
      <DialogContent className="flex max-h-[88dvh] flex-col gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>Costear una compra</DialogTitle>
          <DialogDescription>Elige la orden: se cargan sus gastos y sale el costo por plancha.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 border-b px-5 py-3">
          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input
              autoFocus
              value={consulta}
              onChange={(e) => setConsulta(e.target.value)}
              placeholder="Código, proveedor o proforma…"
              aria-label="Buscar compra"
              className="pl-8"
            />
          </div>
          <div role="group" aria-label="Mostrar">
            <Opciones
              valores={[filtro]}
              onToggle={(v) => setFiltro(v as Filtro)}
              opciones={[
                { valor: "por_costear", label: "Por costear" },
                { valor: "costeadas", label: "Costeadas" },
                { valor: "todas", label: "Todas" },
              ]}
            />
          </div>
        </div>
        <ul className="divide-y overflow-y-auto" aria-label="Compras">
          {visibles.length === 0 ? (
            <li className="text-muted-foreground px-5 py-10 text-center text-sm">
              {compras.length === 0 ? "No hay compras recibidas todavía." : "Ninguna compra coincide."}
            </li>
          ) : (
            visibles.map((c) => (
              <li key={c.id}>
                <Link href={`/costos-precios/costear/${c.codigo}`} className="hover:bg-muted/40 flex flex-col gap-0.5 px-5 py-3">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-primary text-sm font-medium">{c.codigo}</span>
                    <EstadoCompraBadge estado={c.estado} />
                    <span className="text-muted-foreground text-xs">{TIPOS_COMPRA[c.tipo]}</span>
                    <span className="tnum ml-auto text-sm font-medium">{montoEn(c.totalMercaderia, c.monedaMercaderia)}</span>
                  </span>
                  <span className="truncate text-sm">{c.proveedor}</span>
                  <span className="text-muted-foreground text-xs">
                    {c.items} {c.items === 1 ? "ítem" : "ítems"} · {c.almacen}
                    {c.documentoProveedor && ` · ${c.documentoProveedor}`} · {diaMesTexto(momentoEnLima(c.creadoEn), true)}
                  </span>
                </Link>
              </li>
            ))
          )}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
