/**
 * Un corte como archivo DXF, para abrirlo en RDWorks (la máquina láser Ruida) y
 * cortarlo tal cual.
 *
 * Lo que RDWorks lee bien, y por eso el archivo es así:
 *
 *   - DXF R12 en ASCII, en milímetros (`$INSUNITS = 4`). Si el archivo dijera
 *     pulgadas, las piezas entrarían 25.4 veces más chicas.
 *   - Solo entidades `LINE`. Las polilíneas cerradas y los splines son lo que peor
 *     importa; una línea recta no tiene cómo salir mal.
 *   - Una capa por color, con el color también en cada línea: RDWorks agrupa por
 *     color y a cada uno se le pone su velocidad y potencia.
 *   - Sin textos: los números de pieza van dibujados con trazos.
 *   - Las piezas salen a su medida: el contorno se corre medio kerf hacia afuera
 *     (ver `compensacion`).
 *
 * Las capas:
 *
 *   GRABADO       verde   el número de la pieza (su fila en el pedido), para
 *                         marcarlo con poca potencia antes de cortar
 *   CORTE         rojo    el contorno de las piezas. Un borde que dos piezas
 *                         comparten se corta una sola vez, y lo que cae sobre el
 *                         canto de la plancha no se corta: ese borde ya existe
 *   PRIMER_CORTE  azul    separa el pedazo que se cobra del sobrante que vuelve
 *                         al almacén. Va al final, para que la plancha no se
 *                         mueva antes de terminar
 *   PLANCHA       gris    el contorno de la plancha. Es solo referencia: no se
 *                         corta
 *
 * Si el corte tiene varias planchas, van todas en el mismo archivo, una al lado
 * de la otra y separadas 50 mm, en el mismo orden que la hoja de corte.
 *
 * Puro: devuelve el texto del archivo y no sabe de navegador ni de servidor.
 */

import { filaDe } from "./calcular";
import type { Cobro } from "./cobro";
import type { Panel } from "./optimizador";

/** Lo que hace falta de una plancha: sirve la del corte y la de un producto terminado. */
export interface PlanchaParaDxf {
  /** cm */
  ancho: number;
  /** cm */
  alto: number;
  paneles: Panel[];
  cobro: Pick<Cobro, "factor" | "ancho" | "alto">;
}

export const CAPAS_DXF = {
  GRABADO: 3,
  CORTE: 1,
  PRIMER_CORTE: 5,
  PLANCHA: 8,
} as const;

export type CapaDxf = keyof typeof CAPAS_DXF;

/** Separación entre planchas, en mm. */
export const SEPARACION_MM = 50;

/** Un segmento en micras: con enteros, dos bordes iguales son iguales de verdad. */
interface Linea {
  capa: CapaDxf;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const UM_POR_CM = 10_000;
const um = (cm: number) => Math.round(cm * UM_POR_CM);
/** Dos bordes a menos de una centésima de mm son el mismo borde. */
const recta = (u: number) => Math.round(u / 10) * 10;

type Tramo = [number, number];

/** Junta los tramos que se solapan o se tocan. */
function unir(tramos: Tramo[]): Tramo[] {
  const orden = tramos.filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
  const salida: Tramo[] = [];
  for (const [a, b] of orden) {
    const ultimo = salida.at(-1);
    if (ultimo && a <= ultimo[1]) ultimo[1] = Math.max(ultimo[1], b);
    else salida.push([a, b]);
  }
  return salida;
}

/** Lo que queda de unos tramos tras quitarles otros. Los dos van unidos y ordenados. */
function restar(tramos: Tramo[], quitar: Tramo[]): Tramo[] {
  let salida = tramos;
  for (const [qa, qb] of quitar) {
    salida = salida.flatMap(([a, b]): Tramo[] => {
      if (qb <= a || qa >= b) return [[a, b]];
      const resto: Tramo[] = [];
      if (qa > a) resto.push([a, qa]);
      if (qb < b) resto.push([qb, b]);
      return resto;
    });
  }
  return salida;
}

/** Tramos agrupados por la recta en la que caen: horizontales por su y, verticales por su x. */
class Rectas {
  readonly h = new Map<number, Tramo[]>();
  readonly v = new Map<number, Tramo[]>();

  horizontal(y: number, x1: number, x2: number) {
    agregar(this.h, recta(y), [recta(Math.min(x1, x2)), recta(Math.max(x1, x2))]);
  }

  vertical(x: number, y1: number, y2: number) {
    agregar(this.v, recta(x), [recta(Math.min(y1, y2)), recta(Math.max(y1, y2))]);
  }

  rectangulo(x1: number, y1: number, x2: number, y2: number) {
    this.horizontal(y1, x1, x2);
    this.horizontal(y2, x1, x2);
    this.vertical(x1, y1, y2);
    this.vertical(x2, y1, y2);
  }
}

function agregar(mapa: Map<number, Tramo[]>, clave: number, tramo: Tramo) {
  const lista = mapa.get(clave);
  if (lista) lista.push(tramo);
  else mapa.set(clave, [tramo]);
}

interface Caja {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Cuánto se agranda cada contorno para que la pieza salga a su medida.
 *
 * El láser se come el grosor de su haz (el kerf) centrado en la línea: cortando
 * justo en el borde, la pieza perdería medio kerf por lado. El optimizador ya
 * dejó un kerf de separación entre piezas, así que corriendo cada contorno medio
 * kerf hacia afuera la línea cae en medio del hueco y dos vecinas comparten un
 * solo trazo.
 *
 * Nunca más de la mitad del hueco más chico entre dos piezas que se enfrentan: si
 * el corte se calculó con otro kerf, o sin kerf, los contornos no se pisan. Con
 * piezas pegadas, cero.
 */
export function compensacion(piezas: Caja[], kerf: number): number {
  let c = Math.max(0, kerf / 2);
  if (c === 0) return 0;
  for (let i = 0; i < piezas.length && c > 0; i++) {
    const a = piezas[i];
    for (let j = i + 1; j < piezas.length; j++) {
      const b = piezas[j];
      let hueco: number | null = null;
      if (Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1) > 0) hueco = Math.max(b.y1 - a.y2, a.y1 - b.y2);
      else if (Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1) > 0) hueco = Math.max(b.x1 - a.x2, a.x1 - b.x2);
      if (hueco !== null) c = Math.min(c, Math.max(0, hueco) / 2);
      if (c <= 0) return 0;
    }
  }
  return Math.round(c);
}

/**
 * Las líneas de una plancha, en micras y con el origen arriba a la izquierda,
 * como en el optimizador. Se separan del DXF para poder probarlas.
 *
 * `kerfCm` es el grosor del haz: ver `compensacion`.
 */
export function lineasDePlancha(p: PlanchaParaDxf, kerfCm = 0): Linea[] {
  const W = um(p.ancho);
  const H = um(p.alto);
  const lineas: Linea[] = [];

  // El primer corte: los lados del pedazo cobrado que no caen sobre el canto.
  const primero = new Rectas();
  if (p.cobro.factor < 1) {
    const cw = Math.min(um(p.cobro.ancho), W);
    const ch = Math.min(um(p.cobro.alto), H);
    if (cw < W) primero.vertical(cw, 0, ch);
    if (ch < H) primero.horizontal(ch, 0, cw);
  }

  const piezas = p.paneles
    .filter((x) => !x.libre)
    .map((x) => ({ fila: filaDe(x.piezaId ?? ""), x1: um(x.x1), y1: um(x.y1), x2: um(x.x2), y2: um(x.y2) }));
  const c = compensacion(piezas, um(kerfCm));
  const corte = new Rectas();
  for (const x of piezas) {
    // Sin salirse de la plancha: lo que cae sobre el canto no se corta.
    corte.rectangulo(Math.max(0, x.x1 - c), Math.max(0, x.y1 - c), Math.min(W, x.x2 + c), Math.min(H, x.y2 + c));
  }

  // Grabado primero: con la pieza todavía sujeta a la plancha.
  for (const x of piezas) {
    if (x.fila > 0) lineas.push(...numeroEnPieza(x.fila, x.x1, x.y1, x.x2, x.y2));
  }

  const emitir = (rectas: Rectas, capa: CapaDxf, quitar?: Rectas) => {
    for (const [y, tramos] of [...rectas.h].sort((a, b) => a[0] - b[0])) {
      if (capa === "CORTE" && (y <= 0 || y >= H)) continue;
      for (const [a, b] of restar(unir(tramos), unir(quitar?.h.get(y) ?? []))) {
        lineas.push({ capa, x1: a, y1: y, x2: b, y2: y });
      }
    }
    for (const [x, tramos] of [...rectas.v].sort((a, b) => a[0] - b[0])) {
      if (capa === "CORTE" && (x <= 0 || x >= W)) continue;
      for (const [a, b] of restar(unir(tramos), unir(quitar?.v.get(x) ?? []))) {
        lineas.push({ capa, x1: x, y1: a, x2: x, y2: b });
      }
    }
  };

  // Lo que el primer corte ya hace, no se corta dos veces.
  emitir(corte, "CORTE", primero);
  emitir(primero, "PRIMER_CORTE");

  const borde = new Rectas();
  borde.rectangulo(0, 0, W, H);
  emitir(borde, "PLANCHA");

  return lineas;
}

/*
 * Los dígitos en siete segmentos: con líneas rectas, como todo lo demás.
 *
 *    ─a─
 *   f   b
 *    ─g─
 *   e   c
 *    ─d─
 */
const SEGMENTOS: Record<string, string> = {
  "0": "abcdef",
  "1": "bc",
  "2": "abged",
  "3": "abgcd",
  "4": "fgbc",
  "5": "afgcd",
  "6": "afgedc",
  "7": "abc",
  "8": "abcdefg",
  "9": "abcdfg",
};

/** Ancho de un dígito y espacio entre dígitos, respecto de su alto. */
const ANCHO_DIGITO = 0.55;
const ESPACIO_DIGITO = 0.3;
/** El número no pasa de 10 mm de alto ni baja de 3 mm: más chico no se lee. */
const ALTO_MAX = 10 * 1000;
const ALTO_MIN = 3 * 1000;

/** El número de una pieza, centrado en ella. Nada si no cabe. */
function numeroEnPieza(fila: number, x1: number, y1: number, x2: number, y2: number): Linea[] {
  const texto = String(fila);
  const w = x2 - x1;
  const h = y2 - y1;
  const anchoTexto = (alto: number) => alto * (texto.length * ANCHO_DIGITO + (texto.length - 1) * ESPACIO_DIGITO);

  let alto = Math.min(ALTO_MAX, 0.3 * Math.min(w, h));
  // Que el número ocupe a lo sumo el 60 % del ancho de la pieza.
  alto = Math.min(alto, (0.6 * w) / (anchoTexto(1) || 1));
  if (alto < ALTO_MIN) return [];
  alto = Math.round(alto);

  const dw = Math.round(alto * ANCHO_DIGITO);
  const paso = dw + Math.round(alto * ESPACIO_DIGITO);
  const x0 = Math.round(x1 + (w - anchoTexto(alto)) / 2);
  const top = Math.round(y1 + (h - alto) / 2);
  const mid = top + Math.round(alto / 2);
  const bot = top + alto;

  const lineas: Linea[] = [];
  [...texto].forEach((d, i) => {
    const l = x0 + i * paso;
    const r = l + dw;
    const seg: Record<string, [number, number, number, number]> = {
      a: [l, top, r, top],
      b: [r, top, r, mid],
      c: [r, mid, r, bot],
      d: [l, bot, r, bot],
      e: [l, mid, l, bot],
      f: [l, top, l, mid],
      g: [l, mid, r, mid],
    };
    for (const s of SEGMENTOS[d] ?? "") {
      const [ax, ay, bx, by] = seg[s];
      lineas.push({ capa: "GRABADO", x1: ax, y1: ay, x2: bx, y2: by });
    }
  });
  return lineas;
}

/** Micras a mm, sin ceros de más: "1220", "12.5", "0.001". */
const mm = (u: number) => String(+(u / 1000).toFixed(3));

/**
 * El archivo DXF de unas planchas, listo para importarlo en RDWorks. En mm, con
 * la y hacia arriba como en todo CAD: la esquina de arriba a la izquierda del
 * plano en pantalla sigue arriba a la izquierda en RDWorks.
 */
export function exportarDxf(planchas: PlanchaParaDxf[], { kerfCm = 0 }: { kerfCm?: number } = {}): string {
  const salida: (string | number)[] = [];
  const par = (codigo: number, valor: string | number) => salida.push(codigo, valor);

  let ox = 0;
  const entidades: Linea[] = [];
  let ancho = 0;
  let alto = 0;
  planchas.forEach((p, i) => {
    if (i > 0) ox += SEPARACION_MM * 1000;
    const H = um(p.alto);
    for (const l of lineasDePlancha(p, kerfCm)) {
      // De arriba-abajo (optimizador) a abajo-arriba (DXF), y corrida a su sitio.
      entidades.push({ capa: l.capa, x1: ox + l.x1, y1: H - l.y1, x2: ox + l.x2, y2: H - l.y2 });
    }
    ox += um(p.ancho);
    ancho = ox;
    alto = Math.max(alto, H);
  });

  par(999, "Sistema de pedidos - corte laser (mm)");

  par(0, "SECTION");
  par(2, "HEADER");
  par(9, "$ACADVER");
  par(1, "AC1009");
  par(9, "$INSUNITS");
  par(70, 4);
  par(9, "$MEASUREMENT");
  par(70, 1);
  par(9, "$EXTMIN");
  par(10, 0);
  par(20, 0);
  par(30, 0);
  par(9, "$EXTMAX");
  par(10, mm(ancho));
  par(20, mm(alto));
  par(30, 0);
  par(0, "ENDSEC");

  par(0, "SECTION");
  par(2, "TABLES");
  par(0, "TABLE");
  par(2, "LTYPE");
  par(70, 1);
  par(0, "LTYPE");
  par(2, "CONTINUOUS");
  par(70, 0);
  par(3, "Solid line");
  par(72, 65);
  par(73, 0);
  par(40, 0);
  par(0, "ENDTAB");
  par(0, "TABLE");
  par(2, "LAYER");
  par(70, Object.keys(CAPAS_DXF).length);
  for (const [nombre, color] of Object.entries(CAPAS_DXF)) {
    par(0, "LAYER");
    par(2, nombre);
    par(70, 0);
    par(62, color);
    par(6, "CONTINUOUS");
  }
  par(0, "ENDTAB");
  par(0, "ENDSEC");

  par(0, "SECTION");
  par(2, "ENTITIES");
  for (const l of entidades) {
    par(0, "LINE");
    par(8, l.capa);
    par(62, CAPAS_DXF[l.capa]);
    par(10, mm(l.x1));
    par(20, mm(l.y1));
    par(30, 0);
    par(11, mm(l.x2));
    par(21, mm(l.y2));
    par(31, 0);
  }
  par(0, "ENDSEC");
  par(0, "EOF");

  const lineas: string[] = [];
  for (let i = 0; i < salida.length; i += 2) lineas.push(String(salida[i]).padStart(3, " "), String(salida[i + 1]));
  return lineas.join("\r\n") + "\r\n";
}

/** "corte-p0012-acrilico-eco-cristal-3mm.dxf": solo ASCII, sin espacios. */
export function nombreArchivoDxf(partes: (string | number | null | undefined)[]): string {
  const slug = partes
    .filter((x) => x !== null && x !== undefined && String(x).trim() !== "")
    .join("-")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "corte"}.dxf`;
}
