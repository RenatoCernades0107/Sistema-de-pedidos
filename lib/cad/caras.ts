/**
 * Las caras de una pieza, reconstruidas a partir de sus triángulos, y cómo se
 * le describen al asistente cuando la persona las señala en el visor 3D.
 *
 * El GLB del motor (`cad/motor/exportar.py`) trae solo triángulos sueltos, sin
 * el B-rep: aquí se vuelven a juntar los triángulos contiguos del mismo plano.
 * Como las piezas son planchas, lo que sale son las dos caras grandes y los
 * cantos. Los cantos curvos (un círculo, una esquina redondeada) llegan como
 * muchas facetas casi iguales y se juntan en uno solo.
 *
 * Sin React ni three: lo usan el visor, el chat y el route handler.
 */

import { z } from "zod";

export type Vec3 = [number, number, number];

/** Una cara de la malla, en las coordenadas de la malla (glTF en mm, Y arriba). */
export interface CaraMalla {
  /** Los triángulos que la forman (índice de triángulo, no de vértice). */
  triangulos: number[];
  /** Normal media ponderada por área (unitaria). */
  normal: Vec3;
  /** Centroide ponderado por área. */
  centro: Vec3;
  area: number;
  /** Paralela a la plancha (cara) o perpendicular (canto). */
  tipo: "cara" | "canto";
  /** Un canto hecho de varias facetas: un borde curvo. */
  curva: boolean;
}

const COPLANAR = 0.9995;
const DISTANCIA_PLANO = 0.01; // mm
/** Entre dos facetas de un canto curvo: hasta ~25° (el motor tesela cada ~17°, `angular=0.3`). */
const FACETA_CURVA = Math.cos((25 * Math.PI) / 180);
const PERPENDICULAR = 0.02;

const resta = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cruz = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const punto = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const largo = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unitario = (a: Vec3): Vec3 => {
  const l = largo(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

class Conjuntos {
  private padre: Int32Array;
  constructor(n: number) {
    this.padre = new Int32Array(n);
    for (let i = 0; i < n; i++) this.padre[i] = i;
  }
  raiz(i: number): number {
    while (this.padre[i] !== i) {
      this.padre[i] = this.padre[this.padre[i]];
      i = this.padre[i];
    }
    return i;
  }
  unir(a: number, b: number) {
    const ra = this.raiz(a);
    const rb = this.raiz(b);
    if (ra !== rb) this.padre[rb] = ra;
  }
}

/**
 * Agrupa los triángulos de una geometría en caras. `posiciones` son x,y,z
 * seguidos; `indice`, si la geometría es indexada.
 */
export function segmentarCaras(
  posiciones: ArrayLike<number>,
  indice?: ArrayLike<number> | null,
): { caras: CaraMalla[]; caraDeTriangulo: Int32Array } {
  const nVertices = indice ? indice.length : posiciones.length / 3;
  const nTri = Math.floor(nVertices / 3);
  const vertice = (k: number): Vec3 => {
    const v = indice ? indice[k] : k;
    return [posiciones[v * 3], posiciones[v * 3 + 1], posiciones[v * 3 + 2]];
  };

  // Normal, área, centroide y plano de cada triángulo.
  const normales: Vec3[] = new Array(nTri);
  const areas = new Float64Array(nTri);
  const centros: Vec3[] = new Array(nTri);
  const planos = new Float64Array(nTri);
  // Vértices soldados por posición: el GLB trae cada triángulo con sus propios vértices.
  const claves: string[] = new Array(nTri * 3);
  const clave = (p: Vec3) => `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)},${Math.round(p[2] * 1000)}`;

  for (let t = 0; t < nTri; t++) {
    const a = vertice(t * 3);
    const b = vertice(t * 3 + 1);
    const c = vertice(t * 3 + 2);
    const n = cruz(resta(b, a), resta(c, a));
    const l = largo(n);
    areas[t] = l / 2;
    normales[t] = l > 0 ? [n[0] / l, n[1] / l, n[2] / l] : [0, 0, 0];
    centros[t] = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    planos[t] = punto(normales[t], a);
    claves[t * 3] = clave(a);
    claves[t * 3 + 1] = clave(b);
    claves[t * 3 + 2] = clave(c);
  }

  // Qué triángulos comparten cada arista.
  const aristas = new Map<string, number[]>();
  for (let t = 0; t < nTri; t++) {
    if (areas[t] === 0) continue;
    for (let k = 0; k < 3; k++) {
      const p = claves[t * 3 + k];
      const q = claves[t * 3 + ((k + 1) % 3)];
      const arista = p < q ? `${p}|${q}` : `${q}|${p}`;
      const lista = aristas.get(arista);
      if (lista) lista.push(t);
      else aristas.set(arista, [t]);
    }
  }

  // 1. Triángulos vecinos del mismo plano.
  const planas = new Conjuntos(nTri);
  for (const lista of aristas.values()) {
    for (let i = 1; i < lista.length; i++) {
      for (let j = 0; j < i; j++) {
        const s = lista[i];
        const t = lista[j];
        if (punto(normales[s], normales[t]) > COPLANAR && Math.abs(planos[s] - planos[t]) < DISTANCIA_PLANO) {
          planas.unir(s, t);
        }
      }
    }
  }

  // La normal de la plancha: la de la región plana más grande.
  const areaRegion = new Map<number, number>();
  for (let t = 0; t < nTri; t++) {
    const r = planas.raiz(t);
    areaRegion.set(r, (areaRegion.get(r) ?? 0) + areas[t]);
  }
  let mayor = -1;
  let normalPlancha: Vec3 = [0, 1, 0];
  for (const [r, area] of areaRegion) {
    if (area > mayor) {
      mayor = area;
      normalPlancha = normales[r];
    }
  }
  const esCanto = (t: number) => Math.abs(punto(normales[t], normalPlancha)) < PERPENDICULAR;

  // 2. Las facetas de un canto curvo, juntas.
  const juntas = new Conjuntos(nTri);
  for (let t = 0; t < nTri; t++) juntas.unir(planas.raiz(t), t);
  const multiples = new Set<number>();
  for (const lista of aristas.values()) {
    for (let i = 1; i < lista.length; i++) {
      for (let j = 0; j < i; j++) {
        const s = lista[i];
        const t = lista[j];
        if (planas.raiz(s) === planas.raiz(t)) continue;
        // Las facetas de un arco miden casi lo mismo; un lado recto tangente
        // al arco es mucho más largo y queda como canto aparte.
        const aS = areaRegion.get(planas.raiz(s)) ?? 0;
        const aT = areaRegion.get(planas.raiz(t)) ?? 0;
        const parecidas = Math.max(aS, aT) < 2 * Math.min(aS, aT);
        if (parecidas && esCanto(s) && esCanto(t) && punto(normales[s], normales[t]) > FACETA_CURVA) {
          juntas.unir(s, t);
          multiples.add(s).add(t);
        }
      }
    }
  }

  const porRaiz = new Map<number, number>();
  const caras: CaraMalla[] = [];
  const caraDeTriangulo = new Int32Array(nTri).fill(-1);
  const sumas: { n: Vec3; c: Vec3 }[] = [];

  for (let t = 0; t < nTri; t++) {
    if (areas[t] === 0) continue;
    const r = juntas.raiz(t);
    let i = porRaiz.get(r);
    if (i === undefined) {
      i = caras.length;
      porRaiz.set(r, i);
      caras.push({ triangulos: [], normal: [0, 0, 0], centro: [0, 0, 0], area: 0, tipo: "cara", curva: false });
      sumas.push({ n: [0, 0, 0], c: [0, 0, 0] });
    }
    const cara = caras[i];
    const suma = sumas[i];
    cara.triangulos.push(t);
    cara.area += areas[t];
    if (multiples.has(t)) cara.curva = true;
    for (let k = 0; k < 3; k++) {
      suma.n[k] += normales[t][k] * areas[t];
      suma.c[k] += centros[t][k] * areas[t];
    }
    caraDeTriangulo[t] = i;
  }

  caras.forEach((cara, i) => {
    const { n, c } = sumas[i];
    cara.normal = unitario(n);
    cara.centro = [c[0] / cara.area, c[1] / cara.area, c[2] / cara.area];
    cara.tipo = Math.abs(punto(cara.normal, normalPlancha)) > 1 - PERPENDICULAR && !cara.curva ? "cara" : "canto";
  });

  return { caras, caraDeTriangulo };
}

/* ── Lo que viaja al chat ─────────────────────────────────────────────────── */

export const LADOS = ["arriba", "abajo", "frente", "fondo", "izquierda", "derecha"] as const;
export type Lado = (typeof LADOS)[number];

const vec3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);

/** Una cara señalada en el visor. Coordenadas del producto armado: mm, Z arriba. */
export const esquemaReferenciaCara = z.object({
  clave: z.string().min(1).max(200),
  pieza: z.string().max(120).nullable(),
  nombrePieza: z.string().min(1).max(120),
  copia: z.number().int().min(1).max(10_000),
  de: z.number().int().min(1).max(10_000),
  tipo: z.enum(["cara", "canto"]),
  curva: z.boolean(),
  lado: z.enum(LADOS).nullable(),
  normal: vec3,
  centro: vec3,
  ancho_mm: z.number().finite().min(0),
  alto_mm: z.number().finite().min(0),
  area_mm2: z.number().finite().min(0),
  etiqueta: z.string().min(1).max(200),
});

export type ReferenciaCara = z.infer<typeof esquemaReferenciaCara>;

export const MAX_REFERENCIAS = 12;
export const esquemaReferencias = z.array(esquemaReferenciaCara).max(MAX_REFERENCIAS);

/** glTF (Y arriba) → producto (Z arriba). El motor hace (x, y, z) → (x, z, −y). */
export const aProducto = (p: Vec3): Vec3 => [p[0], -p[2], p[1]];

const NOMBRE_LADO: Record<Lado, { cara: string; canto: string }> = {
  arriba: { cara: "cara superior", canto: "canto superior" },
  abajo: { cara: "cara inferior", canto: "canto inferior" },
  frente: { cara: "cara frontal", canto: "canto frontal" },
  fondo: { cara: "cara trasera", canto: "canto trasero" },
  izquierda: { cara: "cara izquierda", canto: "canto izquierdo" },
  derecha: { cara: "cara derecha", canto: "canto derecho" },
};

/** Hacia dónde mira una normal del producto, si mira claramente hacia un eje. */
export function ladoDe(normal: Vec3): Lado | null {
  const [x, y, zz] = normal;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(zz);
  const m = Math.max(ax, ay, az);
  if (m < 0.97) return null;
  if (m === az) return zz > 0 ? "arriba" : "abajo";
  if (m === ax) return x > 0 ? "derecha" : "izquierda";
  return y > 0 ? "fondo" : "frente";
}

// `+ 0` quita el −0, que se colaría en la clave y en el texto.
const r1 = (n: number) => Math.round(n * 10) / 10 + 0;
const r3 = (n: number) => Math.round(n * 1000) / 1000 + 0;

/**
 * Las medidas de la cara en su plano, en el producto: si es horizontal, a lo
 * largo de X y su perpendicular; si no, a lo ancho y a lo alto (Z).
 */
function medidasEnPlano(puntos: Vec3[], normal: Vec3): { ancho: number; alto: number } {
  let u: Vec3;
  if (Math.abs(normal[2]) > 0.9) {
    u = unitario([1 - normal[0] * normal[0], -normal[0] * normal[1], -normal[0] * normal[2]]);
  } else {
    const arriba: Vec3 = unitario([-normal[2] * normal[0], -normal[2] * normal[1], 1 - normal[2] * normal[2]]);
    u = unitario(cruz(arriba, normal));
  }
  const v = unitario(cruz(normal, u));
  let [minU, maxU, minV, maxV] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const p of puntos) {
    const pu = punto(p, u);
    const pv = punto(p, v);
    minU = Math.min(minU, pu);
    maxU = Math.max(maxU, pu);
    minV = Math.min(minV, pv);
    maxV = Math.max(maxV, pv);
  }
  return { ancho: maxU - minU, alto: maxV - minV };
}

/**
 * La referencia que se manda al chat. `posiciones`/`indice` son los de la
 * geometría de donde salió la cara (para medirla).
 */
export function describirCara(
  cara: CaraMalla,
  posiciones: ArrayLike<number>,
  indice: ArrayLike<number> | null | undefined,
  pieza: { id: string | null; nombre: string; copia: number; de: number },
): ReferenciaCara {
  const puntos: Vec3[] = [];
  for (const t of cara.triangulos) {
    for (let k = 0; k < 3; k++) {
      const n = t * 3 + k;
      const v = indice ? indice[n] : n;
      puntos.push(aProducto([posiciones[v * 3], posiciones[v * 3 + 1], posiciones[v * 3 + 2]]));
    }
  }
  const normal = aProducto(cara.normal);
  const centro = aProducto(cara.centro);
  const lado = cara.curva ? null : ladoDe(normal);
  const { ancho, alto } = medidasEnPlano(puntos, normal);

  const nombreCara = cara.curva
    ? "canto curvo"
    : lado
      ? NOMBRE_LADO[lado][cara.tipo]
      : cara.tipo === "cara"
        ? "cara inclinada"
        : "canto inclinado";
  const nombrePieza = pieza.de > 1 ? `${pieza.nombre} (${pieza.copia} de ${pieza.de})` : pieza.nombre;

  return {
    clave: `${pieza.id ?? pieza.nombre}#${pieza.copia}:${cara.tipo}:${centro.map(r1).join(",")}`,
    pieza: pieza.id,
    nombrePieza: pieza.nombre,
    copia: pieza.copia,
    de: pieza.de,
    tipo: cara.tipo,
    curva: cara.curva,
    lado,
    normal: normal.map(r3) as Vec3,
    centro: centro.map(r1) as Vec3,
    ancho_mm: r1(ancho),
    alto_mm: r1(alto),
    area_mm2: Math.round(cara.area),
    etiqueta: `${nombrePieza} · ${nombreCara}`,
  };
}

const fmt = (n: number) => String(r1(n));
const tupla = (v: Vec3) => `(${v.map(fmt).join(", ")})`;

/** El bloque que se pega al mensaje de la persona para el modelo. */
export function referenciasATexto(referencias: readonly ReferenciaCara[]): string {
  if (!referencias.length) return "";
  const lineas = referencias.map((r, i) => {
    const pieza = r.pieza ? ` (pieza \`${r.pieza}\`${r.de > 1 ? `, copia ${r.copia} de ${r.de}` : ""})` : "";
    return (
      `${i + 1}. ${r.etiqueta}${pieza}: ${r.tipo}${r.curva ? " curvo" : ""}, ` +
      `${fmt(r.ancho_mm)} × ${fmt(r.alto_mm)} mm, área ${Math.round(r.area_mm2)} mm²; ` +
      `centro ${tupla(r.centro)}; normal ${tupla(r.normal.map((n) => Math.round(n * 100) / 100 + 0) as Vec3)}`
    );
  });
  return [
    "[Caras señaladas en el visor 3D — producto armado, mm, Z arriba, frente = −Y]",
    ...lineas,
  ].join("\n");
}

/** El mensaje de la persona tal como lo lee el modelo. */
export const mensajeConReferencias = (mensaje: string, referencias?: readonly ReferenciaCara[] | null) =>
  referencias?.length ? `${mensaje}\n\n${referenciasATexto(referencias)}` : mensaje;
