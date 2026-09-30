import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { porcentaje } from "@/lib/formato";
import type { Pedido } from "@/lib/dominio";
import type { Fila, Periodo } from "@/lib/metricas";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/* Las piezas con las que se arma cada pestaña del dashboard. Sin estado y sin
   datos propios: reciben el número ya calculado por `lib/metricas.ts`. */

/** Lo que recibe cada pestaña: los pedidos, el período elegido y el hoy de Lima. */
export interface PropsPestana {
  pedidos: Pedido[];
  periodo: Periodo;
  hoy: string;
}

/** Una sección del dashboard: título que dice qué pregunta responde, y su contenido. */
export function Seccion({
  titulo,
  descripcion,
  children,
  className,
}: {
  titulo: string;
  descripcion?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{titulo}</CardTitle>
        {descripcion && <CardDescription>{descripcion}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function Vacio({ children = "Sin datos en este período." }: { children?: React.ReactNode }) {
  return <p className="text-muted-foreground py-6 text-center text-sm">{children}</p>;
}

/**
 * Cómo cambió una cifra contra el período anterior.
 *
 * `relativo` es un porcentaje de cambio (vendido +12 %); `puntos`, la diferencia
 * entre dos tasas (a tiempo 80 % → 85 % son +5 pts, no +6 %). El color dice si el
 * cambio es bueno o malo —por eso `subeEsBueno`— y siempre va con flecha y texto:
 * nunca solo color.
 */
export interface Delta {
  valor: number | null;
  tipo: "relativo" | "puntos";
  subeEsBueno?: boolean;
}

function DeltaTexto({ valor, tipo, subeEsBueno = true }: Delta) {
  if (valor === null || !Number.isFinite(valor)) {
    return <span className="text-muted-foreground">—</span>;
  }
  const plano = Math.abs(valor) < 0.005;
  const bueno = valor > 0 === subeEsBueno;
  const Icono = plano ? Minus : valor > 0 ? ArrowUpRight : ArrowDownRight;
  const cifra =
    tipo === "puntos"
      ? `${Math.round(Math.abs(valor) * 100)} pts`
      : porcentaje(Math.abs(valor));

  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 font-medium",
        plano ? "text-muted-foreground" : bueno ? "text-st-entregado" : "text-saldo-alerta",
      )}
    >
      <Icono className="size-3.5" aria-hidden />
      <span className="sr-only">{plano ? "Sin cambio" : valor > 0 ? "Subió" : "Bajó"}</span>
      {plano ? "0%" : cifra}
    </span>
  );
}

/** Una cifra clave: etiqueta, valor y, si aplica, contra qué se compara. */
export function Kpi({
  etiqueta,
  valor,
  delta,
  detalle,
  alerta,
}: {
  etiqueta: string;
  valor: string;
  delta?: Delta;
  /** Una línea de contexto: contra qué se compara, o qué parte está vencida. */
  detalle?: React.ReactNode;
  /** El valor mismo es una mala noticia (hay atrasados, hay deuda vencida). */
  alerta?: boolean;
}) {
  return (
    <Card size="sm" className="gap-1.5">
      <CardContent className="flex flex-col gap-1">
        <p className="text-muted-foreground text-xs font-medium">{etiqueta}</p>
        <p
          className={cn(
            "text-xl font-semibold tracking-tight sm:text-2xl",
            alerta && "text-saldo-alerta",
          )}
        >
          {valor}
        </p>
        {(delta || detalle) && (
          <p className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 text-xs">
            {delta && <DeltaTexto {...delta} />}
            {detalle && <span className="min-w-0">{detalle}</span>}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function FilaKpis({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6", className)}>
      {children}
    </div>
  );
}

const unDecimal = new Intl.NumberFormat("es-PE", { maximumFractionDigits: 1 });

/** 2.345 → "2.3 días" · 1 → "1 día" */
export const diasTexto = (n: number) => `${unDecimal.format(n)} ${n === 1 ? "día" : "días"}`;

/** Una barra de un ranking horizontal. */
export interface Barra {
  clave: string;
  etiqueta: React.ReactNode;
  valor: number;
  /** Lo que se escribe al final de la barra; por defecto, el valor formateado. */
  texto?: string;
  /** Una línea chica bajo la etiqueta: "12 pedidos". */
  detalle?: string;
  /** Destacar esta barra y apagar el resto (el cuello de botella, por ejemplo). */
  resaltar?: boolean;
}

/**
 * Un ranking de barras horizontales en HTML: se lee sin pasar el ratón porque cada
 * barra lleva su valor escrito, y no necesita librería. Un solo color para todas
 * —las categorías no tienen orden y el largo ya dice cuánto—, salvo que una se
 * resalte: entonces esa va en color y el resto en gris.
 */
export function Barras({
  filas,
  formato,
  max,
}: {
  filas: Barra[];
  formato: (n: number) => string;
  /** Contra qué se mide el largo. Por defecto, la barra más larga. */
  max?: number;
}) {
  if (!filas.length) return <Vacio />;
  const tope = max ?? Math.max(...filas.map((f) => f.valor), 0);
  const hayResaltada = filas.some((f) => f.resaltar);

  return (
    <ul className="flex flex-col gap-2.5">
      {filas.map((f) => (
        <li
          key={f.clave}
          className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_auto] items-center gap-x-3 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto]"
        >
          <div className="min-w-0">
            <p className="truncate text-sm">{f.etiqueta}</p>
            {f.detalle && <p className="text-muted-foreground truncate text-xs">{f.detalle}</p>}
          </div>
          <div className="h-3" aria-hidden>
            <div
              className={cn(
                "h-full rounded-r-[4px]",
                hayResaltada && !f.resaltar ? "bg-chart-tenue" : "bg-chart-1",
              )}
              style={{
                width: tope > 0 ? `${(f.valor / tope) * 100}%` : 0,
                // Un valor chico pero real no puede desaparecer.
                minWidth: f.valor > 0 ? 2 : 0,
              }}
            />
          </div>
          <span className="tnum text-sm font-medium">{f.texto ?? formato(f.valor)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Una proporción entre pocas partes (Lima / provincia, nuevos / recurrentes) como
 * una sola barra partida, con su leyenda. Cada parte lleva su número escrito.
 */
export function Reparto({
  partes,
  formato,
}: {
  partes: { clave: string; etiqueta: string; valor: number; detalle?: string }[];
  formato: (n: number) => string;
}) {
  const total = partes.reduce((t, p) => t + p.valor, 0);
  if (total <= 0) return <Vacio />;
  const colores = ["bg-chart-1", "bg-chart-2"];

  return (
    <div className="flex flex-col gap-3">
      {/* El hueco de 2 px entre partes es el que las separa, no un borde. */}
      <div className="flex h-3 gap-0.5" aria-hidden>
        {partes.map((p, i) =>
          p.valor > 0 ? (
            <div
              key={p.clave}
              className={cn(
                colores[i % colores.length],
                "first:rounded-l-[4px] last:rounded-r-[4px]",
              )}
              style={{ flexGrow: p.valor, flexBasis: 0, minWidth: 2 }}
            />
          ) : null,
        )}
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {partes.map((p, i) => (
          <li key={p.clave} className="flex items-start gap-2">
            <span
              aria-hidden
              className={cn("mt-1 size-2.5 shrink-0 rounded-[3px]", colores[i % colores.length])}
            />
            <div className="min-w-0">
              <p className="text-sm">
                {p.etiqueta}{" "}
                <span className="text-muted-foreground tnum">{porcentaje(p.valor / total)}</span>
              </p>
              <p className="text-muted-foreground tnum text-xs">
                {formato(p.valor)}
                {p.detalle && ` · ${p.detalle}`}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "1 pedido" · "3 pedidos" */
export const pedidosTexto = (n: number) => `${n} ${n === 1 ? "pedido" : "pedidos"}`;

/** Una fila de ranking como barra en soles, con los pedidos debajo. */
export const barraDeFila = (f: Fila): Barra => ({
  clave: f.clave,
  etiqueta: f.etiqueta,
  valor: f.monto,
  detalle: pedidosTexto(f.pedidos),
});
