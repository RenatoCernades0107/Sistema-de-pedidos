"use client";

import Link from "next/link";
import { useMemo } from "react";
import { moneyEntero, porcentaje } from "@/lib/formato";
import {
  cartera,
  cobradoEn,
  cobradoPorMetodo,
  deudores,
  fletePorCobrar,
  variacion,
  ventasPorTipoPago,
} from "@/lib/metricas";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Barras,
  FilaKpis,
  Kpi,
  Seccion,
  Vacio,
  barraDeFila,
  pedidosTexto,
  type PropsPestana,
} from "./piezas";

/** ¿Cuánta plata está en la calle, y desde cuándo? */
export function PestanaCobranza({ pedidos, periodo, hoy }: PropsPestana) {
  const d = useMemo(
    () => ({
      cobrado: cobradoEn(pedidos, periodo),
      cobradoPrevio: cobradoEn(pedidos, periodo.anterior),
      cartera: cartera(pedidos, hoy),
      flete: fletePorCobrar(pedidos),
      deudores: deudores(pedidos, hoy),
      metodos: cobradoPorMetodo(pedidos, periodo),
      tiposPago: ventasPorTipoPago(pedidos, periodo),
    }),
    [pedidos, periodo, hoy],
  );

  const { porCobrar, vencida } = d.cartera;

  return (
    <div className="flex flex-col gap-4">
      <FilaKpis className="lg:grid-cols-4 xl:grid-cols-4">
        <Kpi
          etiqueta="Cobrado en el período"
          valor={moneyEntero(d.cobrado)}
          delta={{ valor: variacion(d.cobrado, d.cobradoPrevio), tipo: "relativo" }}
          detalle={`vs ${moneyEntero(d.cobradoPrevio)}`}
        />
        <Kpi
          etiqueta="Por cobrar hoy"
          valor={moneyEntero(porCobrar)}
          detalle={pedidosTexto(d.cartera.pedidos)}
        />
        <Kpi
          etiqueta="Deuda vencida"
          valor={moneyEntero(vencida)}
          alerta={vencida > 0}
          detalle={porCobrar > 0 ? `${porcentaje(vencida / porCobrar)} de lo que se debe` : undefined}
        />
        <Kpi
          etiqueta="Flete por cobrar"
          valor={moneyEntero(d.flete.monto)}
          detalle={`${d.flete.pedidos} ${d.flete.pedidos === 1 ? "envío" : "envíos"} a provincia`}
        />
      </FilaKpis>

      <div className="grid gap-4 lg:grid-cols-2">
        <Seccion
          titulo="Antigüedad de la deuda"
          descripcion="Lo que se debe hoy, según cuánto hace que venció. Al crédito vence al acabar el plazo; al contado o a cuenta, al entregar."
        >
          {porCobrar > 0 ? (
            <Barras
              formato={moneyEntero}
              filas={d.cartera.tramos.map((t) => ({
                ...barraDeFila(t),
                // Lo vencido en color; lo que todavía no vence, en gris.
                resaltar: t.clave !== "al-dia",
              }))}
            />
          ) : (
            <Vacio>Nadie debe nada.</Vacio>
          )}
        </Seccion>

        <Seccion
          titulo="Quién debe más"
          descripcion="Saldo pendiente por cliente. El enlace lleva a su pedido más atrasado."
        >
          {d.deudores.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                  <TableHead className="text-right">Atraso</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.deudores.map((x) => (
                  <TableRow key={x.clave}>
                    <TableCell className="max-w-[12rem]">
                      <Link
                        href={`/pedidos/${x.codigo}`}
                        className="block truncate hover:underline"
                      >
                        {x.cliente}
                      </Link>
                      <span className="text-muted-foreground text-xs">
                        {pedidosTexto(x.pedidos)}
                      </span>
                    </TableCell>
                    <TableCell className="tnum text-right font-medium">
                      {moneyEntero(x.saldo)}
                    </TableCell>
                    <TableCell
                      className={
                        x.diasAtraso > 0 ? "tnum text-saldo-alerta text-right" : "tnum text-right"
                      }
                    >
                      {x.diasAtraso > 0 ? `${x.diasAtraso} d` : "Al día"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Vacio>Nadie debe nada.</Vacio>
          )}
        </Seccion>

        <Seccion
          titulo="Cómo pagan"
          descripcion="Lo cobrado en el período por método de pago."
        >
          <Barras
            formato={moneyEntero}
            filas={d.metodos.map((f) => ({
              ...barraDeFila(f),
              detalle: `${f.pedidos} ${f.pedidos === 1 ? "abono" : "abonos"}`,
            }))}
          />
        </Seccion>

        <Seccion
          titulo="Condición de venta"
          descripcion="Lo vendido en el período, según se pactó el pago."
        >
          <Barras formato={moneyEntero} filas={d.tiposPago.map(barraDeFila)} />
        </Seccion>
      </div>
    </div>
  );
}
