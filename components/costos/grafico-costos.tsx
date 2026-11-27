"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ConfigCostos, MesOperativo } from "@/lib/costeo";
import { serieDeCostos, serieDeMargen, serieDePlancha, type Fila, type Unidad } from "@/lib/costos-grafico";
import type { FilaCostoPrecio, Series } from "@/lib/costos-servidor";
import { espesorTexto } from "@/lib/cortes/catalogo";
import { diaMesTexto, money } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { Campo, Opciones } from "@/components/ui/campo";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Modo = "plancha" | "comparar" | "margen";

/**
 * Tres series como máximo, en este orden fijo (azul, naranja, verde). La paleta
 * se validó para daltonismo en claro y oscuro; como verde y naranja quedan cerca
 * para protan/deutan, cada serie lleva además su trazo (continuo, guiones,
 * puntos) y su nombre en la leyenda.
 */
const ESTILOS = [
  { color: "var(--chart-1)", trazo: undefined, muestra: "bg-chart-1" },
  { color: "var(--chart-2)", trazo: "6 4", muestra: "bg-chart-2" },
  { color: "var(--chart-serie-3)", trazo: "2 3", muestra: "bg-chart-serie-3" },
] as const;
const MAX_SERIES = ESTILOS.length;

const UNIDADES: Record<Unidad, string> = { plancha: "Por plancha", kg: "Por kg", m2: "Por m²" };

/**
 * El gráfico de Costos y precios. Se filtra por material → color → espesor →
 * medida, y muestra:
 *   - una plancha: su 1er costo, su 2do costo y su precio (sin IGV);
 *   - comparar: el 1er costo de hasta tres planchas, por plancha, kg o m²;
 *   - margen: el margen de hasta tres planchas en el tiempo.
 */
export function GraficoCostos({
  filas,
  series,
  meses,
  config,
  hoy,
}: {
  filas: FilaCostoPrecio[];
  series: Series;
  meses: MesOperativo[];
  config: ConfigCostos;
  hoy: string;
}) {
  const conHistorial = useMemo(() => filas.filter((f) => f.productoId && series.costos[f.productoId]?.length), [filas, series]);
  const materiales = [...new Set(conHistorial.map((f) => f.material))];
  const [modo, setModo] = useState<Modo>("plancha");
  const [unidad, setUnidad] = useState<Unidad>("kg");
  const [material, setMaterial] = useState<string | null>(materiales[0] ?? null);
  const [color, setColor] = useState<string | null>(null);
  const [espesor, setEspesor] = useState<string | null>(null);
  const [medida, setMedida] = useState<string | null>(null);
  const [elegidas, setElegidas] = useState<string[] | null>(null);

  const deMaterial = conHistorial.filter((f) => f.material === material);
  const colores = [...new Set(deMaterial.map((f) => f.color))];
  const deColor = deMaterial.filter((f) => !color || f.color === color);
  const espesores = [...new Set(deColor.map((f) => String(f.espesorMm)))].sort((a, b) => Number(a) - Number(b));
  const deEspesor = deColor.filter((f) => !espesor || String(f.espesorMm) === espesor);
  const medidas = [...new Set(deEspesor.map((f) => f.medida))];
  const candidatas = deEspesor.filter((f) => !medida || f.medida === medida);

  // Comparar y margen: hasta tres planchas; el color sigue a la plancha, no al orden.
  const marcadas = (elegidas ?? candidatas.slice(0, MAX_SERIES).map((f) => f.codigo)).filter((c) => candidatas.some((f) => f.codigo === c));
  const enGrafico = candidatas.filter((f) => marcadas.includes(f.codigo));
  const estiloDe = (codigo: string) => ESTILOS[Math.max(0, marcadas.indexOf(codigo)) % MAX_SERIES];
  const plancha = candidatas[0] ?? null;

  const { datos, lineas, formato } = (() => {
    if (modo === "plancha") {
      if (!plancha) return { datos: [] as Fila[], lineas: [], formato: money };
      return {
        datos: serieDePlancha(plancha, series, meses, config, hoy),
        lineas: [
          { clave: "primer", nombre: "1er costo", ...ESTILOS[0] },
          { clave: "segundo", nombre: "2do costo", ...ESTILOS[1] },
          { clave: "precio", nombre: "Precio sin IGV", ...ESTILOS[2] },
        ],
        formato: money,
      };
    }
    const lineasDe = () => enGrafico.map((f) => ({ clave: f.codigo, nombre: `${f.codigo} · ${f.color} ${espesorTexto(f.espesorMm)} ${f.medida}`, ...estiloDe(f.codigo) }));
    if (modo === "comparar") {
      return { datos: serieDeCostos(enGrafico, series, unidad, hoy), lineas: lineasDe(), formato: money };
    }
    return { datos: serieDeMargen(enGrafico, series, meses, config, hoy), lineas: lineasDe(), formato: (n: number) => `${n.toFixed(1)}%` };
  })();

  const elegir = (set: (v: string | null) => void, nivel: number) => (v: string | null) => {
    set(v === "__todos" ? null : v);
    if (nivel <= 1) setColor(null);
    if (nivel <= 2) setEspesor(null);
    if (nivel <= 3) setMedida(null);
    setElegidas(null);
  };

  if (conHistorial.length === 0) {
    return (
      <p className="text-muted-foreground rounded-xl border border-dashed px-6 py-12 text-center text-sm">
        Todavía no hay costos para graficar: aparecen al costear las compras.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Campo grupo label="Ver">
          <Opciones
            valores={[modo]}
            onToggle={(v) => setModo(v as Modo)}
            opciones={[
              { valor: "plancha", label: "Costo y precio" },
              { valor: "comparar", label: "Comparar costos" },
              { valor: "margen", label: "Margen" },
            ]}
          />
        </Campo>
        {modo === "comparar" && (
          <Campo grupo label="Costo">
            <Opciones valores={[unidad]} onToggle={(v) => setUnidad(v as Unidad)} opciones={Object.entries(UNIDADES).map(([valor, label]) => ({ valor, label }))} />
          </Campo>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Filtro etiqueta="Material" valor={material} opciones={materiales} alCambiar={elegir(setMaterial, 0)} />
        <Filtro etiqueta="Color" valor={color} opciones={colores} alCambiar={elegir(setColor, 1)} todos />
        <Filtro etiqueta="Espesor" valor={espesor} opciones={espesores} alCambiar={elegir(setEspesor, 2)} todos texto={(e) => espesorTexto(Number(e))} />
        <Filtro etiqueta="Medida" valor={medida} opciones={medidas} alCambiar={elegir(setMedida, 3)} todos />
      </div>

      {modo !== "plancha" && candidatas.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-muted-foreground text-xs">
            Planchas en el gráfico (hasta {MAX_SERIES}). {candidatas.length > MAX_SERIES && "Afina los filtros para ver otras."}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {candidatas.map((f) => {
              const activa = marcadas.includes(f.codigo);
              const lleno = !activa && marcadas.length >= MAX_SERIES;
              return (
                <button
                  key={f.codigo}
                  type="button"
                  aria-pressed={activa}
                  disabled={lleno}
                  onClick={() => setElegidas(activa ? marcadas.filter((c) => c !== f.codigo) : [...marcadas, f.codigo])}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs transition-colors disabled:opacity-40",
                    activa ? "border-primary/50 bg-primary/[0.04]" : "hover:border-primary/40",
                  )}
                >
                  {activa && <span aria-hidden className={cn("size-2.5 rounded-[3px]", estiloDe(f.codigo).muestra)} />}
                  <span className="font-mono">{f.codigo}</span>
                  <span className="text-muted-foreground">
                    {f.color} {espesorTexto(f.espesorMm)} {f.medida}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {modo === "plancha" && plancha && (
        <p className="text-sm">
          <span className="text-muted-foreground mr-2 font-mono text-xs">{plancha.codigo}</span>
          {plancha.material} · {plancha.titulo}
          {candidatas.length > 1 && <span className="text-muted-foreground text-xs"> · elige color, espesor y medida para ver otra</span>}
        </p>
      )}

      {datos.length === 0 ? (
        <p className="text-muted-foreground rounded-xl border border-dashed px-6 py-10 text-center text-sm">
          {modo === "comparar" && unidad === "kg" ? "Estas planchas no tienen kilos en sus compras." : "Sin datos para estos filtros."}
        </p>
      ) : (
        <Lineas datos={datos} lineas={lineas} formato={formato} />
      )}
      <p className="text-muted-foreground text-xs">
        Cada valor rige desde su fecha hasta el siguiente. El precio se registra desde que se aplica en esta pantalla; antes solo se conoce el de hoy.
        {modo !== "comparar" && " El 2do costo usa la tasa de gastos de operar que valía en cada mes."}
      </p>
    </div>
  );
}

function Filtro({
  etiqueta,
  valor,
  opciones,
  alCambiar,
  todos,
  texto = (v) => v,
}: {
  etiqueta: string;
  valor: string | null;
  opciones: string[];
  alCambiar: (v: string | null) => void;
  todos?: boolean;
  texto?: (v: string) => string;
}) {
  return (
    <Campo grupo label={etiqueta}>
      <Select value={valor ?? "__todos"} onValueChange={(v) => alCambiar(v as string)}>
        <SelectTrigger aria-label={etiqueta} className="w-full">
          <SelectValue>{valor ? texto(valor) : "Todos"}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {todos && <SelectItem value="__todos">Todos</SelectItem>}
          {opciones.map((o) => (
            <SelectItem key={o} value={o}>
              {texto(o)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Campo>
  );
}

interface LineaDef {
  clave: string;
  nombre: string;
  color: string;
  trazo: string | undefined;
  muestra: string;
}

/** Líneas escalonadas en un solo eje, con leyenda arriba, tooltip y la tabla de los mismos números. */
function Lineas({ datos: filas, lineas, formato }: { datos: Fila[]; lineas: LineaDef[]; formato: (n: number) => string }) {
  const alto = 300;
  // El eje X es de tiempo de verdad: dos compras separadas por meses quedan lejos.
  const datos: (Fila & { t: number })[] = filas.map((d) => ({ ...d, t: Date.parse(`${d.fecha}T12:00:00`) }));
  const fecha = (t: number) => new Date(t).toISOString().slice(0, 10);
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {lineas.map((l) => (
          <li key={l.clave} className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <svg aria-hidden width="18" height="6">
              <line x1="0" y1="3" x2="18" y2="3" stroke={l.color} strokeWidth="2" strokeDasharray={l.trazo} />
            </svg>
            {l.nombre}
          </li>
        ))}
      </ul>
      <div style={{ height: alto }} aria-hidden>
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: alto }}>
          <LineChart data={datos} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(t: number) => diaMesTexto(fecha(t))}
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
              minTickGap={24}
            />
            <YAxis
              tickFormatter={(n: number) => formato(n).replace(/\.00$/, "")}
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              tickLine={false}
              axisLine={false}
              width={72}
              domain={["auto", "auto"]}
            />
            <Tooltip
              cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }}
              contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: "var(--muted-foreground)" }}
              itemStyle={{ color: "var(--foreground)" }}
              labelFormatter={(t) => diaMesTexto(fecha(Number(t)), true)}
              formatter={(v, nombre) => [typeof v === "number" ? formato(v) : "—", String(nombre)]}
            />
            {lineas.map((l) => (
              <Line
                key={l.clave}
                dataKey={l.clave}
                name={l.nombre}
                type="stepAfter"
                stroke={l.color}
                strokeWidth={2}
                strokeDasharray={l.trazo}
                dot={false}
                activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--card)", strokeDasharray: "0" }}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <details className="text-sm">
        <summary className="text-muted-foreground cursor-pointer text-xs">Ver los datos</summary>
        <div className="mt-2 overflow-x-auto rounded-xl border">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-muted-foreground text-left">
              <tr>
                <th className="px-3 py-1.5 font-medium">Fecha</th>
                {lineas.map((l) => (
                  <th key={l.clave} className="px-3 py-1.5 text-right font-medium">
                    {l.nombre}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {datos.map((d) => (
                <tr key={d.fecha} className="border-t">
                  <td className="px-3 py-1.5">{diaMesTexto(d.fecha, true)}</td>
                  {lineas.map((l) => (
                    <td key={l.clave} className="tnum px-3 py-1.5 text-right">
                      {typeof d[l.clave] === "number" ? formato(d[l.clave] as number) : "—"}
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
