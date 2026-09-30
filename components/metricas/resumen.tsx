"use client";

import Link from "next/link";
import { useMemo } from "react";
import { CircleCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { saldoDe, type Pedido } from "@/lib/dominio";
import { fechaCompleta, money, moneyCompacto, moneyEntero, porcentaje } from "@/lib/formato";
import {
  alertas,
  atrasados,
  cartera,
  cobradoEn,
  cumplimiento,
  diasDeAtraso,
  diasEntre,
  serieMensual,
  variacion,
  ventas,
  type Alerta,
} from "@/lib/metricas";
import { Card, CardContent } from "@/components/ui/card";
import { Columnas } from "./columnas";
import { FilaKpis, Kpi, Seccion, pedidosTexto, type PropsPestana } from "./piezas";

/** Lo que el gerente mira en diez segundos: seis cifras, la tendencia y lo que urge. */
export function PestanaResumen({ pedidos, periodo, hoy }: PropsPestana) {
  const d = useMemo(() => {
    const actual = ventas(pedidos, periodo);
    const previo = ventas(pedidos, periodo.anterior);
    const cum = cumplimiento(pedidos, periodo);
    const cumPrevio = cumplimiento(pedidos, periodo.anterior);
    return {
      actual,
      previo,
      cobrado: cobradoEn(pedidos, periodo),
      cobradoPrevio: cobradoEn(pedidos, periodo.anterior),
      cartera: cartera(pedidos, hoy),
      cum,
      cumPrevio,
      atrasados: atrasados(pedidos, hoy).length,
      serie: serieMensual(pedidos, hoy),
      alertas: alertas(pedidos, hoy),
    };
  }, [pedidos, periodo, hoy]);

  const puntos =
    d.cum.tasaATiempo !== null && d.cumPrevio.tasaATiempo !== null
      ? d.cum.tasaATiempo - d.cumPrevio.tasaATiempo
      : null;

  return (
    <div className="flex flex-col gap-4">
      <FilaKpis>
        <Kpi
          etiqueta="Vendido"
          valor={moneyEntero(d.actual.vendido)}
          delta={{ valor: variacion(d.actual.vendido, d.previo.vendido), tipo: "relativo" }}
          detalle={`vs ${moneyEntero(d.previo.vendido)}`}
        />
        <Kpi
          etiqueta="Cobrado"
          valor={moneyEntero(d.cobrado)}
          delta={{ valor: variacion(d.cobrado, d.cobradoPrevio), tipo: "relativo" }}
          detalle={`vs ${moneyEntero(d.cobradoPrevio)}`}
        />
        <Kpi
          etiqueta="Por cobrar hoy"
          valor={moneyEntero(d.cartera.porCobrar)}
          detalle={
            d.cartera.vencida > 0 ? (
              <span className="text-saldo-alerta">{moneyEntero(d.cartera.vencida)} vencido</span>
            ) : (
              "nada vencido"
            )
          }
        />
        <Kpi
          etiqueta="Ticket promedio"
          valor={moneyEntero(d.actual.ticket)}
          delta={{ valor: variacion(d.actual.ticket, d.previo.ticket), tipo: "relativo" }}
          detalle={pedidosTexto(d.actual.pedidos)}
        />
        <Kpi
          etiqueta="Entregado a tiempo"
          valor={d.cum.tasaATiempo === null ? "—" : porcentaje(d.cum.tasaATiempo)}
          delta={{ valor: puntos, tipo: "puntos" }}
          detalle={`${d.cum.aTiempo} de ${d.cum.entregados}`}
        />
        <Kpi
          etiqueta="Atrasados hoy"
          valor={String(d.atrasados)}
          alerta={d.atrasados > 0}
          detalle="en curso, fecha vencida"
        />
      </FilaKpis>

      <Seccion
        titulo="Vendido y cobrado, últimos 12 meses"
        descripcion="Si lo cobrado queda por debajo de lo vendido mes tras mes, la deuda de los clientes crece."
      >
        <Columnas
          datos={d.serie}
          series={[
            { clave: "a", nombre: "Vendido", color: "var(--chart-1)", muestra: "bg-chart-1" },
            { clave: "b", nombre: "Cobrado", color: "var(--chart-2)", muestra: "bg-chart-2" },
          ]}
          formato={moneyEntero}
          formatoEje={moneyCompacto}
        />
      </Seccion>

      <section>
        <h2 className="eyebrow mb-2">Requiere atención</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {d.alertas.map((a) => (
            <TarjetaAlerta key={a.clave} alerta={a} hoy={hoy} />
          ))}
        </div>
      </section>
    </div>
  );
}

const VISIBLES = 5;

function TarjetaAlerta({ alerta, hoy }: { alerta: Alerta; hoy: string }) {
  const n = alerta.pedidos.length;
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <p className="font-medium">{alerta.titulo}</p>
          <span
            className={cn(
              "tnum rounded-full px-1.5 text-xs font-medium",
              n > 0 ? "bg-st-observado-soft text-st-observado" : "bg-muted text-muted-foreground",
            )}
          >
            {n}
          </span>
          {n > 0 && (
            <span className="tnum text-muted-foreground ml-auto text-sm">
              {moneyEntero(alerta.monto)}
            </span>
          )}
        </div>
        <p className="text-muted-foreground text-xs">{alerta.descripcion}</p>

        {n === 0 ? (
          <p className="text-st-entregado flex items-center gap-1.5 text-sm">
            <CircleCheck className="size-4" aria-hidden />
            Nada pendiente
          </p>
        ) : (
          <ul className="divide-border -mx-1 divide-y">
            {alerta.pedidos.slice(0, VISIBLES).map((p) => (
              <li key={p.codigo}>
                <Link
                  href={`/pedidos/${p.codigo}`}
                  className="hover:bg-muted flex items-center gap-2 rounded-md px-1 py-1.5 text-sm"
                >
                  <span className="tnum font-mono text-xs">{p.codigo}</span>
                  <span className="text-muted-foreground min-w-0 flex-1 truncate">{p.cliente}</span>
                  <span className="tnum shrink-0 text-xs">{datoDe(alerta, p, hoy)}</span>
                </Link>
              </li>
            ))}
            {n > VISIBLES && (
              <li className="text-muted-foreground px-1 pt-1.5 text-xs">
                y {pedidosTexto(n - VISIBLES)} más
              </li>
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** El dato que explica por qué el pedido está en la lista. */
function datoDe(alerta: Alerta, p: Pedido, hoy: string) {
  switch (alerta.clave) {
    case "credito":
      return `${money(saldoDe(p))} · ${diasDeAtraso(p, hoy)} d`;
    case "entregado-con-saldo":
      return money(saldoDe(p));
    case "atrasados":
      return `${diasEntre(p.fechaPrometida, hoy)} d tarde`;
    case "observados": {
      const desde = p.historial.findLast((h) => h.estado === "observado")?.fecha;
      return desde ? `desde ${fechaCompleta(desde)}` : "";
    }
  }
}
