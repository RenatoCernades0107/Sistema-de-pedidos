import { filaDe } from "@/lib/cortes/calcular";
import type { Cobro } from "@/lib/cortes/cobro";
import type { CorteManual } from "@/lib/cortes/metros";
import type { Panel } from "@/lib/cortes/optimizador";
import { cn } from "@/lib/utils";

/** Lo que hace falta de una plancha para dibujarla: sirve la calculada y la guardada. */
export interface PlanchaDibujable {
  ancho: number;
  alto: number;
  paneles: Panel[];
  cobro: Cobro;
}

const n = (x: number) => String(+x.toFixed(1));

/**
 * Una plancha con sus piezas acomodadas, a escala.
 *
 * Cada pieza lleva el número de su fila en el pedido (la 1 es la primera medida
 * que se escribió) y, si cabe, sus medidas. Lo que sobra dentro de lo cobrado va
 * en gris; lo que queda fuera —el resto de la plancha, que vuelve al almacén—,
 * en verde y con su medida. La línea discontinua es el primer corte: separa el
 * pedazo que se cobra.
 *
 * En un corte manual van además los cortes de cutter: líneas rojas con un
 * círculo que dice en qué orden se hacen (ver `metros.ts`).
 *
 * El color nunca va solo: cada zona tiene su texto.
 */
export function PlanoCorte({
  plancha: p,
  titulo,
  className,
  compacto = false,
  cortes,
}: {
  plancha: PlanchaDibujable;
  /** Los cortes de cutter, en orden. Solo en corte manual. */
  cortes?: CorteManual[];
  /** Para lectores de pantalla y para el `<title>` del dibujo. */
  titulo: string;
  className?: string;
  /** Sin textos dentro: para miniaturas. */
  compacto?: boolean;
}) {
  // Las planchas se dibujan apaisadas: se leen mejor y ocupan menos alto.
  const girar = p.alto > p.ancho;
  const W = girar ? p.alto : p.ancho;
  const H = girar ? p.ancho : p.alto;
  const caja = (x: Panel) =>
    girar
      ? { x: x.y1, y: x.x1, w: x.y2 - x.y1, h: x.x2 - x.x1 }
      : { x: x.x1, y: x.y1, w: x.x2 - x.x1, h: x.y2 - x.y1 };

  // El texto se mide en unidades del dibujo: que una letra mida lo mismo en una
  // plancha de 122 que en una de 305.
  const letra = Math.max(W, H) / 34;
  const trazo = Math.max(W, H) / 400;
  const fraccion = p.cobro.factor < 1;
  const conCortes = !!cortes?.length;
  const punto = (x: number, y: number) => (girar ? { x: y, y: x } : { x, y });
  const marcas = conCortes && !compacto ? marcasDeCortes(cortes!, letra * 1.25) : [];

  return (
    <svg
      viewBox={`${-trazo} ${-trazo} ${W + 2 * trazo} ${H + 2 * trazo}`}
      role="img"
      aria-label={titulo}
      className={cn("block h-auto w-full", className)}
    >
      <title>{titulo}</title>
      <rect x={0} y={0} width={W} height={H} className="fill-background stroke-foreground/40" strokeWidth={trazo} />

      {p.paneles.map((panel, i) => {
        const { x, y, w, h } = caja(panel);
        const medida = `${n(panel.x2 - panel.x1)}×${n(panel.y2 - panel.y1)}`;

        if (!panel.libre) {
          const cabeNumero = w > letra * 1.6 && h > letra * 1.4;
          const cabeMedida = w > letra * 5.5 && h > letra * 2.8;
          return (
            <g key={i}>
              <rect
                x={x}
                y={y}
                width={w}
                height={h}
                className="fill-primary/15 stroke-primary/70"
                strokeWidth={trazo}
              />
              {!compacto && cabeNumero && (
                <text
                  x={x + w / 2}
                  y={y + h / 2 - (cabeMedida ? letra * 0.35 : 0)}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={letra * 1.15}
                  className="fill-foreground font-semibold"
                >
                  {filaDe(panel.piezaId ?? "")}
                </text>
              )}
              {!compacto && cabeMedida && (
                <text
                  x={x + w / 2}
                  y={y + h / 2 + letra * 0.95}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={letra * 0.8}
                  className="fill-muted-foreground"
                >
                  {medida}
                </text>
              )}
            </g>
          );
        }

        const cabeTexto = w > letra * 7 && h > letra * 2.4;
        return (
          <g key={i}>
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              className={panel.sobrante ? "fill-st-entregado-soft stroke-st-entregado/50" : "fill-muted stroke-border"}
              strokeWidth={trazo / 2}
            />
            {!compacto && panel.sobrante && cabeTexto && (
              <text
                x={x + w / 2}
                y={y + h / 2}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={letra * 0.9}
                className="fill-st-entregado font-medium"
              >
                Sobrante {medida}
              </text>
            )}
          </g>
        );
      })}

      {conCortes && (
        <g className="stroke-destructive" strokeWidth={trazo * 1.8} strokeLinecap="round">
          {cortes!.map((c) => {
            const a = punto(c.x1, c.y1);
            const b = punto(c.x2, c.y2);
            return <line key={c.n} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
          })}
        </g>
      )}
      {marcas.map((m) => {
        const { x, y } = punto(m.x, m.y);
        return (
          <g key={m.n}>
            <circle cx={x} cy={y} r={letra * 0.62} className="fill-destructive" />
            <text
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={letra * (m.n > 99 ? 0.5 : m.n > 9 ? 0.62 : 0.75)}
              className="font-semibold"
              fill="white"
            >
              {m.n}
            </text>
          </g>
        );
      })}

      {fraccion && !conCortes && (
        <rect
          x={0}
          y={0}
          width={girar ? p.cobro.alto : p.cobro.ancho}
          height={girar ? p.cobro.ancho : p.cobro.alto}
          fill="none"
          className="stroke-foreground"
          strokeWidth={trazo * 1.6}
          strokeDasharray={`${trazo * 6} ${trazo * 4}`}
        />
      )}
    </svg>
  );
}

/**
 * Dónde va el número de cada corte: en el medio de su línea y, si ahí ya hay
 * otro (dos cortes que se cruzan), corrido a lo largo de la línea.
 */
function marcasDeCortes(cortes: CorteManual[], separacion: number) {
  const puestas: { n: number; x: number; y: number }[] = [];
  const libre = (x: number, y: number) => puestas.every((m) => Math.hypot(m.x - x, m.y - y) >= separacion);
  for (const c of cortes) {
    const mx = (c.x1 + c.x2) / 2;
    const my = (c.y1 + c.y2) / 2;
    const dx = (c.x2 - c.x1) / (c.largo || 1);
    const dy = (c.y2 - c.y1) / (c.largo || 1);
    let lugar = { x: mx, y: my };
    for (const k of [0, 1, -1, 2, -2, 3, -3]) {
      const d = k * separacion;
      // Sin salirse de la línea.
      if (Math.abs(d) > c.largo / 2) continue;
      if (libre(mx + dx * d, my + dy * d)) {
        lugar = { x: mx + dx * d, y: my + dy * d };
        break;
      }
    }
    puestas.push({ n: c.n, ...lugar });
  }
  return puestas;
}

/** Qué significa cada zona del plano, en palabras. */
export function LeyendaPlano({
  conSobrante,
  conCortes = false,
  className,
}: {
  conSobrante: boolean;
  /** Corte manual: explica las líneas rojas. */
  conCortes?: boolean;
  className?: string;
}) {
  return (
    <ul className={cn("text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs", className)}>
      <li className="flex items-center gap-1.5">
        <span className="bg-primary/15 border-primary/70 size-3 rounded-[3px] border" aria-hidden />
        Pieza (el número es su medida en la lista)
      </li>
      <li className="flex items-center gap-1.5">
        <span className="bg-muted size-3 rounded-[3px] border" aria-hidden />
        Retazo
      </li>
      {conSobrante && (
        <>
          <li className="flex items-center gap-1.5">
            <span className="bg-st-entregado-soft border-st-entregado/50 size-3 rounded-[3px] border" aria-hidden />
            Sobrante que vuelve al almacén
          </li>
          {!conCortes && (
            <li className="flex items-center gap-1.5">
              <span className="border-foreground w-4 border-t-2 border-dashed" aria-hidden />
              Primer corte: lo que se cobra
            </li>
          )}
        </>
      )}
      {conCortes && (
        <li className="flex items-center gap-1.5">
          <span className="relative flex w-5 items-center" aria-hidden>
            <span className="border-destructive w-5 border-t-2" />
            <span className="bg-destructive absolute left-1/2 size-2.5 -translate-x-1/2 rounded-full" />
          </span>
          Corte con cutter (el número es el orden)
        </li>
      )}
    </ul>
  );
}
