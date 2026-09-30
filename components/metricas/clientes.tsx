"use client";

import { useMemo } from "react";
import { TriangleAlert } from "lucide-react";
import { moneyEntero, porcentaje } from "@/lib/formato";
import { clientes, ventasPorDepartamento, ventasPorRegistrador } from "@/lib/metricas";
import {
  Barras,
  FilaKpis,
  Kpi,
  Reparto,
  Seccion,
  barraDeFila,
  type PropsPestana,
} from "./piezas";

/** Si tres clientes se llevan más de esto, perder uno es perder una parte seria del negocio. */
const CONCENTRACION_RIESGOSA = 0.5;

const clientesTexto = (n: number) => `${n} ${n === 1 ? "cliente" : "clientes"}`;

/** ¿De quién depende el negocio, adónde se vende y quién vende? */
export function PestanaClientes({ pedidos, periodo }: PropsPestana) {
  const d = useMemo(
    () => ({
      clientes: clientes(pedidos, periodo),
      departamentos: ventasPorDepartamento(pedidos, periodo),
      registradores: ventasPorRegistrador(pedidos, periodo),
    }),
    [pedidos, periodo],
  );

  const c = d.clientes;
  const concentrado = c.total > 3 && c.cuotaTop3 > CONCENTRACION_RIESGOSA;

  return (
    <div className="flex flex-col gap-4">
      <FilaKpis className="lg:grid-cols-4 xl:grid-cols-4">
        <Kpi etiqueta="Clientes que compraron" valor={String(c.total)} />
        <Kpi
          etiqueta="Nuevos"
          valor={String(c.nuevos.clientes)}
          detalle={moneyEntero(c.nuevos.monto)}
        />
        <Kpi
          etiqueta="Recurrentes"
          valor={String(c.recurrentes.clientes)}
          detalle={moneyEntero(c.recurrentes.monto)}
        />
        <Kpi
          etiqueta="Peso de los 3 mayores"
          valor={c.total ? porcentaje(c.cuotaTop3) : "—"}
          alerta={concentrado}
          detalle="de lo vendido"
        />
      </FilaKpis>

      <div className="grid gap-4 lg:grid-cols-2">
        <Seccion
          titulo="Los 10 que más compran"
          descripcion={
            c.total
              ? `Se llevan el ${porcentaje(c.cuotaTop10)} de lo vendido en el período.`
              : undefined
          }
        >
          {concentrado && (
            <p className="bg-st-observado-soft text-st-observado mb-3 flex items-start gap-2 rounded-lg px-3 py-2 text-xs">
              <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
              Tres clientes concentran más de la mitad de las ventas: perder uno pesa mucho.
            </p>
          )}
          <Barras formato={moneyEntero} filas={c.top.map(barraDeFila)} />
        </Seccion>

        <div className="flex flex-col gap-4">
          <Seccion
            titulo="Nuevos y recurrentes"
            descripcion="Nuevo es quien no había comprado antes de este período. Se agrupa por nombre."
          >
            <Reparto
              formato={moneyEntero}
              partes={[
                {
                  clave: "nuevos",
                  etiqueta: "Nuevos",
                  valor: c.nuevos.monto,
                  detalle: clientesTexto(c.nuevos.clientes),
                },
                {
                  clave: "recurrentes",
                  etiqueta: "Recurrentes",
                  valor: c.recurrentes.monto,
                  detalle: clientesTexto(c.recurrentes.clientes),
                },
              ]}
            />
          </Seccion>

          <Seccion titulo="Provincia por departamento" descripcion="Lo vendido fuera de Lima.">
            <Barras formato={moneyEntero} filas={d.departamentos.map(barraDeFila)} />
          </Seccion>
        </div>

        <Seccion
          titulo="Quién registra las ventas"
          descripcion="Lo vendido en el período según quién registró el pedido."
        >
          <Barras formato={moneyEntero} filas={d.registradores.map(barraDeFila)} />
        </Seccion>
      </div>
    </div>
  );
}
