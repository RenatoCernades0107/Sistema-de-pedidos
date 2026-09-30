"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import type { Punto } from "@/lib/metricas";

/** Una de las dos series: `a` o `b` de cada `Punto`. */
export interface Serie {
  clave: "a" | "b";
  nombre: string;
  /** El color de la barra, como variable CSS. El texto nunca lo lleva. */
  color: string;
  /** La clase de Tailwind con el mismo color, para la muestra de la leyenda. */
  muestra: string;
}

/**
 * Columnas agrupadas de dos series sobre un mismo eje (vendido y cobrado, o este
 * período y el anterior): mismo tipo de cifra, mismo eje. Nunca dos escalas.
 *
 * Lleva leyenda arriba —el color no es la única pista—, un tooltip por grupo, y la
 * tabla con los mismos números debajo, plegada: el tooltip ayuda, pero ningún
 * valor puede depender de pasar el ratón.
 */
export function Columnas({
  datos,
  series,
  formato,
  formatoEje,
  alto = 240,
}: {
  datos: Punto[];
  series: [Serie, Serie];
  formato: (n: number) => string;
  formatoEje: (n: number) => string;
  alto?: number;
}) {
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {series.map((s) => (
          <li key={s.clave} className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <span aria-hidden className={cn("size-2.5 rounded-[3px]", s.muestra)} />
            {s.nombre}
          </li>
        ))}
      </ul>

      {/* El alto incluye la banda del eje X: si no, las etiquetas se cortan. */}
      <div style={{ height: alto }} aria-hidden>
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: alto }}>
          <BarChart data={datos} barGap={2} barCategoryGap="20%" margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="etiqueta"
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              interval="preserveStartEnd"
              minTickGap={8}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              tickFormatter={formatoEje}
              width={64}
              allowDecimals={false}
            />
            <Tooltip
              cursor={{ fill: "var(--muted)" }}
              content={({ active, payload }) => (
                <Globo
                  active={active}
                  punto={payload?.[0]?.payload as Punto | undefined}
                  series={series}
                  formato={formato}
                />
              )}
            />
            {series.map((s) => (
              <Bar
                key={s.clave}
                dataKey={s.clave}
                name={s.nombre}
                fill={s.color}
                radius={[4, 4, 0, 0]}
                maxBarSize={24}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <details className="group text-sm">
        <summary className="text-muted-foreground hover:text-foreground w-fit cursor-pointer text-xs">
          Ver como tabla
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground border-b text-left">
                <th className="py-1.5 pr-3 font-medium">Tramo</th>
                {series.map((s) => (
                  <th key={s.clave} className="py-1.5 pr-3 text-right font-medium">
                    {s.nombre}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {datos.map((d) => (
                <tr key={d.clave} className="border-b last:border-0">
                  <td className="py-1.5 pr-3">{d.detalle}</td>
                  {series.map((s) => (
                    <td key={s.clave} className="tnum py-1.5 pr-3 text-right">
                      {formato(d[s.clave])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function Globo({
  active,
  punto,
  series,
  formato,
}: {
  active: boolean;
  punto: Punto | undefined;
  series: [Serie, Serie];
  formato: (n: number) => string;
}) {
  if (!active || !punto) return null;

  return (
    <div className="bg-popover text-popover-foreground rounded-lg px-3 py-2 text-xs shadow-(--shadow-overlay) ring-1 ring-foreground/10">
      <p className="mb-1 font-medium">{punto.detalle}</p>
      {series.map((s) => (
        <p key={s.clave} className="flex items-center gap-1.5">
          <span aria-hidden className={cn("size-2 rounded-[2px]", s.muestra)} />
          <span className="text-muted-foreground">{s.nombre}</span>
          <span className="tnum ml-auto pl-3 font-medium">{formato(punto[s.clave])}</span>
        </p>
      ))}
    </div>
  );
}
