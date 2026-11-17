"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import * as acciones from "@/app/(app)/almacen/acciones";
import type { Almacen } from "@/lib/almacenes";
import type { FilaKardex } from "@/lib/kardex";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cantidad as fmt, type PedidoKardex } from "./comun";

const TODOS = "__todos";
const PERIODOS = [
  { dias: 30, label: "Últimos 30 días" },
  { dias: 90, label: "Últimos 90 días" },
  { dias: 365, label: "Último año" },
];

const fecha = (iso: string) => {
  // Odoo guarda en UTC sin zona: "2026-11-17 15:04:00".
  const d = new Date(`${iso.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("es-PE", { timeZone: "America/Lima", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};

/**
 * El kárdex de un producto (o la historia de un sobrante): cada entrada y
 * salida en cada almacén, de lo más nuevo a lo más viejo, con lo que quedó.
 * Sale de Odoo, así que trae también lo que alguien hizo allá directamente.
 */
export function PanelKardex({
  pedido,
  almacenes,
  alCerrar,
}: {
  pedido: PedidoKardex;
  almacenes: Almacen[];
  alCerrar: () => void;
}) {
  const [almacenId, setAlmacenId] = useState<string>(TODOS);
  const [dias, setDias] = useState(90);
  const [estado, setEstado] = useState<
    { clave: string; filas: FilaKardex[]; hoy: Record<string, number> } | { clave: string; error: string } | null
  >(null);
  const clave = `${pedido.productoId}|${pedido.sobrante}|${almacenId}|${dias}`;

  useEffect(() => {
    let vigente = true;
    acciones
      .leerKardex({
        productoId: pedido.productoId,
        sobrante: pedido.sobrante,
        almacenId: almacenId === TODOS ? null : almacenId,
        dias,
      })
      .then((r) => {
        if (!vigente) return;
        setEstado(r.ok ? { clave, filas: r.filas, hoy: r.hoy } : { clave, error: r.error });
      });
    return () => {
      vigente = false;
    };
  }, [clave, pedido.productoId, pedido.sobrante, almacenId, dias]);

  const nombre = (id: string) => almacenes.find((a) => a.id === id)?.nombre ?? "?";
  const activos = almacenes.filter((a) => a.activo);
  const listo = estado?.clave === clave ? estado : null;

  return (
    <Sheet open onOpenChange={(abierto) => !abierto && alCerrar()}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-2xl">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle>Kárdex de {pedido.codigo}</SheetTitle>
          <SheetDescription>{pedido.titulo}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-wrap gap-2 border-b px-5 py-3">
          <Select value={almacenId} onValueChange={(v) => v && setAlmacenId(v)}>
            <SelectTrigger aria-label="Almacén del kárdex" className="w-48">
              <SelectValue>{almacenId === TODOS ? "Todos los almacenes" : nombre(almacenId)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos los almacenes</SelectItem>
              {activos.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(dias)} onValueChange={(v) => v && setDias(Number(v))}>
            <SelectTrigger aria-label="Periodo del kárdex" className="w-44">
              <SelectValue>{PERIODOS.find((p) => p.dias === dias)?.label}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {PERIODOS.map((p) => (
                <SelectItem key={p.dias} value={String(p.dias)}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {listo && "hoy" in listo && (
            <p className="text-muted-foreground ml-auto self-center text-xs">
              Hoy:{" "}
              {Object.entries(listo.hoy)
                .map(([id, n]) => `${nombre(id)} ${fmt(n)}`)
                .join(" · ")}
            </p>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {!listo ? (
            <p className="text-muted-foreground px-5 py-8 text-center text-sm">Leyendo los movimientos de Odoo…</p>
          ) : "error" in listo ? (
            <p className="text-destructive px-5 py-8 text-center text-sm" role="alert">
              {listo.error}
            </p>
          ) : listo.filas.length === 0 ? (
            <p className="text-muted-foreground px-5 py-8 text-center text-sm">No hubo movimientos en este periodo.</p>
          ) : (
            <table className="w-full text-sm" aria-label={`Kárdex de ${pedido.codigo}`}>
              <thead className="bg-muted/40 text-muted-foreground sticky top-0 text-xs">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Fecha</th>
                  <th className="px-2 py-2 text-left font-medium">Almacén</th>
                  <th className="px-2 py-2 text-left font-medium">Movimiento</th>
                  <th className="px-2 py-2 text-right font-medium">Entra</th>
                  <th className="px-2 py-2 text-right font-medium">Sale</th>
                  <th className="px-4 py-2 text-right font-medium">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {listo.filas.map((f) => (
                  <tr key={f.clave} className="border-t">
                    <td className="text-muted-foreground px-4 py-2 text-xs whitespace-nowrap">{fecha(f.fecha)}</td>
                    <td className="px-2 py-2 text-xs">{nombre(f.almacenId)}</td>
                    <td className="px-2 py-2">
                      {f.enlace ? (
                        <Link href={f.enlace} className="text-primary hover:underline">
                          {f.detalle}
                        </Link>
                      ) : (
                        f.detalle
                      )}
                    </td>
                    <td className="tnum text-st-entregado px-2 py-2 text-right">{f.entra ? `+${fmt(f.entra)}` : ""}</td>
                    <td className="tnum text-st-observado px-2 py-2 text-right">{f.sale ? `−${fmt(f.sale)}` : ""}</td>
                    <td className="tnum px-4 py-2 text-right font-medium">{fmt(f.saldo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
