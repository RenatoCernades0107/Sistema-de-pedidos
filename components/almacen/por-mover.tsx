"use client";

import Link from "next/link";
import { useTransition } from "react";
import { toast } from "sonner";
import { ArrowRight, RefreshCw, ShoppingCart, Truck, X } from "lucide-react";
import * as acciones from "@/app/(app)/almacen/acciones";
import type { Almacen } from "@/lib/almacenes";
import { MOTIVOS_FALTANTE, type FaltanteGuardado } from "@/lib/faltantes";
import { Button } from "@/components/ui/button";
import { cantidad as fmt } from "./comun";
import type { Ingresable } from "./dialogo-ingreso";
import type { TransferenciaInicial } from "./dialogo-transferencia";

/**
 * Lo que hay que mover: los avisos de los pedidos a los que les falta material
 * donde se producen o se despachan, agrupados por pedido y por ruta (de dónde a
 * dónde). Cada ruta se resuelve con una transferencia ya armada.
 */
export function PorMover({
  faltantes,
  almacenes,
  productos,
  alTransferir,
}: {
  faltantes: FaltanteGuardado[];
  almacenes: Almacen[];
  productos: Ingresable[];
  alTransferir: (inicial: TransferenciaInicial) => void;
}) {
  const [pendiente, iniciar] = useTransition();
  const nombre = (id: string | null) => almacenes.find((a) => a.id === id)?.nombre ?? "?";
  const stockEn = (productoId: number, almacenId: string | null) =>
    almacenId ? (productos.find((p) => p.productoId === productoId)?.porAlmacen[almacenId] ?? 0) : 0;

  const revisar = () =>
    iniciar(async () => {
      const r = await acciones.revisarFaltantes();
      if (r.ok) toast.success("Revisado con el stock de Odoo");
      else toast.error("No se pudo revisar", { description: r.error });
    });

  const descartar = (f: FaltanteGuardado) =>
    iniciar(async () => {
      const r = await acciones.descartarFaltante(f.id);
      if (!r.ok) toast.error("No se descartó", { description: r.error });
    });

  if (faltantes.length === 0) {
    return (
      <div className="text-muted-foreground flex flex-col items-center gap-3 rounded-xl border border-dashed px-4 py-8 text-center text-sm">
        <p>No hay nada que mover. Cuando a un pedido le falte material donde se produce o se despacha, aparece aquí.</p>
      </div>
    );
  }

  // Por pedido, y dentro de cada uno por ruta: lo que se resuelve con una misma transferencia.
  const pedidos = new Map<string, FaltanteGuardado[]>();
  for (const f of faltantes) pedidos.set(f.pedidoId, [...(pedidos.get(f.pedidoId) ?? []), f]);

  const transferir = (pedidoId: string, codigo: string, ruta: FaltanteGuardado[]) => {
    const desde = ruta[0].origenSugeridoId;
    alTransferir({
      desdeId: desde,
      haciaId: ruta[0].almacenId,
      lineas: ruta.map((f) => ({
        productoId: f.productoId,
        cantidad: Math.max(1, Math.min(Math.ceil(f.cantidad), Math.floor(stockEn(f.productoId, desde)) || Math.ceil(f.cantidad))),
      })),
      faltanteIds: ruta.map((f) => f.id),
      pedidoId,
      motivo: `Para el pedido ${codigo}`,
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-muted-foreground min-w-0 flex-1 text-sm">
          Lo que les falta a los pedidos en el almacén donde se producen o se despachan, y de dónde traerlo.
        </p>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={revisar} disabled={pendiente}>
          <RefreshCw className="size-3.5" />
          Revisar de nuevo
        </Button>
      </div>
      <ul className="flex flex-col gap-3" aria-label="Por mover">
        {[...pedidos].map(([pedidoId, lista]) => {
          const codigo = lista[0].pedidoCodigo;
          const rutas = new Map<string, FaltanteGuardado[]>();
          for (const f of lista.filter((x) => x.estado === "pendiente")) {
            const clave = `${f.origenSugeridoId ?? "comprar"}|${f.almacenId}`;
            rutas.set(clave, [...(rutas.get(clave) ?? []), f]);
          }
          return (
            <li key={pedidoId} className="bg-card rounded-xl border" aria-label={`Pedido ${codigo}`}>
              <div className="flex items-center gap-2 border-b px-4 py-2.5">
                <Link href={`/pedidos/${codigo}`} className="text-primary font-mono text-sm font-semibold hover:underline">
                  {codigo}
                </Link>
                <span className="text-muted-foreground text-xs">
                  {lista.length} {lista.length === 1 ? "producto" : "productos"}
                </span>
              </div>
              <ul className="divide-y">
                {lista.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
                    <span className="text-muted-foreground font-mono text-xs">{f.codigo}</span>
                    <span className="min-w-0 flex-1 basis-48">{f.nombre}</span>
                    <span className="text-xs">
                      Faltan <span className="tnum font-semibold">{fmt(f.cantidad)}</span> en {nombre(f.almacenId)}{" "}
                      <span className="text-muted-foreground">{MOTIVOS_FALTANTE[f.motivo]}</span>
                    </span>
                    {f.estado === "en_camino" ? (
                      <span className="bg-st-en_transito-soft text-st-en_transito flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium">
                        <Truck className="size-3" />
                        En camino {f.transferenciaCodigo && `· ${f.transferenciaCodigo}`}
                      </span>
                    ) : f.origenSugeridoId ? (
                      <span className="text-muted-foreground text-xs">
                        Hay {fmt(stockEn(f.productoId, f.origenSugeridoId))} en {nombre(f.origenSugeridoId)}
                      </span>
                    ) : (
                      <span className="text-st-observado flex items-center gap-1 text-xs">
                        <ShoppingCart className="size-3" />
                        No hay en ningún almacén: hay que comprar
                      </span>
                    )}
                    {f.estado === "pendiente" && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Descartar el aviso de ${f.codigo ?? f.nombre}`}
                        title="Ya no hace falta"
                        onClick={() => descartar(f)}
                        disabled={pendiente}
                        className="text-muted-foreground"
                      >
                        <X className="size-3.5" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
              {rutas.size > 0 && (
                <div className="flex flex-wrap gap-2 border-t px-4 py-2.5">
                  {[...rutas.values()].map((ruta) => (
                    <Button
                      key={`${ruta[0].origenSugeridoId}|${ruta[0].almacenId}`}
                      size="sm"
                      variant={ruta[0].origenSugeridoId ? "default" : "outline"}
                      className="gap-1.5"
                      onClick={() => transferir(pedidoId, codigo, ruta)}
                    >
                      Transferir
                      {ruta[0].origenSugeridoId && (
                        <>
                          {" "}de {nombre(ruta[0].origenSugeridoId)}
                          <ArrowRight className="size-3.5" />
                          {nombre(ruta[0].almacenId)}
                        </>
                      )}
                      {!ruta[0].origenSugeridoId && ` a ${nombre(ruta[0].almacenId)}`}
                    </Button>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
