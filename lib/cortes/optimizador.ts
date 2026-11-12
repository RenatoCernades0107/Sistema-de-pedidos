/**
 * Empaquetado 2D con cortes de guillotina. Puro: recibe números y devuelve
 * geometría. No sabe de precios, catálogos ni Odoo — eso vive en `cobro.ts` y
 * `calcular.ts` —, y por eso corre igual en el navegador y en el servidor.
 *
 * Es un *guillotine bin packing*, NP-difícil; se resuelve con una heurística
 * golosa. Cada plancha es un árbol inmutable con tres tipos de nodo:
 *
 *   Hoja      un rectángulo, libre u ocupado por una pieza
 *   Y         dos sub-regiones que coexisten (el corte ya se decidió)
 *   O         dos formas de partir la misma región, todavía sin decidir
 *
 * La idea que lo distingue: al colocar una pieza queda un sobrante en L, y hay
 * dos cortes de guillotina posibles para partirlo. En vez de elegir a ciegas, se
 * guardan los dos en un nodo O, que colapsa a una opción cuando llega la
 * siguiente pieza que cabe ahí. La dirección del corte se decide con la pieza
 * real delante.
 *
 * Origen (0,0) arriba a la izquierda; x crece a la derecha, y hacia abajo. Todo
 * en centímetros.
 */

export interface Pieza {
  /** Identifica la pieza en el resultado: qué rectángulo es cuál del pedido. */
  id: string;
  ancho: number;
  alto: number;
  /** `false` si no se puede girar 90° (veta, dibujo). Por defecto se puede. */
  rotable?: boolean;
}

export interface Panel {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  libre: boolean;
  /** La pieza que lo ocupa. */
  piezaId?: string;
  /** Si la pieza quedó girada respecto de como se pidió. */
  rotada?: boolean;
  /** Parte de la plancha que no se cobra y queda entera (lo marca `cobro.ts`). */
  sobrante?: boolean;
}

/** De dónde sale el material de una plancha del resultado. */
export type Origen = { tipo: "plancha" } | { tipo: "sobrante"; id: string };

export interface PlanchaCortada {
  ancho: number;
  alto: number;
  origen: Origen;
  paneles: Panel[];
  /** Piezas colocadas (no líneas de corte). */
  piezas: number;
  areaUsada: number;
  /** Porcentaje del área ocupado por piezas. */
  usoPct: number;
}

export interface ResultadoCorte {
  planchas: PlanchaCortada[];
  /** Las que no entran en ninguna plancha, en ninguna orientación. */
  noCaben: Pieza[];
}

/** Una pieza del almacén que se intenta usar antes de abrir una plancha nueva. */
export interface Contenedor {
  id: string;
  ancho: number;
  alto: number;
}

export interface OpcionesCorte {
  /** Girar piezas 90° cuando conviene. Por defecto sí. */
  rotar?: boolean;
  /** Lo que se come la herramienta en cada corte. */
  kerf?: number;
  /** Borde de la plancha que no se aprovecha, por cada lado. */
  margen?: number;
  /**
   * Piezas ya existentes (sobrantes), en el orden en que se prefieren. Se abren
   * antes que una plancha nueva; cada una se usa una sola vez.
   */
  previos?: Contenedor[];
  /**
   * Para desempatar entre resultados con las mismas planchas: gana el menor.
   * `calcular.ts` pasa aquí lo que se cobraría, y así el empaquetado concentra
   * las piezas donde sale más barato.
   */
  costo?: (r: ResultadoCorte) => number;
}

/** Dos medidas se consideran iguales por debajo de esto (cm). */
export const EPS = 1e-6;

/* ── El árbol ──────────────────────────────────────────────────────────────── */

/** Una pieza ya orientada, con las medidas con las que se empaqueta (con kerf). */
interface Colocable {
  id: string;
  w: number;
  h: number;
  rotada: boolean;
}

interface Nodo {
  /** 0 = no cabe; mayor = encaja más ajustado. */
  encaje(w: number, h: number): number;
  /** Un árbol NUEVO con la pieza colocada, o `null` si no cabe. Nunca muta. */
  colocar(p: Colocable): Nodo | null;
  paneles(salida: Panel[]): void;
}

/**
 * El encaje de un sub-árbol para unas medidas no cambia nunca (el árbol es
 * inmutable), y las mismas medidas se preguntan una y otra vez: diez piezas
 * iguales, y cada una en sus dos orientaciones. Dos casillas bastan.
 */
abstract class ConMemoria implements Nodo {
  private w0 = -1;
  private h0 = -1;
  private v0 = 0;
  private w1 = -1;
  private h1 = -1;
  private v1 = 0;
  private turno = 0;

  encaje(w: number, h: number): number {
    if (w === this.w0 && h === this.h0) return this.v0;
    if (w === this.w1 && h === this.h1) return this.v1;
    const v = this.calcular(w, h);
    if (this.turno === 0) {
      this.w0 = w;
      this.h0 = h;
      this.v0 = v;
    } else {
      this.w1 = w;
      this.h1 = h;
      this.v1 = v;
    }
    this.turno = 1 - this.turno;
    return v;
  }

  protected abstract calcular(w: number, h: number): number;
  abstract colocar(p: Colocable): Nodo | null;
  abstract paneles(salida: Panel[]): void;
}

class Hoja extends ConMemoria {
  constructor(
    readonly x1: number,
    readonly y1: number,
    readonly x2: number,
    readonly y2: number,
    readonly pieza: Colocable | null = null,
  ) {
    super();
  }

  protected calcular(w: number, h: number): number {
    if (this.pieza) return 0;
    const sobraW = this.x2 - this.x1 - w;
    const sobraH = this.y2 - this.y1 - h;
    if (sobraW < -EPS || sobraH < -EPS) return 0;
    if (sobraW <= EPS && sobraH <= EPS) return Infinity;
    // Ojo: la suma vale W + H − w − h con la pieza parada o acostada, así que
    // esto no elige la orientación; la eligen las pasadas de `empaquetar`. Se
    // probó puntuar por el lado corto (Best Short Side Fit) y daba más planchas.
    return 1 / (Math.max(sobraW, 0) + Math.max(sobraH, 0));
  }

  colocar(p: Colocable): Nodo | null {
    if (this.encaje(p.w, p.h) === 0) return null;
    const { x1, y1, x2, y2 } = this;
    const xp = x1 + p.w;
    const yp = y1 + p.h;
    const sobraW = x2 - xp > EPS;
    const sobraH = y2 - yp > EPS;

    // La pieza se ancla arriba a la izquierda; lo que sobra queda en L.
    const ocupada = new Hoja(x1, y1, sobraW ? xp : x2, sobraH ? yp : y2, p);
    if (!sobraW && !sobraH) return ocupada;
    if (!sobraW) return new Y(ocupada, new Hoja(x1, yp, x2, y2));
    if (!sobraH) return new Y(ocupada, new Hoja(xp, y1, x2, y2));

    // Las dos particiones de guillotina posibles, sin decidir todavía.
    const horizontal = new Y(new Hoja(xp, y1, x2, yp), new Hoja(x1, yp, x2, y2));
    const vertical = new Y(new Hoja(xp, y1, x2, y2), new Hoja(x1, yp, xp, y2));
    return new Y(ocupada, new O(horizontal, vertical));
  }

  paneles(salida: Panel[]): void {
    salida.push(
      this.pieza
        ? {
            x1: this.x1,
            y1: this.y1,
            x2: this.x2,
            y2: this.y2,
            libre: false,
            piezaId: this.pieza.id,
            rotada: this.pieza.rotada,
          }
        : { x1: this.x1, y1: this.y1, x2: this.x2, y2: this.y2, libre: true },
    );
  }
}

class Y extends ConMemoria {
  constructor(
    readonly a: Nodo,
    readonly b: Nodo,
  ) {
    super();
  }

  protected calcular(w: number, h: number): number {
    return Math.max(this.a.encaje(w, h), this.b.encaje(w, h));
  }

  colocar(p: Colocable): Nodo | null {
    const fa = this.a.encaje(p.w, p.h);
    const fb = this.b.encaje(p.w, p.h);
    if (fa === 0 && fb === 0) return null;
    // Por el hijo que mejor la acomoda; si ahí no entra, por el otro.
    if (fa >= fb) {
      const na = this.a.colocar(p);
      if (na) return new Y(na, this.b);
      const nb = fb > 0 ? this.b.colocar(p) : null;
      return nb ? new Y(this.a, nb) : null;
    }
    const nb = this.b.colocar(p);
    if (nb) return new Y(this.a, nb);
    const na = fa > 0 ? this.a.colocar(p) : null;
    return na ? new Y(na, this.b) : null;
  }

  paneles(salida: Panel[]): void {
    this.a.paneles(salida);
    this.b.paneles(salida);
  }
}

class O extends ConMemoria {
  constructor(
    readonly a: Nodo,
    readonly b: Nodo,
  ) {
    super();
  }

  protected calcular(w: number, h: number): number {
    return Math.max(this.a.encaje(w, h), this.b.encaje(w, h));
  }

  /** Colapsa: devuelve el sub-árbol de la opción elegida, no otro nodo O. */
  colocar(p: Colocable): Nodo | null {
    const fa = this.a.encaje(p.w, p.h);
    const fb = this.b.encaje(p.w, p.h);
    if (fa === 0 && fb === 0) return null;
    if (fa >= fb) return this.a.colocar(p) ?? (fb > 0 ? this.b.colocar(p) : null);
    return this.b.colocar(p) ?? (fa > 0 ? this.a.colocar(p) : null);
  }

  /** Mientras nadie decida, se dibuja la primera partición. */
  paneles(salida: Panel[]): void {
    this.a.paneles(salida);
  }
}

/* ── El bucle ──────────────────────────────────────────────────────────────── */

interface Abierta {
  ancho: number;
  alto: number;
  origen: Origen;
  raiz: Nodo;
  piezas: number;
}

const area = (p: Pick<Pieza, "ancho" | "alto">) => p.ancho * p.alto;

/**
 * Los órdenes que se prueban, cada uno con las tres `PREFERENCIAS` de
 * orientación. Ninguno gana siempre: con cuatro se ahorra una
 * plancha en uno de cada diez pedidos, y siguen siendo milésimas de segundo.
 * `sort` es estable, así que a igualdad manda el orden en que llegaron.
 */
const ORDENES: ReadonlyArray<(a: Pieza, b: Pieza) => number> = [
  (a, b) => area(b) - area(a),
  (a, b) => Math.max(b.ancho, b.alto) - Math.max(a.ancho, a.alto) || area(b) - area(a),
  (a, b) => b.ancho + b.alto - (a.ancho + a.alto) || area(b) - area(a),
  (a, b) => Math.min(b.ancho, b.alto) - Math.min(a.ancho, a.alto) || area(b) - area(a),
];

/**
 * Qué orientación va primero cuando las dos encajan igual, que con la
 * puntuación de `Hoja` es casi siempre. Abrir una plancha con la pieza parada o
 * acostada decide si la siguiente entra a su lado: 70×120 en 122×183 deja sitio
 * para otra solo si va acostada.
 *
 * "pedida" va primero y es como se empaquetaba antes: a igualdad de planchas y
 * costo gana ese acomodo, y nunca sale uno peor que el de antes. Con las otras
 * dos se ahorraron 258 planchas en 2200 pedidos de prueba (9312 → 9054).
 */
type Preferencia = "pedida" | "acostada" | "parada";
const PREFERENCIAS: readonly Preferencia[] = ["pedida", "acostada", "parada"];

function orientaciones(p: Pieza, rotar: boolean, kerf: number, preferencia: Preferencia): Colocable[] {
  const derecha = { id: p.id, w: p.ancho + kerf, h: p.alto + kerf, rotada: false };
  if (!rotar || p.rotable === false || Math.abs(p.ancho - p.alto) <= EPS) return [derecha];
  const girada = { id: p.id, w: p.alto + kerf, h: p.ancho + kerf, rotada: true };
  if (preferencia === "pedida") return [derecha, girada];
  const acostadaPrimero = derecha.w >= derecha.h ? [derecha, girada] : [girada, derecha];
  return preferencia === "acostada" ? acostadaPrimero : acostadaPrimero.reverse();
}

function unaPasada(
  anchoPlancha: number,
  altoPlancha: number,
  piezas: Pieza[],
  rotar: boolean,
  kerf: number,
  margen: number,
  previos: Contenedor[],
  preferencia: Preferencia,
): ResultadoCorte {
  // El área útil: sin los bordes, y con un kerf de más porque la última pieza
  // de cada fila no necesita el corte que la separaría de la siguiente.
  const util = (lado: number) => lado - 2 * margen + kerf;
  const abiertas: Abierta[] = [];
  const pendientes = [...previos];
  const noCaben: Pieza[] = [];

  const abrir = (ancho: number, alto: number, origen: Origen): Abierta => {
    const nueva = { ancho, alto, origen, raiz: new Hoja(0, 0, util(ancho), util(alto)), piezas: 0 };
    abiertas.push(nueva);
    return nueva;
  };

  for (const pieza of piezas) {
    const candidatas = orientaciones(pieza, rotar, kerf, preferencia);

    let mejor: { plancha: Abierta; c: Colocable; encaje: number } | null = null;
    for (const plancha of abiertas) {
      for (const c of candidatas) {
        const encaje = plancha.raiz.encaje(c.w, c.h);
        if (encaje > 0 && (!mejor || encaje > mejor.encaje)) mejor = { plancha, c, encaje };
      }
    }

    if (!mejor) {
      // La orientación que mejor encaja en la plancha vacía; a igualdad, la preferida.
      const cabe = (ancho: number, alto: number) => {
        const vacia = new Hoja(0, 0, util(ancho), util(alto));
        let elegida: Colocable | undefined;
        let mejorEncaje = 0;
        for (const c of candidatas) {
          const e = vacia.encaje(c.w, c.h);
          if (e > mejorEncaje) [elegida, mejorEncaje] = [c, e];
        }
        return elegida;
      };

      // Antes que una plancha nueva, la primera pieza del almacén donde quepa.
      const i = pendientes.findIndex((s) => cabe(s.ancho, s.alto));
      if (i >= 0) {
        const [s] = pendientes.splice(i, 1);
        mejor = {
          plancha: abrir(s.ancho, s.alto, { tipo: "sobrante", id: s.id }),
          c: cabe(s.ancho, s.alto)!,
          encaje: 1,
        };
      } else {
        const c = cabe(anchoPlancha, altoPlancha);
        if (!c) {
          noCaben.push(pieza);
          continue;
        }
        mejor = { plancha: abrir(anchoPlancha, altoPlancha, { tipo: "plancha" }), c, encaje: 1 };
      }
    }

    const raiz = mejor.plancha.raiz.colocar(mejor.c);
    if (!raiz) {
      // No debería pasar: el encaje era positivo. Mejor decirlo que perder la pieza.
      noCaben.push(pieza);
      continue;
    }
    mejor.plancha.raiz = raiz;
    mejor.plancha.piezas += 1;
  }

  return { planchas: abiertas.map((p) => cerrar(p, kerf, margen)), noCaben };
}

/** Del árbol a los paneles en coordenadas de la plancha real. */
function cerrar(p: Abierta, kerf: number, margen: number): PlanchaCortada {
  const crudos: Panel[] = [];
  p.raiz.paneles(crudos);

  const paneles: Panel[] = [];
  let areaUsada = 0;
  for (const c of crudos) {
    // La pieza se empaquetó con su kerf pegado; la medida real no lo incluye.
    const x1 = c.x1 + margen;
    const y1 = c.y1 + margen;
    const x2 = Math.min(c.x2 - (c.libre ? 0 : kerf) + margen, p.ancho - margen);
    const y2 = Math.min(c.y2 - (c.libre ? 0 : kerf) + margen, p.alto - margen);
    if (x2 - x1 <= EPS || y2 - y1 <= EPS) continue;
    paneles.push({ ...c, x1, y1, x2, y2 });
    if (!c.libre) areaUsada += (x2 - x1) * (y2 - y1);
  }

  return {
    ancho: p.ancho,
    alto: p.alto,
    origen: p.origen,
    paneles,
    piezas: p.piezas,
    areaUsada,
    usoPct: (areaUsada / (p.ancho * p.alto)) * 100,
  };
}

/** Cuántas planchas nuevas abre un resultado (los sobrantes no cuentan). */
export const planchasNuevas = (r: ResultadoCorte) =>
  r.planchas.filter((p) => p.origen.tipo === "plancha").length;

/**
 * Empaqueta las piezas en planchas de `ancho × alto`.
 *
 * Determinista: la misma entrada da el mismo resultado. Prueba cuatro órdenes,
 * cada uno con tres preferencias de orientación, y se queda con la pasada
 * que deja menos piezas fuera, abre menos planchas nuevas y,
 * a igualdad, cuesta menos (`opciones.costo`) o deja la última plancha más vacía,
 * que es lo que da los sobrantes más grandes.
 */
export function empaquetar(
  ancho: number,
  alto: number,
  piezas: Pieza[],
  opciones: OpcionesCorte = {},
): ResultadoCorte {
  const { rotar = true, kerf = 0, margen = 0, previos = [], costo } = opciones;
  const validas = piezas.filter((p) => p.ancho > 0 && p.alto > 0);
  if (!(ancho > 0) || !(alto > 0)) return { planchas: [], noCaben: validas };

  const desempate =
    costo ?? ((r: ResultadoCorte) => Math.min(Infinity, ...r.planchas.map((p) => p.usoPct)));

  let mejor: { r: ResultadoCorte; clave: [number, number, number] } | null = null;
  for (const orden of ORDENES) {
    const ordenadas = [...validas].sort(orden);
    for (const preferencia of PREFERENCIAS) {
      const r = unaPasada(ancho, alto, ordenadas, rotar, kerf, margen, previos, preferencia);
      const clave: [number, number, number] = [r.noCaben.length, planchasNuevas(r), desempate(r)];
      if (
        !mejor ||
        clave[0] < mejor.clave[0] ||
        (clave[0] === mejor.clave[0] &&
          (clave[1] < mejor.clave[1] ||
            (clave[1] === mejor.clave[1] && clave[2] < mejor.clave[2] - EPS)))
      ) {
        mejor = { r, clave };
      }
    }
  }
  return mejor!.r;
}

/** Si la pieza entra sola en `ancho × alto`, en alguna orientación permitida. */
export function entraSola(p: Pieza, ancho: number, alto: number, rotar = true): boolean {
  const derecha = p.ancho <= ancho + EPS && p.alto <= alto + EPS;
  if (derecha || !rotar || p.rotable === false) return derecha;
  return p.alto <= ancho + EPS && p.ancho <= alto + EPS;
}

/**
 * Las piezas de una plancha ya cortada, con sus medidas originales, para volver
 * a empaquetarlas en otro rectángulo (una fracción, por ejemplo).
 */
export function piezasDe(plancha: PlanchaCortada, originales: Map<string, Pieza>): Pieza[] {
  const salida: Pieza[] = [];
  for (const panel of plancha.paneles) {
    if (panel.libre || !panel.piezaId) continue;
    const original = originales.get(panel.piezaId);
    salida.push(
      original ?? {
        id: panel.piezaId,
        ancho: panel.x2 - panel.x1,
        alto: panel.y2 - panel.y1,
      },
    );
  }
  return salida;
}
