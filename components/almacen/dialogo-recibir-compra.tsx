"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { RotateCw } from "lucide-react";
import * as acciones from "@/app/(app)/almacen/acciones";
import { TIPOS_COMPRA, codigoVisible, type CompraDetalle } from "@/lib/compras";
import { diaMesTexto } from "@/lib/formato";
import { Button } from "@/components/ui/button";
import { Campo } from "@/components/ui/campo";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const entero = (t: string) => {
  const v = Number(t.trim());
  return t.trim() === "" ? 0 : Number.isInteger(v) && v >= 0 && v <= 99_999 ? v : null;
};

const titulo = (c: CompraDetalle) => `${codigoVisible(c)} · ${c.proveedor}`;

/**
 * Recibir lo que llegó de una compra confirmada en `/compras`. Por defecto
 * propone todo lo que falta; si llegó una parte, se corrige y el resto queda
 * pendiente para la próxima recepción. En Odoo se valida la recepción de la orden.
 */
export function DialogoRecibirCompra({ compras, alCerrar }: { compras: CompraDetalle[]; alCerrar: () => void }) {
  const [compraId, setCompraId] = useState<string | null>(compras.length === 1 ? compras[0].id : null);
  const compra = compras.find((c) => c.id === compraId) ?? null;
  const [cantidades, setCantidades] = useState<Record<number, string>>({});
  const [nota, setNota] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  const falta = (c: CompraDetalle, posicion: number) => {
    const l = c.lineas.find((x) => x.posicion === posicion)!;
    return l.cantidad - l.recibida;
  };
  const valor = (posicion: number) => cantidades[posicion] ?? (compra ? String(falta(compra, posicion)) : "");
  const atascadas = compra?.recepciones.filter((r) => r.sincronizacion !== "sincronizada") ?? [];

  const elegir = (id: string) => {
    setCompraId(id);
    setCantidades({});
    setError(null);
  };

  const recibir = () => {
    if (!compra) return setError("Elige la compra que llegó.");
    const lineas: { posicion: number; cantidad: number }[] = [];
    for (const l of compra.lineas) {
      if (l.recibida >= l.cantidad) continue;
      const n = entero(valor(l.posicion));
      if (n === null) return setError(`Escribe cuántas llegaron de ${l.codigo ?? l.nombre} (un número entero).`);
      if (n > l.cantidad - l.recibida) return setError(`De ${l.codigo ?? l.nombre} faltan ${l.cantidad - l.recibida}.`);
      lineas.push({ posicion: l.posicion, cantidad: n });
    }
    if (!lineas.some((l) => l.cantidad > 0)) return setError("Escribe cuántas llegaron de al menos un ítem.");
    iniciar(async () => {
      const r = await acciones.recibirCompra({ compraId: compra.id, nota, lineas });
      if (!r.ok) return setError(r.error);
      if (r.aviso) toast.warning(`${codigoVisible(compra)}: recepción anotada`, { description: r.aviso, duration: 12_000 });
      else toast.success(`${codigoVisible(compra)}: recepción registrada`, { description: "El stock ya entró en Odoo." });
      alCerrar();
    });
  };

  const reintentar = (id: string) =>
    iniciar(async () => {
      const r = await acciones.reintentarRecepcion(id);
      if (!r.ok) return setError(r.error);
      toast.success("La recepción ya está en Odoo.");
      alCerrar();
    });

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && alCerrar()}>
      <DialogContent className="flex max-h-[92dvh] flex-col gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>Recibir compra</DialogTitle>
          <DialogDescription>
            Lo que llegó de una orden de compra. Si llegó una parte, el resto queda pendiente.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 overflow-y-auto px-5 py-4">
          {compras.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No hay compras esperando mercadería. Se confirman en{" "}
              <Link href="/compras" className="text-primary underline-offset-4 hover:underline">
                Compras
              </Link>
              .
            </p>
          ) : (
            <Campo grupo label="Compra" requerido>
              <Select value={compraId} onValueChange={(v) => v && elegir(v)}>
                <SelectTrigger aria-label="Compra" className="w-full">
                  <SelectValue>{compra ? titulo(compra) : "Elige la compra que llegó"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {compras.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {titulo(c)}
                      <span className="text-muted-foreground ml-2 text-xs">
                        {TIPOS_COMPRA[c.tipo]} · {c.almacen}
                        {c.fechaLlegadaEstimada && ` · llega ${diaMesTexto(c.fechaLlegadaEstimada)}`}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>
          )}

          {compra && atascadas.length > 0 && (
            <div className="border-st-anulado/30 bg-st-anulado-soft/40 flex flex-col gap-2 rounded-xl border p-3 text-sm">
              <p className="font-medium">Una recepción anterior no llegó a Odoo</p>
              {atascadas.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-2">
                  <p className="text-muted-foreground min-w-0 flex-1 text-xs">{r.error ?? "Pendiente"}</p>
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => reintentar(r.id)} disabled={pendiente}>
                    <RotateCw className="size-3.5" />
                    Reintentar
                  </Button>
                </div>
              ))}
            </div>
          )}

          {compra && (
            <>
              <p className="text-muted-foreground text-xs">
                Llega a <span className="text-foreground font-medium">{compra.almacen}</span>
                {compra.documentoProveedor && <> · {compra.documentoProveedor}</>}
              </p>
              <ul className="divide-y rounded-xl border" aria-label="Ítems de la compra">
                {compra.lineas.map((l) => {
                  const resta = l.cantidad - l.recibida;
                  return (
                    <li key={l.posicion} className="flex flex-wrap items-end gap-2 px-3 py-2.5">
                      <div className="min-w-0 flex-1 basis-56">
                        <p className="text-sm">
                          <span className="text-muted-foreground mr-2 font-mono text-xs">{l.codigo}</span>
                          {l.nombre}
                        </p>
                        <p className="text-muted-foreground tnum mt-0.5 text-xs">
                          Pedido {l.cantidad} · recibido {l.recibida}
                          {resta > 0 ? ` · faltan ${resta}` : " · completo"}
                        </p>
                      </div>
                      {resta > 0 && (
                        <Campo label="Llegaron" className="w-24">
                          <Input
                            inputMode="numeric"
                            value={valor(l.posicion)}
                            onChange={(e) => {
                              setCantidades((c) => ({ ...c, [l.posicion]: e.target.value }));
                              setError(null);
                            }}
                            className="tnum"
                          />
                        </Campo>
                      )}
                    </li>
                  );
                })}
              </ul>
              <Campo label="Nota">
                <Textarea value={nota} onChange={(e) => setNota(e.target.value)} maxLength={500} rows={2} placeholder="Guía de remisión, estado de las planchas…" />
              </Campo>
            </>
          )}
          {error && (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          )}
        </div>

        <DialogFooter className="m-0 flex-row items-center border-t px-5 py-3">
          <span className="flex-1" />
          <DialogClose render={<Button variant="outline" type="button" />}>Cancelar</DialogClose>
          <Button onClick={recibir} disabled={pendiente || !compra || atascadas.length > 0}>
            {pendiente ? "Recibiendo…" : "Recibir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
