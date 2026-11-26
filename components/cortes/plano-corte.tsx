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
  cotas = false,
  cortes,
}: {
  plancha: PlanchaDibujable;
  /**
   * Las medidas en los lados, como en un plano: un ancho y un alto por pieza y
   * por retazo, por dentro y pegados al borde, y los de la plancha por fuera.
   * Para la hoja de corte impresa.
   */
  cotas?: boolean;
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
  const conCotas = cotas && !compacto;
  // Las cotas de la plancha van por fuera, arriba y a la izquierda: el dibujo crece hacia allá.
  const margen = conCotas ? letra * 1.8 : 0;
  const cotaPieza = letra * 0.75;
  const cotaRetazo = letra * 0.65;

  return (
    <svg
      viewBox={`${-trazo - margen} ${-trazo - margen} ${W + 2 * trazo + margen} ${H + 2 * trazo + margen}`}
      role="img"
      aria-label={titulo}
      className={cn("block h-auto w-full", className)}
    >
      <title>{titulo}</title>
      <rect x={0} y={0} width={W} height={H} className="fill-background stroke-foreground/40" strokeWidth={trazo} />
      {conCotas && <CotasPlancha W={W} H={H} margen={margen} fs={cotaPieza} trazo={trazo} />}

      {p.paneles.map((panel, i) => {
        const { x, y, w, h } = caja(panel);
        const medida = `${n(panel.x2 - panel.x1)}×${n(panel.y2 - panel.y1)}`;

        if (!panel.libre && conCotas) {
          // Con cotas, la medida ya está en los lados: al centro solo el número.
          // En una pieza baja (una tira de 14) el número y el ancho no entran uno
          // encima del otro: el número se corre a la izquierda y el ancho queda al medio.
          const pad = cotaPieza * 0.35;
          const fsNumero = letra * 1.15;
          const baja = h < cotaPieza + fsNumero + pad * 4;
          const cabeNumero = w > letra * 1.6 && h > fsNumero * 1.1;
          const xNumero = baja ? x + pad * 2 + cotaPieza + anchoTexto(filaDe(panel.piezaId ?? ""), fsNumero) / 2 + pad : x + w / 2;
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
              {cabeNumero && (
                <text
                  x={xNumero}
                  y={baja ? y + h / 2 : y + h / 2 + pad}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={fsNumero}
                  className="fill-foreground font-semibold"
                >
                  {filaDe(panel.piezaId ?? "")}
                </text>
              )}
              <Cotas
                x={x}
                y={y}
                w={w}
                h={h}
                fs={cotaPieza}
                anchoAlMedio={baja}
                className="fill-foreground/80"
              />
            </g>
          );
        }

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
                {conCotas ? "Sobrante" : `Sobrante ${medida}`}
              </text>
            )}
            {conCotas && (
              <Cotas
                x={x}
                y={y}
                w={w}
                h={h}
                fs={cotaRetazo}
                className={panel.sobrante ? "fill-st-entregado" : "fill-muted-foreground"}
              />
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

/** Lo que mide un texto de una línea, a ojo: sirve para saber si entra. */
const anchoTexto = (t: string | number, fs: number) => String(t).length * 0.6 * fs;

/**
 * El ancho y el alto de un rectángulo, por dentro y pegados al borde: el ancho
 * arriba y el alto girado a la izquierda. Un lado cuyo texto no entra se queda
 * sin medida antes que salirse del rectángulo.
 */
function Cotas({
  x,
  y,
  w,
  h,
  fs,
  className,
  anchoAlMedio = false,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  fs: number;
  className: string;
  /** El ancho a media altura y no arriba: para las piezas bajas. */
  anchoAlMedio?: boolean;
}) {
  const pad = fs * 0.35;
  const ancho = n(w);
  const alto = n(h);
  // Lo que ocupa la cota vertical en el borde izquierdo: la horizontal no la pisa.
  const franjaVertical = pad * 2 + fs;
  const cabeAlto = anchoTexto(alto, fs) + pad * 2 < h && franjaVertical < w;
  const cabeAncho = anchoTexto(ancho, fs) + pad * 2 + (cabeAlto ? franjaVertical * 2 : 0) < w && fs + pad * 2 < h;
  const xv = x + pad + fs / 2;
  const yv = y + h / 2;
  return (
    <g className={cn("tnum", className)} fontSize={fs}>
      {cabeAncho && (
        <text
          x={x + w / 2}
          y={anchoAlMedio ? y + h / 2 : y + pad + fs / 2}
          textAnchor="middle"
          dominantBaseline="central"
        >
          {ancho}
        </text>
      )}
      {cabeAlto && (
        <text x={xv} y={yv} textAnchor="middle" dominantBaseline="central" transform={`rotate(-90 ${xv} ${yv})`}>
          {alto}
        </text>
      )}
    </g>
  );
}

/**
 * Las medidas de la plancha entera, por fuera y como en un plano: una línea con
 * topes en los extremos, cortada al medio para la medida.
 */
function CotasPlancha({ W, H, margen, fs, trazo }: { W: number; H: number; margen: number; fs: number; trazo: number }) {
  const linea = -margen * 0.45;
  const tope = margen * 0.22;
  const pad = fs * 0.4;
  const lado = (largo: number) => {
    const texto = n(largo);
    const hueco = anchoTexto(texto, fs) / 2 + pad;
    return { texto, hueco };
  };
  const a = lado(W);
  const b = lado(H);
  return (
    <g className="stroke-foreground/60 fill-foreground" strokeWidth={trazo * 0.8}>
      {/* Arriba: el largo. */}
      <line x1={0} y1={linea} x2={W / 2 - a.hueco} y2={linea} />
      <line x1={W / 2 + a.hueco} y1={linea} x2={W} y2={linea} />
      <line x1={0} y1={linea - tope} x2={0} y2={linea + tope} />
      <line x1={W} y1={linea - tope} x2={W} y2={linea + tope} />
      <text x={W / 2} y={linea} textAnchor="middle" dominantBaseline="central" fontSize={fs} stroke="none" className="tnum font-medium">
        {a.texto}
      </text>
      {/* A la izquierda: el ancho. */}
      <line x1={linea} y1={0} x2={linea} y2={H / 2 - b.hueco} />
      <line x1={linea} y1={H / 2 + b.hueco} x2={linea} y2={H} />
      <line x1={linea - tope} y1={0} x2={linea + tope} y2={0} />
      <line x1={linea - tope} y1={H} x2={linea + tope} y2={H} />
      <text
        x={linea}
        y={H / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={fs}
        stroke="none"
        transform={`rotate(-90 ${linea} ${H / 2})`}
        className="tnum font-medium"
      >
        {b.texto}
      </text>
    </g>
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
