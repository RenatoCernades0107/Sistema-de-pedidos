"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Ban, RotateCw } from "lucide-react";
import * as acciones from "@/app/(app)/compras/acciones";
import type { Almacen } from "@/lib/almacenes";
import {
  CONDICIONES_PAGO,
  TIPOS_COMPRA,
  descuadre,
  vencimientoCredito,
  type CompraDetalle,
} from "@/lib/compras";
import type { TipoManoObra } from "@/lib/costeo";
import { momentoEnLima } from "@/lib/fecha";
import { diaMesTexto, montoEn } from "@/lib/formato";
import type { Ingresable } from "@/lib/inventario";
import { EstadoSincronizacion } from "@/components/cotizaciones/estado-cotizacion";
import { Button } from "@/components/ui/button";
import { CabeceraFormulario } from "@/components/ui/cabecera-formulario";
import { Seccion } from "@/components/ui/seccion";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CostosCompra } from "./costos-compra";
import { EditorCompra } from "./editor-compra";
import { EstadoCompraBadge } from "./estado-compra";

/**
 * Una compra. Mientras es pre-compra se edita entera; confirmada, se ve lo
 * pedido y lo recibido, y se cargan los gastos hasta liquidar el costo.
 */
export function DetalleCompra({
  compra,
  almacenes,
  productos,
  tcSugerido,
  tarifas,
  odooListo,
}: {
  compra: CompraDetalle;
  almacenes: Almacen[];
  productos: Ingresable[];
  tcSugerido: number | null;
  tarifas: Record<TipoManoObra, number>;
  odooListo: boolean;
}) {
  const [anulando, setAnulando] = useState(false);
  const [pendiente, iniciar] = useTransition();
  const sinRecepciones = compra.recepciones.length === 0;
  const anulable = (compra.estado === "borrador" || compra.estado === "confirmada") && sinRecepciones;
  const vence = vencimientoCredito(compra);

  const anular = () =>
    iniciar(async () => {
      const r = await acciones.anularCompra(compra.id);
      setAnulando(false);
      if (!r.ok) return void toast.error(r.error);
      toast.success(`${compra.codigo} anulada`);
    });

  const reintentar = () =>
    iniciar(async () => {
      const r = await acciones.reintentarCompra(compra.id);
      if (!r.ok) return void toast.error(r.error);
      toast.success("La orden de compra ya está en Odoo.");
    });

  return (
    <div className="px-4 py-5 md:px-6 md:py-6">
      <CabeceraFormulario
        volverA="/compras"
        volverTexto="Compras"
        eyebrow={
          <>
            {TIPOS_COMPRA[compra.tipo]}
            <EstadoCompraBadge estado={compra.estado} />
            {compra.sincronizacion && compra.sincronizacion !== "sincronizada" && <EstadoSincronizacion estado={compra.sincronizacion} />}
          </>
        }
        titulo={`${compra.codigo} · ${compra.proveedor}`}
        subtitulo={`Creada ${diaMesTexto(momentoEnLima(compra.creadoEn), true)}${compra.creadoPor ? ` por ${compra.creadoPor}` : ""}`}
        className="max-w-5xl"
        lateral={
          anulable && (
            <Button variant="outline" className="gap-1.5" onClick={() => setAnulando(true)} disabled={pendiente}>
              <Ban className="size-4" />
              Anular
            </Button>
          )
        }
      />

      {compra.sincronizacion === "error" && (
        <div className="border-st-anulado/30 bg-st-anulado-soft/40 mb-4 flex max-w-5xl flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm">
          <p className="min-w-0 flex-1">
            <span className="font-medium">La orden de compra no llegó a Odoo.</span> {compra.error}
          </p>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={reintentar} disabled={pendiente}>
            <RotateCw className="size-3.5" />
            Reintentar
          </Button>
        </div>
      )}

      {compra.estado === "borrador" ? (
        <EditorCompra compra={compra} almacenes={almacenes} productos={productos} tcSugerido={tcSugerido} odooListo={odooListo} />
      ) : (
        <div className="flex max-w-5xl flex-col gap-4">
          <Seccion n={1} titulo="Pedido y recepción" nota={compra.odooOrdenId ? `Orden de compra en Odoo #${compra.odooOrdenId}` : undefined}>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
              <Par t="Llega a" v={compra.almacen} />
              <Par t="Proforma" v={compra.documentoProveedor ?? "—"} />
              <Par
                t="Mercadería"
                v={`${montoEn(compra.totalMercaderia, compra.monedaMercaderia)}${compra.tcMercaderia ? ` · TC ${compra.tcMercaderia}` : ""}`}
              />
              {compra.incoterm && <Par t="Incoterm" v={compra.incoterm} />}
              <Par
                t="Pago"
                v={`${CONDICIONES_PAGO[compra.condicionPago]}${compra.diasCredito ? ` ${compra.diasCredito} días` : ""}${vence ? ` · vence ${diaMesTexto(vence, true)}` : ""}`}
              />
              {compra.fechaEmbarque && <Par t="Embarque" v={diaMesTexto(compra.fechaEmbarque, true)} />}
              {compra.fechaLlegadaEstimada && <Par t="Llegada estimada" v={diaMesTexto(compra.fechaLlegadaEstimada, true)} />}
            </dl>
            {compra.nota && <p className="text-muted-foreground text-sm whitespace-pre-line">{compra.nota}</p>}

            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full min-w-[36rem] text-sm">
                <thead className="bg-muted/40 text-muted-foreground text-left text-xs">
                  <tr>
                    <th className="px-3 py-2 font-medium">Ítem</th>
                    <th className="px-3 py-2 text-right font-medium">Pedido</th>
                    <th className="px-3 py-2 text-right font-medium">Recibido</th>
                    <th className="px-3 py-2 text-right font-medium">Kilos</th>
                    <th className="px-3 py-2 text-right font-medium">Precio unit.</th>
                    <th className="px-3 py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {compra.lineas.map((l) => {
                    const d = descuadre(l);
                    return (
                      <tr key={l.posicion} className="border-t">
                        <td className="px-3 py-2">
                          <span className="text-muted-foreground mr-2 font-mono text-xs">{l.codigo}</span>
                          {l.nombre}
                        </td>
                        <td className="tnum px-3 py-2 text-right">{l.cantidad}</td>
                        <td className={`tnum px-3 py-2 text-right ${l.recibida < l.cantidad ? "text-st-en_proceso" : ""}`}>{l.recibida}</td>
                        <td className="tnum px-3 py-2 text-right">{l.kilos ?? "—"}</td>
                        <td className="tnum px-3 py-2 text-right">{montoEn(l.precioUnitario, compra.monedaMercaderia)}</td>
                        <td className="tnum px-3 py-2 text-right">
                          {montoEn(Math.round(l.cantidad * l.precioUnitario * 100) / 100, compra.monedaMercaderia)}
                          {d !== null && <p className="text-st-en_proceso text-2xs">PDF: {montoEn(l.totalProveedor!, compra.monedaMercaderia)}</p>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {compra.recepciones.length > 0 ? (
              <ul className="flex flex-col gap-1 text-sm">
                {compra.recepciones.map((r, i) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2">
                    <span className="text-muted-foreground text-xs">Recepción {i + 1}</span>
                    <span>{diaMesTexto(momentoEnLima(r.creadoEn), true)}</span>
                    {r.creadoPor && <span className="text-muted-foreground text-xs">por {r.creadoPor}</span>}
                    <span className="text-muted-foreground tnum text-xs">
                      {r.lineas.reduce((t, l) => t + l.cantidad, 0)} planchas
                    </span>
                    {r.sincronizacion !== "sincronizada" && <EstadoSincronizacion estado={r.sincronizacion} />}
                    {r.error && <span className="text-destructive text-xs">{r.error}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              compra.estado !== "anulada" && (
                <p className="text-muted-foreground text-xs">Almacén la recibe desde Almacén → Recibir compra cuando llegue.</p>
              )
            )}
          </Seccion>

          {compra.estado !== "anulada" && <CostosCompra key={`${compra.estado}-${compra.gastos.length}`} compra={compra} tarifas={tarifas} />}
        </div>
      )}

      <AlertDialog open={anulando} onOpenChange={setAnulando}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Anular {compra.codigo}?</AlertDialogTitle>
            <AlertDialogDescription>
              {compra.odooOrdenId ? "La orden de compra también se cancela en Odoo. " : ""}No se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction onClick={anular} disabled={pendiente}>
              Anular compra
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Par({ t, v }: { t: string; v: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-xs">{t}</dt>
      <dd className="truncate">{v}</dd>
    </div>
  );
}
