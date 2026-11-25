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

/**
 * De dónde sale el material de una plancha del resultado. `formato` es el código
 * del formato cuando un corte mezcla varios; sin él, la plancha es del formato
 * del corte.
 */
export type Origen = { tipo: "plancha"; formato?: string } | { tipo: "sobrante"; id: string };

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

/**
 * Cómo se parte el sobrante en L al colocar una pieza:
 *
 *   perezosa    se guardan los dos cortes en un nodo O y decide la pieza
 *               siguiente. Suele ser lo mejor, pero con muchas piezas iguales
 *               elige siempre el corte que baja hasta el borde y deja la franja
 *               de abajo en cuadritos donde ya no entra nada.
 *   horizontal  corte a lo ancho: el sobrante de abajo queda entero.
 *   vertical    corte a lo alto: el sobrante de la derecha queda entero.
 */
type Regla = "perezosa" | "horizontal" | "vertical";
const REGLAS: readonly Regla[] = ["perezosa", "horizontal", "vertical"];

/**
 * Cómo se arma una pasada: la `regla` de corte y el desempate de `alineado`.
 *
 * La puntuación de `Hoja` vale lo mismo para la pieza parada y para la acostada
 * (ver `Hoja.calcular`), así que entre las dos decide el orden o el ruido de la
 * coma flotante. Eso a veces mete una pieza girada en medio de una fila y deja
 * una cuña donde ya no entra nada: 40 de 30×50 en 122×183 salían 12 por plancha
 * y 4 planchas, cuando caben 14 y bastan 3. Con `alineado`, a igual puntuación
 * gana la orientación que pega la pieza al borde del hueco: cierra la fila en
 * vez de abrir una cuña.
 */
interface Estilo {
  regla: Regla;
  alineado: boolean;
}

class Hoja extends ConMemoria {
  constructor(
    readonly x1: number,
    readonly y1: number,
    readonly x2: number,
    readonly y2: number,
    readonly estilo: Estilo,
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
    const sW = Math.max(sobraW, 0);
    const sH = Math.max(sobraH, 0);
    // El 1e-3 solo desempata: lo que separa dos huecos distintos es de varios cm.
    return 1 / (sW + sH + (this.estilo.alineado ? 1e-3 * Math.min(sW, sH) : 0));
  }

  colocar(p: Colocable): Nodo | null {
    if (this.encaje(p.w, p.h) === 0) return null;
    const { x1, y1, x2, y2, estilo } = this;
    const { regla } = estilo;
    const xp = x1 + p.w;
    const yp = y1 + p.h;
    const sobraW = x2 - xp > EPS;
    const sobraH = y2 - yp > EPS;

    // La pieza se ancla arriba a la izquierda; lo que sobra queda en L.
    const ocupada = new Hoja(x1, y1, sobraW ? xp : x2, sobraH ? yp : y2, estilo, p);
    if (!sobraW && !sobraH) return ocupada;
    if (!sobraW) return new Y(ocupada, new Hoja(x1, yp, x2, y2, estilo));
    if (!sobraH) return new Y(ocupada, new Hoja(xp, y1, x2, y2, estilo));

    // Las dos particiones de guillotina posibles.
    const horizontal = new Y(new Hoja(xp, y1, x2, yp, estilo), new Hoja(x1, yp, x2, y2, estilo));
    const vertical = new Y(new Hoja(xp, y1, x2, y2, estilo), new Hoja(x1, yp, xp, y2, estilo));
    if (regla === "horizontal") return new Y(ocupada, horizontal);
    if (regla === "vertical") return new Y(ocupada, vertical);
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
 * orientación y las tres `REGLAS` de corte: 63 pasadas, y otras 63 con el
 * desempate `alineado` si las primeras no llegan a la cota del área. Ninguno
 * gana siempre.
 * Con 2000 piezas el cálculo con precios tarda menos de un segundo, y se puede
 * permitir: quien cotiza prefiere esperar a que le sobre una plancha.
 * `sort` es estable, así que a igualdad manda el orden en que llegaron.
 */
const ORDENES: ReadonlyArray<(a: Pieza, b: Pieza) => number> = [
  (a, b) => area(b) - area(a),
  (a, b) => Math.max(b.ancho, b.alto) - Math.max(a.ancho, a.alto) || area(b) - area(a),
  (a, b) => b.ancho + b.alto - (a.ancho + a.alto) || area(b) - area(a),
  (a, b) => Math.min(b.ancho, b.alto) - Math.min(a.ancho, a.alto) || area(b) - area(a),
  (a, b) => b.ancho - a.ancho || b.alto - a.alto,
  (a, b) => b.alto - a.alto || b.ancho - a.ancho,
  (a, b) => b.ancho / b.alto - a.ancho / a.alto || area(b) - area(a),
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
  estilo: Estilo,
): ResultadoCorte {
  // El área útil: sin los bordes, y con un kerf de más porque la última pieza
  // de cada fila no necesita el corte que la separaría de la siguiente.
  const util = (lado: number) => lado - 2 * margen + kerf;
  const abiertas: Abierta[] = [];
  const pendientes = [...previos];
  const noCaben: Pieza[] = [];

  const abrir = (ancho: number, alto: number, origen: Origen): Abierta => {
    const nueva = { ancho, alto, origen, raiz: new Hoja(0, 0, util(ancho), util(alto), estilo), piezas: 0 };
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
        // En la plancha vacía la orientación la decide la preferencia de la
        // pasada: el desempate por alineación solo vale con piezas ya puestas.
        const vacia = new Hoja(0, 0, util(ancho), util(alto), { ...estilo, alineado: false });
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
 * Determinista: la misma entrada da el mismo resultado. Prueba siete órdenes,
 * cada uno con tres preferencias de orientación y tres reglas de corte (y otra
 * vuelta con el desempate `alineado` si hace falta), y se
 * queda con la pasada que deja menos piezas fuera, abre menos planchas nuevas,
 * cuesta menos (`opciones.costo`) y, a igualdad, deja la plancha menos usada
 * más vacía: llena las primeras y deja el sobrante más grande, que es el que
 * más se vende.
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

  const usoMinimo = (r: ResultadoCorte) => Math.min(Infinity, ...r.planchas.map((p) => p.usoPct));
  const clave = (r: ResultadoCorte) => [r.noCaben.length, planchasNuevas(r), costo ? costo(r) : 0, usoMinimo(r)];
  // Menor gana, en orden. Un pelo de diferencia en el costo o el uso es empate.
  const gana = (a: number[], b: number[]) => {
    for (let i = 0; i < a.length; i++) {
      if (a[i] < b[i] - EPS) return true;
      if (a[i] > b[i] + EPS) return false;
    }
    return false;
  };

  // Primero las pasadas de siempre y después las alineadas: `gana` es estricto,
  // así que una alineada solo desplaza a una anterior si es mejor. Las alineadas
  // duplican el trabajo, y no hacen falta cuando ya se abren tantas planchas
  // como exige el área: más planchas que esa cota es donde puede haber ganancia.
  let mejor: { r: ResultadoCorte; clave: number[] } | null = null;
  const probar = (alineado: boolean) => {
    for (const regla of REGLAS) {
      for (const orden of ORDENES) {
        const ordenadas = [...validas].sort(orden);
        for (const preferencia of PREFERENCIAS) {
          const r = unaPasada(ancho, alto, ordenadas, rotar, kerf, margen, previos, preferencia, { regla, alineado });
          const k = clave(r);
          if (!mejor || gana(k, mejor.clave)) mejor = { r, clave: k };
        }
      }
    }
  };

  probar(false);
  const colocadas = new Set(mejor!.r.noCaben);
  const areaPiezas = validas.reduce((s, p) => s + (colocadas.has(p) ? 0 : area(p)), 0);
  const areaPrevios = previos.reduce((s, c) => s + c.ancho * c.alto, 0);
  const cota = Math.ceil(Math.max(0, areaPiezas - areaPrevios) / (ancho * alto) - 1e-9);
  if (planchasNuevas(mejor!.r) > cota) probar(true);
  if (previos.length > 0 || planchasNuevas(mejor!.r) <= cota) return mejor!.r;

  // Sobra al menos una plancha respecto de la cota del área: se intenta vaciar
  // la menos usada. Primero repartiendo sus piezas en los huecos de las demás;
  // si no, empaquetando todo otra vez con esas piezas por delante, que es lo que
  // le faltó al orden goloso: llegaron tarde, cuando los huecos ya estaban rotos.
  const porId = new Map(validas.map((p) => [p.id, p]));
  for (let vuelta = 0; vuelta < 4 && planchasNuevas(mejor!.r) > cota; vuelta++) {
    const actual: ResultadoCorte = mejor!.r;
    const absorbido = absorberMenosUsada(actual, porId, { rotar, kerf, margen });
    if (absorbido) {
      mejor = { r: absorbido, clave: clave(absorbido) };
      continue;
    }
    const victima = menosUsada(actual);
    if (victima < 0) break;
    const primero = new Set(piezasDe(actual.planchas[victima], porId).map((p) => p.id));
    const antes = validas.filter((p) => primero.has(p.id));
    const despues = validas.filter((p) => !primero.has(p.id));
    const previa = planchasNuevas(actual);
    for (const orden of ORDENES.slice(0, 4)) {
      const ordenadas = [...[...antes].sort(orden), ...[...despues].sort(orden)];
      for (const regla of REGLAS) {
        for (const preferencia of PREFERENCIAS) {
          for (const alineado of [false, true]) {
            const r = unaPasada(ancho, alto, ordenadas, rotar, kerf, margen, [], preferencia, { regla, alineado });
            const k = clave(r);
            if (gana(k, mejor!.clave)) mejor = { r, clave: k };
          }
        }
      }
    }
    if (planchasNuevas(mejor!.r) >= previa) break;
  }
  return mejor!.r;
}

/** La plancha nueva menos usada, o -1 si no hay ninguna. */
function menosUsada(r: ResultadoCorte): number {
  let i = -1;
  r.planchas.forEach((p, j) => {
    if (p.origen.tipo === "plancha" && (i < 0 || p.usoPct < r.planchas[i].usoPct)) i = j;
  });
  return i;
}

/**
 * Los huecos libres de una plancha ya cortada, como contenedores donde se puede
 * seguir empaquetando. Un hueco que linda con otra pieza (no con el borde de la
 * plancha) pierde un kerf en ese lado: si no, la pieza nueva quedaría pegada.
 */
export function huecosDe(p: PlanchaCortada, kerf: number, margen: number) {
  const salida: { panel: number; ancho: number; alto: number; recorteW: number; recorteH: number }[] = [];
  p.paneles.forEach((panel, i) => {
    if (!panel.libre || panel.sobrante) return;
    const recorteW = panel.x2 < p.ancho - margen - EPS ? kerf : 0;
    const recorteH = panel.y2 < p.alto - margen - EPS ? kerf : 0;
    const ancho = panel.x2 - panel.x1 - recorteW;
    const alto = panel.y2 - panel.y1 - recorteH;
    if (ancho > EPS && alto > EPS) salida.push({ panel: i, ancho, alto, recorteW, recorteH });
  });
  return salida;
}

/**
 * Mete el acomodo `dentro` (empaquetado en un hueco, con origen en su esquina)
 * en el panel libre `indice` de `p`. Lo que se recortó por el kerf vuelve como
 * panel libre, para que los paneles sigan cubriendo la plancha.
 */
export function injertar(
  p: PlanchaCortada,
  indice: number,
  dentro: PlanchaCortada,
  recorteW: number,
  recorteH: number,
): PlanchaCortada {
  const hueco = p.paneles[indice];
  const ox = hueco.x1;
  const oy = hueco.y1;
  const nuevos: Panel[] = dentro.paneles.map((x) => ({ ...x, x1: x.x1 + ox, x2: x.x2 + ox, y1: x.y1 + oy, y2: x.y2 + oy }));
  // `cerrar` recorta lo libre al borde de `dentro`: el resto del hueco, si quedó algo, también es libre.
  if (recorteW > EPS) nuevos.push({ x1: hueco.x2 - recorteW, y1: hueco.y1, x2: hueco.x2, y2: hueco.y2, libre: true });
  if (recorteH > EPS) nuevos.push({ x1: hueco.x1, y1: hueco.y2 - recorteH, x2: hueco.x2 - recorteW, y2: hueco.y2, libre: true });
  const paneles = [...p.paneles.slice(0, indice), ...nuevos, ...p.paneles.slice(indice + 1)];
  const areaUsada = p.areaUsada + dentro.areaUsada;
  return { ...p, paneles, piezas: p.piezas + dentro.piezas, areaUsada, usoPct: (areaUsada / (p.ancho * p.alto)) * 100 };
}

/**
 * Las piezas de `piezas` acomodadas en los huecos de `planchas`, sin abrir
 * ninguna nueva; `null` si alguna no entra. Devuelve las planchas con los
 * injertos hechos, en el mismo orden.
 */
export function enHuecos(
  planchas: PlanchaCortada[],
  piezas: Pieza[],
  o: { rotar: boolean; kerf: number },
  margen: number,
): PlanchaCortada[] | null {
  if (piezas.length === 0) return planchas;
  const huecos = planchas.flatMap((p, i) => huecosDe(p, o.kerf, margen).map((h) => ({ ...h, plancha: i })));
  if (huecos.length === 0) return null;
  // Los más chicos primero: el primero donde entre es el que más ajusta.
  huecos.sort((a, b) => a.ancho * a.alto - b.ancho * b.alto);
  const contenedores = huecos.map((h, i) => ({ id: String(i), ancho: h.ancho, alto: h.alto }));
  const mayor = huecos.reduce((m, h) => (h.ancho * h.alto > m.ancho * m.alto ? h : m));
  const r = empaquetar(mayor.ancho, mayor.alto, piezas, { rotar: o.rotar, kerf: o.kerf, previos: contenedores });
  if (r.noCaben.length > 0 || planchasNuevas(r) > 0) return null;

  // De atrás para adelante dentro de cada plancha: los índices de los paneles no se corren.
  const usados = r.planchas
    .map((p) => ({ p, h: huecos[Number((p.origen as { id: string }).id)] }))
    .sort((a, b) => a.h.plancha - b.h.plancha || b.h.panel - a.h.panel);
  const salida = [...planchas];
  for (const { p, h } of usados) salida[h.plancha] = injertar(salida[h.plancha], h.panel, p, h.recorteW, h.recorteH);
  return salida;
}

/** Vacía la plancha nueva menos usada repartiendo sus piezas en los huecos de las demás. */
function absorberMenosUsada(
  r: ResultadoCorte,
  porId: Map<string, Pieza>,
  o: { rotar: boolean; kerf: number; margen: number },
): ResultadoCorte | null {
  const victima = menosUsada(r);
  if (victima < 0) return null;
  const otras = r.planchas.filter((_, i) => i !== victima);
  const piezas = piezasDe(r.planchas[victima], porId);
  const hecho = enHuecos(otras, piezas, o, o.margen);
  return hecho ? { planchas: hecho, noCaben: r.noCaben } : null;
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
