"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  FileDown,
  MessageSquareText,
  Plus,
  RotateCw,
  Scissors,
} from "lucide-react";
import { toast } from "sonner";
import { reintentarConfirmacion, reintentarSincronizacion } from "@/app/(app)/cotizaciones/acciones";
import { referenciaDe, sumaLineas, type Cotizacion } from "@/lib/cotizaciones";
import { momentoEnLima } from "@/lib/fecha";
import { fechaHora, money, numero } from "@/lib/formato";
import { Button } from "@/components/ui/button";
import { TerminadoGuardadoVista } from "@/components/terminados/terminado-guardado";
import { CorteGuardadoVista } from "@/components/cortes/corte-guardado";
import { CodigoProducto } from "./buscador-producto";
import { CanalBadge, EstadoSincronizacion } from "./estado-cotizacion";

export function DetalleCotizacion({
  cotizacion: c,
  enlaceOdoo,
  puedeAsistente,
  puedeCrearPedido,
}: {
  cotizacion: Cotizacion;
  /** Calculado en el servidor: la URL de Odoo no viaja en el bundle. */
  enlaceOdoo: string | null;
  puedeAsistente: boolean;
  puedeCrearPedido: boolean;
}) {
  const router = useRouter();
  const [reintentando, iniciar] = useTransition();
  const [confirmando, iniciarConfirmacion] = useTransition();

  const confirmar = () =>
    iniciarConfirmacion(async () => {
      const r = await reintentarConfirmacion(c.id);
      if (r.ok) toast.success(`${referenciaDe(c)} confirmada en Odoo`);
      else toast.error("Odoo no la confirmó", { description: r.error });
      router.refresh();
    });

  const reintentar = () =>
    iniciar(async () => {
      const r = await reintentarSincronizacion(c.id);
      if (r.ok) toast.success(`Cotización ${r.orderName} creada en Odoo`);
      else toast.error("Odoo volvió a rechazarla", { description: r.error });
      router.refresh();
    });

  const suma = sumaLineas(c.lineas);

  return (
    <div className="px-4 py-5 md:px-6 md:py-6">
      <Button
        render={<Link href="/cotizaciones" />}
        nativeButton={false}
        variant="ghost"
        size="sm"
        className="text-muted-foreground -ml-2 mb-3 gap-1.5"
      >
        <ArrowLeft className="size-3.5" />
        Cotizaciones
      </Button>

      <header className="mb-5 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="eyebrow">Cotización</p>
          <h1 className="mt-0.5 flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight">
            <span data-testid="referencia-cotizacion">{referenciaDe(c)}</span>
            <CanalBadge canal={c.canal} />
            <EstadoSincronizacion estado={c.sincronizacion} />
          </h1>
          <p className="text-muted-foreground mt-1 text-xs">
            {fechaHora(momentoEnLima(c.creadoEn))}
            {c.creadoPor && ` · ${c.creadoPor}`}
            {c.chatAgenteId && " · desde el asistente"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {enlaceOdoo && c.odooOrderId && (
            <Button
              render={<a href={enlaceOdoo} target="_blank" rel="noreferrer" />}
              nativeButton={false}
              variant="outline"
              className="gap-1.5"
            >
              <ExternalLink />
              Abrir en Odoo
            </Button>
          )}
          <Button
            render={<Link href="/cotizaciones/nueva" />}
            nativeButton={false}
            variant={puedeCrearPedido ? "outline" : "default"}
            className="gap-1.5"
          >
            <Plus />
            Nueva cotización
          </Button>
          {puedeCrearPedido &&
            (c.pedido ? (
              <Button
                render={<Link href={`/pedidos/${c.pedido.codigo}`} />}
                nativeButton={false}
                className="gap-1.5"
              >
                <ClipboardList />
                Ver pedido {c.pedido.codigo}
              </Button>
            ) : c.sincronizacion === "sincronizada" ? (
              <Button
                render={<Link href={`/pedidos/nuevo?cotizacion=${c.id}`} />}
                nativeButton={false}
                className="gap-1.5"
              >
                <ClipboardList />
                Crear pedido
              </Button>
            ) : (
              // Sin orden en Odoo no hay qué confirmar al crear el pedido.
              <Button disabled className="gap-1.5" title="Primero tiene que crearse en Odoo">
                <ClipboardList />
                Crear pedido
              </Button>
            ))}
        </div>
      </header>

      <div className="flex max-w-3xl flex-col gap-4">
        {c.sincronizacion === "error" && (
          <div
            role="alert"
            className="border-destructive/30 bg-destructive/10 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm"
          >
            <div className="min-w-0 flex-1">
              <p className="text-destructive font-medium">No se creó en Odoo</p>
              <p className="text-destructive/90 mt-0.5">{c.errorSincronizacion}</p>
              <p className="text-muted-foreground mt-1 text-xs">
                Lo cotizado está guardado. Reintentar no la duplica en Odoo.
              </p>
            </div>
            <Button onClick={reintentar} disabled={reintentando} className="gap-1.5">
              <RotateCw className={reintentando ? "animate-spin" : undefined} />
              {reintentando ? "Reintentando…" : "Reintentar"}
            </Button>
          </div>
        )}

        {c.pedido && (
          <section
            className={
              c.errorConfirmacion
                ? "border-destructive/30 bg-destructive/10 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm"
                : "bg-card flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm"
            }
            role={c.errorConfirmacion ? "alert" : undefined}
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                Pedido{" "}
                <Link href={`/pedidos/${c.pedido.codigo}`} className="text-primary tnum hover:underline">
                  {c.pedido.codigo}
                </Link>
              </p>
              {c.confirmadaEnOdoo ? (
                <p className="text-muted-foreground mt-0.5 flex items-center gap-1.5">
                  <CheckCircle2 className="text-st-entregado size-3.5" />
                  Confirmada en Odoo como pedido de venta.
                </p>
              ) : c.errorConfirmacion ? (
                <>
                  <p className="text-destructive mt-0.5">No se confirmó en Odoo: {c.errorConfirmacion}</p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    El pedido ya está registrado. Confirmar no la duplica en Odoo.
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground mt-0.5">Todavía sin confirmar en Odoo.</p>
              )}
            </div>
            {!c.confirmadaEnOdoo && (
              <Button
                onClick={confirmar}
                disabled={confirmando}
                variant={c.errorConfirmacion ? "default" : "outline"}
                className="gap-1.5"
              >
                <RotateCw className={confirmando ? "animate-spin" : undefined} />
                {confirmando ? "Confirmando…" : "Confirmar en Odoo"}
              </Button>
            )}
          </section>
        )}

        <section className="bg-card rounded-xl border p-4">
          <p className="eyebrow mb-1.5">Cliente</p>
          <p className="font-medium">{c.cliente.nombre}</p>
          <p className="text-muted-foreground tnum mt-0.5 flex flex-wrap gap-x-3 text-sm">
            {c.cliente.documento && <span>{c.cliente.documento}</span>}
            {c.cliente.telefono && <span>{c.cliente.telefono}</span>}
          </p>
        </section>

        <section className="bg-card overflow-hidden rounded-xl border">
          <p className="eyebrow border-b px-4 py-2.5">Productos</p>
          <ul className="divide-y">
            {c.lineas.map((l) =>
              l.corte ? (
                // Un corte a medida: su cálculo entero, con el plano.
                <li key={l.posicion} className="px-4 py-3" data-testid="linea-corte">
                  <CorteGuardadoVista corte={l.corte} conPrecios />
                </li>
              ) : l.terminado ? (
                <li key={l.posicion} className="px-4 py-3">
                  <TerminadoGuardadoVista terminado={l.terminado} cantidad={l.cantidad} importe={l.importe} conPrecios />
                </li>
              ) : (
                <li key={l.posicion} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm">
                      {l.codigo && <CodigoProducto codigo={l.codigo} />}
                      <span className="font-medium">{l.nombre}</span>
                    </p>
                    {l.descripcion && (
                      <p className="text-muted-foreground mt-1 text-xs whitespace-pre-line">{l.descripcion}</p>
                    )}
                  </div>
                  <p className="tnum text-muted-foreground text-sm">
                    {numero(l.cantidad)} × {money(l.precioUnitario)}
                  </p>
                  <p className="tnum w-24 text-right text-sm font-medium">{money(l.importe)}</p>
                </li>
              ),
            )}
          </ul>
          <dl className="bg-muted/30 flex flex-col gap-1 border-t px-4 py-3 text-sm">
            {c.montoTotal !== null ? (
              <>
                <Fila etiqueta="Subtotal" valor={c.montoSinImpuestos} />
                <Fila etiqueta="Impuestos" valor={c.montoImpuestos} />
                <Fila etiqueta="Total en Odoo" valor={c.montoTotal} fuerte />
              </>
            ) : (
              <Fila etiqueta="Total referencial" valor={suma} fuerte />
            )}
          </dl>
        </section>

        {c.notas && (
          <section className="bg-card rounded-xl border p-4">
            <p className="eyebrow mb-1.5">Notas internas</p>
            <p className="text-sm whitespace-pre-line">{c.notas}</p>
          </section>
        )}

        {c.chatAgenteId && puedeAsistente && (
          <section className="bg-card flex flex-wrap gap-2 rounded-xl border p-4">
            <p className="eyebrow w-full">Del asistente</p>
            <Button
              render={<Link href={`/cotizaciones/asistente?chat=${encodeURIComponent(c.chatAgenteId)}`} />}
              nativeButton={false}
              variant="outline"
              size="sm"
              className="gap-1.5"
            >
              <MessageSquareText />
              Ver chat
            </Button>
            <Button
              render={
                <a href={`/api/cotizaciones/${encodeURIComponent(c.chatAgenteId)}/cotizacion`} target="_blank" rel="noreferrer" />
              }
              nativeButton={false}
              variant="outline"
              size="sm"
              className="gap-1.5"
            >
              <FileDown />
              PDF de la cotización
            </Button>
            <Button
              render={
                <a href={`/api/cotizaciones/${encodeURIComponent(c.chatAgenteId)}/hoja-corte`} target="_blank" rel="noreferrer" />
              }
              nativeButton={false}
              variant="outline"
              size="sm"
              className="gap-1.5"
            >
              <Scissors />
              Hoja de corte
            </Button>
          </section>
        )}
      </div>
    </div>
  );
}

function Fila({ etiqueta, valor, fuerte }: { etiqueta: string; valor: number | null; fuerte?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className={fuerte ? "font-medium" : "text-muted-foreground"}>{etiqueta}</dt>
      <dd className={fuerte ? "tnum text-base font-semibold" : "tnum"}>{valor === null ? "—" : money(valor)}</dd>
    </div>
  );
}
