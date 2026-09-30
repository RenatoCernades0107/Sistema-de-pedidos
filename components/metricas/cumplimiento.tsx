"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { moneyEntero, porcentaje } from "@/lib/formato";
import {
  atrasados,
  cumplimiento,
  etiquetaDia,
  motivosFrecuentes,
  pipeline,
  porResponsable,
  proximosDias,
  tiemposPorEtapa,
  variacion,
} from "@/lib/metricas";
import { EstadoBadge } from "@/components/estado-badge";
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
  diasTexto,
  pedidosTexto,
  type PropsPestana,
} from "./piezas";

/** La diferencia entre dos tasas, o nada si falta alguna. */
const diferencia = (a: number | null, b: number | null) => (a !== null && b !== null ? a - b : null);

const tasaTexto = (t: number | null) => (t === null ? "—" : porcentaje(t));

const nombreDelDia = new Intl.DateTimeFormat("es-PE", { weekday: "short", timeZone: "UTC" });

/** `2026-10-01` → "jue 1 oct" */
const diaDeLaSemana = (fecha: string) =>
  `${nombreDelDia.format(new Date(`${fecha}T12:00:00Z`)).replace(".", "")} ${etiquetaDia(fecha)}`;

/** ¿Cumplimos lo que prometemos, y dónde se atasca el taller? */
export function PestanaCumplimiento({ pedidos, periodo, hoy }: PropsPestana) {
  const d = useMemo(
    () => ({
      cum: cumplimiento(pedidos, periodo),
      previo: cumplimiento(pedidos, periodo.anterior),
      atrasados: atrasados(pedidos, hoy).length,
      pipeline: pipeline(pedidos),
      etapas: tiemposPorEtapa(pedidos, periodo),
      responsables: porResponsable(pedidos, periodo, hoy),
      motivos: motivosFrecuentes(pedidos, periodo),
      proximos: proximosDias(pedidos, hoy),
    }),
    [pedidos, periodo, hoy],
  );

  const masLenta = Math.max(...d.etapas.map((e) => e.dias), 0);

  return (
    <div className="flex flex-col gap-4">
      <FilaKpis className="xl:grid-cols-5">
        <Kpi
          etiqueta="Entregado a tiempo"
          valor={tasaTexto(d.cum.tasaATiempo)}
          delta={{ valor: diferencia(d.cum.tasaATiempo, d.previo.tasaATiempo), tipo: "puntos" }}
          detalle={`${d.cum.aTiempo} de ${d.cum.entregados}`}
        />
        <Kpi
          etiqueta="Días para entregar"
          valor={d.cum.diasPromedio === null ? "—" : diasTexto(d.cum.diasPromedio)}
          delta={{
            valor:
              d.cum.diasPromedio !== null && d.previo.diasPromedio !== null
                ? variacion(d.cum.diasPromedio, d.previo.diasPromedio)
                : null,
            tipo: "relativo",
            subeEsBueno: false,
          }}
          detalle="de registrado a entregado"
        />
        <Kpi
          etiqueta="Atrasados hoy"
          valor={String(d.atrasados)}
          alerta={d.atrasados > 0}
          detalle="en curso, fecha vencida"
        />
        <Kpi
          etiqueta="Observados"
          valor={tasaTexto(d.cum.tasaObservados)}
          delta={{
            valor: diferencia(d.cum.tasaObservados, d.previo.tasaObservados),
            tipo: "puntos",
            subeEsBueno: false,
          }}
          detalle={`de ${pedidosTexto(d.cum.registrados)}`}
        />
        <Kpi
          etiqueta="Anulados"
          valor={tasaTexto(d.cum.tasaAnulados)}
          delta={{
            valor: diferencia(d.cum.tasaAnulados, d.previo.tasaAnulados),
            tipo: "puntos",
            subeEsBueno: false,
          }}
          detalle={`de ${pedidosTexto(d.cum.registrados)}`}
        />
      </FilaKpis>

      <div className="grid gap-4 lg:grid-cols-2">
        <Seccion titulo="En curso ahora" descripcion="La carga de trabajo, por estado.">
          {d.pipeline.some((f) => f.pedidos > 0) ? (
            <Barras
              formato={String}
              filas={d.pipeline.map((f) => ({
                clave: f.clave,
                etiqueta: f.etiqueta,
                valor: f.pedidos,
                detalle: moneyEntero(f.monto),
              }))}
            />
          ) : (
            <Vacio>No hay pedidos en curso.</Vacio>
          )}
        </Seccion>

        <Seccion
          titulo="Cuánto dura cada etapa"
          descripcion="Días promedio en cada estado, en los pedidos entregados del período. La más larga es el cuello de botella."
        >
          <Barras
            formato={diasTexto}
            filas={d.etapas.map((e) => ({
              clave: e.estado,
              etiqueta: e.etiqueta,
              valor: e.dias,
              detalle: pedidosTexto(e.pedidos),
              resaltar: e.dias === masLenta && masLenta > 0,
            }))}
          />
        </Seccion>

        <Seccion
          titulo="Próximos 7 días"
          descripcion={
            d.atrasados > 0
              ? `Pedidos en curso que vencen cada día. Aparte, ${pedidosTexto(d.atrasados)} ya ${d.atrasados === 1 ? "está atrasado" : "están atrasados"}.`
              : "Pedidos en curso que vencen cada día."
          }
        >
          {d.proximos.every((x) => x.pedidos === 0) ? (
            <Vacio>Nada vence en los próximos 7 días.</Vacio>
          ) : (
            <Barras
              formato={String}
              filas={d.proximos.map((x, i) => ({
                clave: x.fecha,
                etiqueta: i === 0 ? "Hoy" : i === 1 ? "Mañana" : diaDeLaSemana(x.fecha),
                valor: x.pedidos,
                detalle: x.pedidos ? moneyEntero(x.monto) : undefined,
              }))}
            />
          )}
        </Seccion>

        <Seccion
          titulo="Por qué se detienen"
          descripcion="Los motivos más repetidos de observaciones y anulaciones del período."
        >
          {d.motivos.length ? (
            <ul className="flex flex-col gap-2">
              {d.motivos.map((m) => (
                <li key={`${m.estado}:${m.motivo}`} className="flex items-start gap-2">
                  <EstadoBadge estado={m.estado} size="sm" />
                  <span className="min-w-0 flex-1 text-sm">{m.motivo}</span>
                  <span className="tnum text-muted-foreground text-sm">×{m.veces}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Vacio>Nada observado ni anulado en este período.</Vacio>
          )}
        </Seccion>
      </div>

      <Seccion
        titulo="Por responsable"
        descripcion="Carga actual de cada uno y cómo le fue con lo que entregó en el período."
      >
        {d.responsables.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Responsable</TableHead>
                <TableHead className="text-right">En curso</TableHead>
                <TableHead className="text-right">Atrasados</TableHead>
                <TableHead className="text-right">Entregados</TableHead>
                <TableHead className="text-right">A tiempo</TableHead>
                <TableHead className="text-right">Días prom.</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.responsables.map((r) => (
                <TableRow key={r.nombre}>
                  <TableCell className={cn(r.nombre === "Sin asignar" && "text-muted-foreground")}>
                    {r.nombre}
                  </TableCell>
                  <TableCell className="tnum text-right">{r.activos}</TableCell>
                  <TableCell
                    className={cn("tnum text-right", r.atrasados > 0 && "text-saldo-alerta")}
                  >
                    {r.atrasados}
                  </TableCell>
                  <TableCell className="tnum text-right">{r.entregados}</TableCell>
                  <TableCell className="tnum text-right">{tasaTexto(r.tasaATiempo)}</TableCell>
                  <TableCell className="tnum text-right">
                    {r.diasPromedio === null ? "—" : diasTexto(r.diasPromedio)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Vacio />
        )}
      </Seccion>
    </div>
  );
}
