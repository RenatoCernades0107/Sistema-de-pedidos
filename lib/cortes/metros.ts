/**
 * Los cortes de cutter de una plancha: cuáles, en qué orden y cuántos metros.
 *
 * El corte manual se hace con cutter: se marca la plancha y se quiebra. Al
 * quebrar, el pedazo se parte de canto a canto, así que cada marca recorre todo
 * el pedazo que se está partiendo —un corte de guillotina— y no solo el borde de
 * la pieza. Por eso no basta con sumar contornos: tres piezas en fila y un
 * sobrante debajo cuestan un corte largo de lado a lado y luego los cortos.
 *
 * Para un acomodo ya hecho, se busca la secuencia de guillotina con menos
 * metros: en cada pedazo se prueba cada línea que lo cruza entera sin pisar una
 * pieza, y se queda con la que deja menos metros entre ella y lo que falte de
 * cada lado (con memoria por pedazo). El acomodo no cambia: se eligió por
 * material, y aquí solo se decide cómo cortarlo.
 *
 * Los cortes salen en el orden de trabajo: primero el que separa lo que se cobra
 * del sobrante que vuelve al almacén, después el que parte el pedazo más
 * grande, y así hacia adentro, terminando un lado antes de pasar al otro.
 *
 * La misma secuencia cobra y se dibuja: el plano y el precio no pueden decir
 * cosas distintas. Puro, y sirve para un corte recién calculado o uno guardado.
 */

import type { Cobro } from "./cobro";
import type { Panel } from "./optimizador";

/** Un corte de cutter, en cm y con el origen arriba a la izquierda de la plancha. */
export interface CorteManual {
  /** Su lugar en el orden de trabajo, desde 1. */
  n: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** cm */
  largo: number;
}

export interface PlanchaParaCortes {
  ancho: number;
  alto: number;
  paneles: Panel[];
  cobro: Pick<Cobro, "factor" | "ancho" | "alto">;
}

export interface OpcionesCortesManuales {
  /** Lo que se come la herramienta (cm). Con cutter, cero. */
  kerf?: number;
  /** Borde de la plancha que no se aprovecha (cm por lado). */
  margen?: number;
}

interface Caja {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Una línea que cruza un pedazo: vertical en `x = pos` u horizontal en `y = pos`. */
interface Linea {
  eje: "v" | "h";
  pos: number;
}

type Segmento = Omit<CorteManual, "n">;

const EPS = 1e-6;
/** Con más piezas que esto en una plancha, la búsqueda óptima puede tardar. */
const MAX_PIEZAS_OPTIMO = 40;
/** Pedazos distintos que se recuerdan antes de rendirse y elegir a ojo. */
const MAX_PEDAZOS = 30_000;
const AGOTADO = Symbol("agotado");

const clave = (r: Caja) => [r.x1, r.y1, r.x2, r.y2].map((n) => Math.round(n * 1e4)).join(",");

const segmento = (x1: number, y1: number, x2: number, y2: number): Segmento => ({
  x1,
  y1,
  x2,
  y2,
  largo: Math.abs(x2 - x1) + Math.abs(y2 - y1),
});

function partir(r: Caja, piezas: Caja[], l: Linea): [Caja, Caja[], Caja, Caja[]] {
  if (l.eje === "v") {
    const izq = { ...r, x2: l.pos };
    const der = { ...r, x1: l.pos };
    return [izq, piezas.filter((p) => p.x2 <= l.pos + EPS), der, piezas.filter((p) => p.x2 > l.pos + EPS)];
  }
  const arriba = { ...r, y2: l.pos };
  const abajo = { ...r, y1: l.pos };
  return [arriba, piezas.filter((p) => p.y2 <= l.pos + EPS), abajo, piezas.filter((p) => p.y2 > l.pos + EPS)];
}

const largoDe = (r: Caja, l: Linea) => (l.eje === "v" ? r.y2 - r.y1 : r.x2 - r.x1);

const segmentoDe = (r: Caja, l: Linea): Segmento =>
  l.eje === "v" ? segmento(l.pos, r.y1, l.pos, r.y2) : segmento(r.x1, l.pos, r.x2, l.pos);

class Resolver {
  private memo = new Map<string, { costo: number; linea: Linea | null }>();

  constructor(private readonly tol: number) {}

  /**
   * Las líneas que cruzan el pedazo entero sin pisar ninguna pieza, en orden de
   * preferencia: primero las que separan piezas, después las horizontales, y de
   * arriba a abajo / de izquierda a derecha. Ese orden desempata a igual costo.
   */
  candidatas(r: Caja, piezas: Caja[]): Linea[] {
    const vistas = new Set<string>();
    const salida: { l: Linea; separa: boolean }[] = [];
    const probar = (eje: "v" | "h", pos: number) => {
      const [a, b] = eje === "v" ? [r.x1, r.x2] : [r.y1, r.y2];
      if (pos <= a + this.tol || pos >= b - this.tol) return;
      const k = `${eje}${Math.round(pos * 1e4)}`;
      if (vistas.has(k)) return;
      vistas.add(k);
      const cruza = piezas.some((p) =>
        eje === "v" ? p.x1 < pos - EPS && p.x2 > pos + EPS : p.y1 < pos - EPS && p.y2 > pos + EPS,
      );
      if (cruza) return;
      const antes = piezas.filter((p) => (eje === "v" ? p.x2 : p.y2) <= pos + EPS).length;
      salida.push({
        l: { eje, pos },
        separa: antes > 0 && antes < piezas.length,
      });
    };
    for (const p of piezas) {
      probar("h", p.y1);
      probar("h", p.y2);
      probar("v", p.x1);
      probar("v", p.x2);
    }
    return salida
      .sort(
        (a, b) =>
          Number(b.separa) - Number(a.separa) ||
          (a.l.eje === b.l.eje ? 0 : a.l.eje === "h" ? -1 : 1) ||
          a.l.pos - b.l.pos,
      )
      .map((x) => x.l);
  }

  /** Lo que falta cortar si no hay línea de guillotina: el contorno de cada pieza. */
  contornos(r: Caja, piezas: Caja[]): Segmento[] {
    const t = this.tol;
    const salida: Segmento[] = [];
    for (const p of piezas) {
      if (p.x1 > r.x1 + t) salida.push(segmento(p.x1, p.y1, p.x1, p.y2));
      if (p.x2 < r.x2 - t) salida.push(segmento(p.x2, p.y1, p.x2, p.y2));
      if (p.y1 > r.y1 + t) salida.push(segmento(p.x1, p.y1, p.x2, p.y1));
      if (p.y2 < r.y2 - t) salida.push(segmento(p.x1, p.y2, p.x2, p.y2));
    }
    return salida;
  }

  /** Los metros mínimos para sacar las piezas del pedazo. Llena `memo`. */
  costo(r: Caja, piezas: Caja[]): number {
    if (piezas.length === 0) return 0;
    const k = clave(r);
    const visto = this.memo.get(k);
    if (visto) return visto.costo;
    if (this.memo.size >= MAX_PEDAZOS) throw AGOTADO;

    let mejor: { costo: number; linea: Linea | null } = {
      costo: this.contornos(r, piezas).reduce((s, x) => s + x.largo, 0),
      linea: null,
    };
    const candidatas = this.candidatas(r, piezas);
    if (candidatas.length > 0) mejor = { costo: Infinity, linea: null };
    for (const l of candidatas) {
      const [r1, p1, r2, p2] = partir(r, piezas, l);
      const c = largoDe(r, l) + this.costo(r1, p1) + this.costo(r2, p2);
      if (c < mejor.costo - EPS) mejor = { costo: c, linea: l };
    }
    this.memo.set(k, mejor);
    return mejor.costo;
  }

  /** A ojo: el corte que más parejo reparte las piezas. */
  golosa(r: Caja, piezas: Caja[]): Linea | null {
    if (piezas.length === 1) {
      // Una sola pieza: la búsqueda completa es inmediata.
      this.costo(r, piezas);
      return this.memo.get(clave(r))?.linea ?? null;
    }
    let mejor: { l: Linea; valor: number } | null = null;
    for (const l of this.candidatas(r, piezas)) {
      const [, p1, , p2] = partir(r, piezas, l);
      // Separar piezas vale más que recortar; entre recortes, el más corto.
      const valor = Math.min(p1.length, p2.length) > 0 ? Math.min(p1.length, p2.length) * 1e6 : -largoDe(r, l);
      if (!mejor || valor > mejor.valor) mejor = { l, valor };
    }
    return mejor?.l ?? null;
  }

  emitir(r: Caja, piezas: Caja[], optimo: boolean, salida: Segmento[]): void {
    if (piezas.length === 0) return;
    const linea = optimo ? (this.memo.get(clave(r))?.linea ?? null) : this.golosa(r, piezas);
    if (!linea) {
      salida.push(...this.contornos(r, piezas));
      return;
    }
    salida.push(segmentoDe(r, linea));
    const [r1, p1, r2, p2] = partir(r, piezas, linea);
    this.emitir(r1, p1, optimo, salida);
    this.emitir(r2, p2, optimo, salida);
  }

  cortes(r: Caja, piezas: Caja[]): Segmento[] {
    let optimo = piezas.length <= MAX_PIEZAS_OPTIMO;
    if (optimo) {
      try {
        this.costo(r, piezas);
      } catch (e) {
        if (e !== AGOTADO) throw e;
        optimo = false;
        this.memo.clear();
      }
    }
    const salida: Segmento[] = [];
    this.emitir(r, piezas, optimo, salida);
    return salida;
  }
}

/** Los cortes de cutter de una plancha, en el orden en que se hacen. */
export function cortesManuales(p: PlanchaParaCortes, o: OpcionesCortesManuales = {}): CorteManual[] {
  const W = p.ancho;
  const H = p.alto;
  const segmentos: Segmento[] = [];

  // Primero se separa lo que se cobra: la franja de la derecha, de alto
  // completo, y después lo que queda debajo (como deja los sobrantes `cobro.ts`).
  let cw = W;
  let ch = H;
  if (p.cobro.factor < 1) {
    cw = Math.min(p.cobro.ancho, W);
    ch = Math.min(p.cobro.alto, H);
    if (W - cw > EPS) segmentos.push(segmento(cw, 0, cw, H));
    if (H - ch > EPS) segmentos.push(segmento(0, ch, cw, ch));
  }

  const piezas: Caja[] = p.paneles.filter((x) => !x.libre).map(({ x1, y1, x2, y2 }) => ({ x1, y1, x2, y2 }));
  // Un borde a menos de un kerf (el hueco entre dos piezas) o del margen (el
  // borde que no se aprovecha) ya está cortado: no se corta otra vez.
  const tol = Math.max(0, o.kerf ?? 0) + Math.max(0, o.margen ?? 0) + EPS;
  segmentos.push(...new Resolver(tol).cortes({ x1: 0, y1: 0, x2: cw, y2: ch }, piezas));

  return segmentos.map((s, i) => ({ n: i + 1, ...s }));
}

/**
 * Los cortes que se dibujan en el plano de una plancha: los guardados con ella
 * o, en un corte manual de antes de que se guardaran, recalculados. Nada en
 * láser.
 */
export function cortesParaPlano(
  p: PlanchaParaCortes & { cortes?: CorteManual[] },
  manual: boolean,
): CorteManual[] | undefined {
  if (!manual) return undefined;
  return p.cortes ?? cortesManuales(p);
}

/** Los cm de cutter de una lista de cortes. */
export const largoTotal = (cortes: Pick<CorteManual, "largo">[]) => cortes.reduce((s, c) => s + c.largo, 0);

/** "8 cortes · 5.91 m", para el pie de cada plano. */
export function resumenCortes(cortes: Pick<CorteManual, "largo">[]): string {
  const m = largoTotal(cortes) / 100;
  return `${cortes.length} ${cortes.length === 1 ? "corte" : "cortes"} · ${m.toFixed(2)} m`;
}
