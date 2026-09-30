"use client";

import { useMemo } from "react";
import { moneyCompacto, moneyEntero } from "@/lib/formato";
import {
  serieDelPeriodo,
  variacion,
  ventas,
  ventasPorDestino,
  ventasPorProducto,
  ventasPorTipo,
} from "@/lib/metricas";
import { Columnas } from "./columnas";
import {
  Barras,
  FilaKpis,
  Kpi,
  Reparto,
  Seccion,
  barraDeFila,
  pedidosTexto,
  type PropsPestana,
} from "./piezas";

/** ¿Estamos creciendo, y con qué? */
export function PestanaVentas({ pedidos, periodo }: PropsPestana) {
  const d = useMemo(
    () => ({
      actual: ventas(pedidos, periodo),
      previo: ventas(pedidos, periodo.anterior),
      serie: serieDelPeriodo(pedidos, periodo),
      tipos: ventasPorTipo(pedidos, periodo),
      productos: ventasPorProducto(pedidos, periodo),
      destino: ventasPorDestino(pedidos, periodo),
    }),
    [pedidos, periodo],
  );

  const lima = d.destino.find((f) => f.clave === "lima");
  const provincia = d.destino.find((f) => f.clave === "provincia");

  return (
    <div className="flex flex-col gap-4">
      <FilaKpis className="xl:grid-cols-3">
        <Kpi
          etiqueta="Vendido"
          valor={moneyEntero(d.actual.vendido)}
          delta={{ valor: variacion(d.actual.vendido, d.previo.vendido), tipo: "relativo" }}
          detalle={`vs ${moneyEntero(d.previo.vendido)}`}
        />
        <Kpi
          etiqueta="Pedidos"
          valor={String(d.actual.pedidos)}
          delta={{ valor: variacion(d.actual.pedidos, d.previo.pedidos), tipo: "relativo" }}
          detalle={`vs ${d.previo.pedidos}`}
        />
        <Kpi
          etiqueta="Ticket promedio"
          valor={moneyEntero(d.actual.ticket)}
          delta={{ valor: variacion(d.actual.ticket, d.previo.ticket), tipo: "relativo" }}
          detalle={`vs ${moneyEntero(d.previo.ticket)}`}
        />
      </FilaKpis>

      <Seccion
        titulo="Vendido por tramo"
        descripcion={`Cada tramo junto al mismo tramo de ${periodo.nombreAnterior}.`}
      >
        <Columnas
          datos={d.serie}
          series={[
            { clave: "a", nombre: "Este período", color: "var(--chart-1)", muestra: "bg-chart-1" },
            {
              clave: "b",
              nombre: "Período anterior",
              color: "var(--chart-tenue)",
              muestra: "bg-chart-tenue",
            },
          ]}
          formato={moneyEntero}
          formatoEje={moneyCompacto}
        />
      </Seccion>

      <div className="grid gap-4 lg:grid-cols-2">
        <Seccion
          titulo="Por tipo de trabajo"
          descripcion="Mixto: pedidos que combinan trabajos; su monto no se reparte."
        >
          <Barras filas={d.tipos.map(barraDeFila)} formato={moneyEntero} />
        </Seccion>

        <Seccion
          titulo="Productos terminados"
          descripcion="Qué producto se vende más, con el monto completo de cada pedido."
        >
          <Barras filas={d.productos.map(barraDeFila)} formato={moneyEntero} />
        </Seccion>
      </div>

      <Seccion titulo="Lima y provincia" descripcion="Dónde se entrega lo vendido.">
        <Reparto
          formato={moneyEntero}
          partes={[
            {
              clave: "lima",
              etiqueta: "Lima",
              valor: lima?.monto ?? 0,
              detalle: pedidosTexto(lima?.pedidos ?? 0),
            },
            {
              clave: "provincia",
              etiqueta: "Provincia",
              valor: provincia?.monto ?? 0,
              detalle: pedidosTexto(provincia?.pedidos ?? 0),
            },
          ]}
        />
      </Seccion>
    </div>
  );
}
