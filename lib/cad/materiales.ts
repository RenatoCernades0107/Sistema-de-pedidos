/**
 * El material de cada copia de pieza y las planchas en que se corta.
 *
 * Espesor y material son independientes. Lo normal es un solo espesor (el
 * parámetro `espesor`) y un solo material (el que se elige en Planchas) para
 * todo el diseño, pero cada copia puede llevar otro espesor (lo aplica el motor:
 * `lib/cad/espesores.ts`) y otro material (guardado aparte, por nodo:
 * `MaterialesPorCopia`).
 *
 * Un **material** es la identidad del catálogo sin el espesor: material,
 * variante, detalle y, en los grupos de código compartido, el color. La
 * **plancha** de una copia es el grupo del catálogo con su material y su
 * espesor; si el catálogo no tiene esa combinación, es un problema.
 *
 * Puro: corre igual en el navegador y en el servidor.
 */

import { z } from "zod";
import { colorDe, espesorTexto, type GrupoPlancha } from "@/lib/cortes/catalogo";
import { acomodar, formatosDeGrupo, piezasQueNoEntran, type ResultadoAcomodo } from "./acomodo";
import type { CostoDiseno, EntradaCostoDiseno } from "./costo";
import type { MaterialDiseno, ParametrosCad, PiezaCad, PlanchaAcomodadaCad } from "./tipos";

/** Un material sin espesor. `color`: solo en grupos con código compartido entre colores. */
export interface MaterialRef {
  material: string;
  variante: string;
  detalle: string;
  color: string | null;
}

/** El material propio de cada copia, por nombre de nodo (`lateral_2`). */
export type MaterialesPorCopia = Record<string, MaterialRef>;

/** Lo que se guarda en `cad_diseno_versiones.materiales`. */
export interface MaterialesGuardados {
  porCopia: MaterialesPorCopia;
}

const texto = (max: number) => z.string().trim().max(max);
export const esquemaMaterialRef = z.object({
  material: texto(120).min(1),
  variante: texto(120),
  detalle: texto(120),
  color: texto(80).min(1).nullable(),
});
export const esquemaMaterialesGuardados = z.object({
  porCopia: z
    .record(z.string().regex(/^[a-z0-9_]{1,56}$/), esquemaMaterialRef)
    .refine((m) => Object.keys(m).length <= 500, "Hay demasiadas piezas con material propio."),
});

/** Lee lo guardado; lo que no tenga la forma esperada se descarta. */
export function leerMateriales(json: unknown): MaterialesPorCopia {
  const r = esquemaMaterialesGuardados.safeParse(json);
  return r.success ? r.data.porCopia : {};
}

export const materialDeGrupo = (
  g: Pick<GrupoPlancha, "material" | "variante" | "detalle">,
  color: string | null = null,
): MaterialRef => ({ material: g.material, variante: g.variante, detalle: g.detalle, color });

const igualTexto = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Mismo material, sin mirar el espesor. */
export function mismoMaterial(a: MaterialRef, b: MaterialRef): boolean {
  return (
    igualTexto(a.material, b.material) &&
    igualTexto(a.variante, b.variante) &&
    igualTexto(a.detalle, b.detalle) &&
    igualTexto(a.color ?? "", b.color ?? "")
  );
}

/** "Acrílico ECO · Rojo" (con el color elegido, si lo hay). */
export const nombreMaterial = (m: MaterialRef) => `${m.material} · ${m.color ?? colorDe(m)}`;

/** El color que se ve: el elegido o el del grupo. */
export const colorDeMaterial = (m: MaterialRef) => m.color ?? colorDe(m);

const mismoEspesor = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/** El grupo del catálogo de un material en un espesor. `null` si no existe. */
export function grupoPara<G extends GrupoPlancha>(ref: MaterialRef, espesorMm: number, catalogo: readonly G[]): G | null {
  return (
    catalogo.find(
      (g) =>
        mismoEspesor(g.espesorMm, espesorMm) &&
        igualTexto(g.material, ref.material) &&
        igualTexto(g.variante, ref.variante) &&
        igualTexto(g.detalle, ref.detalle),
    ) ?? null
  );
}

/** Los espesores en que el catálogo tiene un material. */
export function espesoresDeMaterial(ref: MaterialRef, catalogo: readonly GrupoPlancha[]): number[] {
  const espesores = catalogo
    .filter(
      (g) => igualTexto(g.material, ref.material) && igualTexto(g.variante, ref.variante) && igualTexto(g.detalle, ref.detalle),
    )
    .map((g) => g.espesorMm);
  return [...new Set(espesores)].sort((a, b) => a - b);
}

/** Los materiales distintos del catálogo (sin espesor), ordenados por nombre. */
export function materialesDelCatalogo(catalogo: readonly GrupoPlancha[]): (MaterialRef & { grupos: GrupoPlancha[] })[] {
  const salida: (MaterialRef & { grupos: GrupoPlancha[] })[] = [];
  for (const g of catalogo) {
    const ref = materialDeGrupo(g);
    const ya = salida.find((m) => mismoMaterial(m, ref));
    if (ya) ya.grupos.push(g);
    else salida.push({ ...ref, grupos: [g] });
  }
  return salida.sort((a, b) => nombreMaterial(a).localeCompare(nombreMaterial(b), "es"));
}

/* ── Copias ────────────────────────────────────────────────────────────────── */

/** Los nombres de nodo de las copias de una pieza (los del motor; si no los manda, los de siempre). */
export function nodosDe(p: Pick<PiezaCad, "id" | "cantidad" | "nodos">): string[] {
  if (p.nodos?.length === p.cantidad) return p.nodos;
  return p.cantidad === 1 ? [p.id] : Array.from({ length: p.cantidad }, (_, i) => `${p.id}_${i + 1}`);
}

/** Una copia de una pieza con su material y su plancha resueltos. */
export interface CopiaResuelta {
  pieza: PiezaCad;
  nodo: string;
  /** Qué copia de `pieza` es, de 1 a `pieza.cantidad` (la que espera el motor en el DXF). */
  indice: number;
  espesorMm: number;
  /** `null`: el diseño todavía no tiene material. */
  material: MaterialRef | null;
  /** El material es propio de la copia, no el del diseño. */
  propio: boolean;
  grupo: GrupoPlancha | null;
}

/**
 * El material y la plancha de cada copia. `porDefecto` es el material del
 * diseño (un grupo y, si lo pide, el color): de él se toma solo el material,
 * y cada copia busca la plancha de su espesor.
 */
export function resolverCopias(
  piezas: readonly PiezaCad[],
  porDefecto: MaterialDiseno | null,
  porCopia: MaterialesPorCopia,
  catalogo: readonly GrupoPlancha[],
): CopiaResuelta[] {
  const grupoDefecto = porDefecto ? (catalogo.find((g) => g.id === porDefecto.grupoPlanchaId) ?? null) : null;
  const refDefecto = grupoDefecto ? materialDeGrupo(grupoDefecto, porDefecto?.color ?? null) : null;
  return piezas.flatMap((pieza) =>
    nodosDe(pieza).map((nodo, i) => {
      const propio = porCopia[nodo] ?? null;
      const material = propio ?? refDefecto;
      return {
        pieza,
        nodo,
        indice: i + 1,
        espesorMm: pieza.espesor_mm,
        material,
        propio: propio !== null,
        grupo: material ? grupoPara(material, pieza.espesor_mm, catalogo) : null,
      };
    }),
  );
}

/** Una pieza del despiece dentro de un grupo: solo sus copias de ese grupo. */
export type PiezaDeGrupo = PiezaCad & { indices: number[] };

/** Las copias que van en un mismo grupo de plancha (material, color y espesor). */
export interface GrupoDelDiseno {
  clave: string;
  grupo: GrupoPlancha;
  color: string | null;
  espesorMm: number;
  /** «Acrílico ECO · Cristal · 3 mm», para la pantalla y el rótulo del DXF. */
  etiqueta: string;
  piezas: PiezaDeGrupo[];
  copias: number;
}

/** Agrupa las copias por plancha, en el orden en que aparecen. Las que no tienen plancha quedan fuera. */
export function agruparCopias(copias: readonly CopiaResuelta[]): GrupoDelDiseno[] {
  const grupos = new Map<string, GrupoDelDiseno>();
  for (const c of copias) {
    if (!c.grupo || !c.material) continue;
    const color = c.material.color;
    const clave = `${c.grupo.id}|${color ?? ""}`;
    let g = grupos.get(clave);
    if (!g) {
      g = {
        clave,
        grupo: c.grupo,
        color,
        espesorMm: c.grupo.espesorMm,
        etiqueta: `${c.grupo.material} · ${color ?? colorDe(c.grupo)} · ${espesorTexto(c.grupo.espesorMm)}`,
        piezas: [],
        copias: 0,
      };
      grupos.set(clave, g);
    }
    let p = g.piezas.find((x) => x.id === c.pieza.id);
    if (!p) {
      p = { ...c.pieza, cantidad: 0, indices: [] };
      g.piezas.push(p);
    }
    p.cantidad++;
    p.indices.push(c.indice);
    g.copias++;
  }
  return [...grupos.values()];
}

/* ── Planchas ──────────────────────────────────────────────────────────────── */

/** Un grupo de plancha con su acomodo. */
export interface PlanchasDeGrupo extends GrupoDelDiseno {
  acomodo: ResultadoAcomodo | null;
  /** Lo que impide cortar este grupo (sin formatos, piezas que no entran). */
  problemas: string[];
}

export interface PlanchasDelDiseno {
  grupos: PlanchasDeGrupo[];
  copias: CopiaResuelta[];
  /** Todo lo que impide cortar el diseño, ya en frases. Vacío: todo bien. */
  problemas: string[];
}

/** El parámetro `espesor` de las plantillas. */
const PARAMETRO_ESPESOR = "espesor";

function nombreCopia(c: CopiaResuelta): string {
  const n = /_(\d+)$/.exec(c.nodo);
  return n && c.nodo !== c.pieza.id ? `«${c.pieza.nombre}» (copia ${n[1]})` : `«${c.pieza.nombre}»`;
}

/**
 * El diseño repartido en sus grupos de plancha, cada uno acomodado en su mejor
 * formato, y lo que impide cortarlo. Sin material del diseño ni propios, no
 * hay grupos ni problemas: falta elegirlo.
 */
export function planchasDelDiseno(entrada: {
  catalogo: readonly GrupoPlancha[];
  porDefecto: MaterialDiseno | null;
  porCopia: MaterialesPorCopia;
  parametros: ParametrosCad;
  piezas: readonly PiezaCad[] | undefined;
  corte: { kerfMm: number; margenMm: number };
}): PlanchasDelDiseno {
  const { catalogo, porDefecto, porCopia, parametros, corte } = entrada;
  const problemas: string[] = [];
  const grupoDefecto = porDefecto ? (catalogo.find((g) => g.id === porDefecto.grupoPlanchaId) ?? null) : null;

  // El espesor del diseño tiene que ser el de la plancha elegida para el diseño.
  const espesor = parametros[PARAMETRO_ESPESOR];
  if (grupoDefecto && typeof espesor === "number" && !mismoEspesor(espesor, grupoDefecto.espesorMm)) {
    problemas.push(
      `El diseño tiene ${espesor} mm de espesor, pero la plancha elegida es de ${grupoDefecto.espesorMm} mm.`,
    );
  }

  const copias = resolverCopias(entrada.piezas ?? [], porDefecto, porCopia, catalogo);
  const sinPlancha = new Map<string, string[]>();
  for (const c of copias) {
    if (!c.material || c.grupo) continue;
    const clave = `${nombreMaterial(c.material)} de ${espesorTexto(c.espesorMm)}`;
    sinPlancha.set(clave, [...(sinPlancha.get(clave) ?? []), nombreCopia(c)]);
  }
  for (const [material, piezas] of sinPlancha) {
    problemas.push(`El catálogo no tiene ${material}: ${piezas.join(", ")}. Elige otro material o espesor.`);
  }

  const varios = new Set(copias.filter((c) => c.grupo).map((c) => `${c.grupo!.id}|${c.material?.color ?? ""}`)).size > 1;
  const grupos = agruparCopias(copias).map((g): PlanchasDeGrupo => {
    const propios: string[] = [];
    const formatos = formatosDeGrupo(g.grupo);
    const opciones = { rotable: g.grupo.rotable, kerfMm: corte.kerfMm, margenMm: corte.margenMm };
    const prefijo = varios ? `En ${g.etiqueta}: ` : "";
    if (formatos.length === 0) {
      propios.push(`${prefijo}el material no tiene formatos de plancha activos.`);
      return { ...g, acomodo: null, problemas: propios };
    }
    for (const p of piezasQueNoEntran(g.piezas, formatos, opciones)) {
      propios.push(
        `${prefijo}«${p.nombre}» (${Math.round(p.ancho_mm)} × ${Math.round(p.alto_mm)} mm) no entra en ninguna plancha de este material${g.grupo.rotable ? "" : " (no se puede girar)"}.`,
      );
    }
    return { ...g, acomodo: acomodar(g.piezas, formatos, opciones), problemas: propios };
  });
  for (const g of grupos) problemas.push(...g.problemas);
  return { grupos, copias, problemas };
}

/** Las planchas de todos los grupos para `POST /dxf/planchas`, cada una con su rótulo. */
export function aPlanchasMotorDeGrupos(
  grupos: readonly Pick<PlanchasDeGrupo, "acomodo" | "etiqueta">[],
  aPlanchas: (a: ResultadoAcomodo) => PlanchaAcomodadaCad[],
): PlanchaAcomodadaCad[] {
  return grupos.flatMap((g) => (g.acomodo ? aPlanchas(g.acomodo).map((p) => ({ ...p, etiqueta: g.etiqueta })) : []));
}

/* ── Lo que se guarda con la versión ───────────────────────────────────────── */

/** Un grupo del acomodo guardado. */
export type AcomodoGrupoGuardado = ResultadoAcomodo & {
  grupoPlanchaId: string;
  color: string | null;
  espesorMm: number;
  etiqueta: string;
};

/**
 * La foto del acomodo que se guarda con la versión (`cad_diseno_versiones.acomodo`).
 * `areaPiezasMm2` es el total de todos los grupos (lo lee la cotización).
 */
export interface AcomodoGuardado {
  version: 2;
  kerfMm: number;
  areaPiezasMm2: number;
  grupos: AcomodoGrupoGuardado[];
}

export function acomodoParaGuardar(grupos: readonly PlanchasDeGrupo[], kerfMm: number): AcomodoGuardado | null {
  const conAcomodo = grupos.filter((g): g is PlanchasDeGrupo & { acomodo: ResultadoAcomodo } => g.acomodo !== null);
  if (conAcomodo.length === 0) return null;
  return {
    version: 2,
    kerfMm,
    areaPiezasMm2: conAcomodo.reduce((s, g) => s + g.acomodo.areaPiezasMm2, 0),
    grupos: conAcomodo.map((g) => ({
      ...g.acomodo,
      grupoPlanchaId: g.grupo.id,
      color: g.color,
      espesorMm: g.espesorMm,
      etiqueta: g.etiqueta,
    })),
  };
}

/**
 * Lee el acomodo guardado: el de ahora (`version: 2`, por grupos) o el de antes
 * (un solo `ResultadoAcomodo` con `kerfMm`), que pasa a ser un grupo. `null`
 * si no hay planchas que leer.
 */
export function leerAcomodoGuardado(
  json: unknown,
): { kerfMm: number | null; grupos: (ResultadoAcomodo & { etiqueta?: string })[] } | null {
  if (!json || typeof json !== "object") return null;
  const a = json as Record<string, unknown>;
  const kerf = typeof a.kerfMm === "number" ? a.kerfMm : null;
  const valido = (g: unknown): g is ResultadoAcomodo =>
    !!g && typeof g === "object" && Array.isArray((g as { planchas?: unknown }).planchas) && (g as ResultadoAcomodo).planchas.length > 0;
  if (a.version === 2 && Array.isArray(a.grupos)) {
    const grupos = a.grupos.filter(valido);
    return grupos.length ? { kerfMm: kerf, grupos } : null;
  }
  return valido(a) ? { kerfMm: kerf, grupos: [a] } : null;
}

/* ── Costo ─────────────────────────────────────────────────────────────────── */

export interface CostoPorGrupos {
  grupos: { etiqueta: string; costo: CostoDiseno | null }[];
  planchas: number;
  material: number;
  minutosLaser: number;
  servicio: number;
  total: number;
  problema: string | null;
}

/**
 * El costo de todos los grupos, sumado. Cada grupo se calcula con `costo` (el
 * de `lib/cad/costo.ts`); el redondeo al sol, si la configuración lo pide, se
 * hace una sola vez sobre la suma. `null` si ningún grupo tiene costo.
 */
export function costoPorGrupos(
  grupos: readonly PlanchasDeGrupo[],
  costo: (e: EntradaCostoDiseno) => CostoDiseno | null,
  base: Pick<EntradaCostoDiseno, "precios" | "config">,
): CostoPorGrupos | null {
  const porGrupo = grupos.map((g) => ({
    etiqueta: g.etiqueta,
    costo: costo({ ...base, piezas: g.piezas, grupo: g.grupo, acomodo: g.acomodo }),
  }));
  const con = porGrupo.filter((g): g is { etiqueta: string; costo: CostoDiseno } => g.costo !== null);
  if (con.length === 0) return null;
  if (con.length === 1 && porGrupo.length === 1) {
    const c = con[0].costo;
    return { grupos: porGrupo, ...c, problema: c.problema };
  }
  const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  const material = r2(con.reduce((s, g) => s + g.costo.material, 0));
  // Cada grupo trae su total ya redondeado: se vuelve al servicio sin redondear.
  const servicioBruto = con.reduce((s, g) => s + g.costo.servicioBruto, 0);
  const suma = material + servicioBruto;
  const total = base.config.cobro.redondearAlSol ? Math.ceil(suma - 1e-9) : r2(suma);
  const sinCosto = porGrupo.find((g) => g.costo === null);
  return {
    grupos: porGrupo,
    planchas: con.reduce((s, g) => s + g.costo.planchas, 0),
    material,
    minutosLaser: con.reduce((s, g) => s + g.costo.minutosLaser, 0),
    servicio: r2(total - material),
    total: r2(total),
    problema: sinCosto
      ? `No se pudo calcular el costo de ${sinCosto.etiqueta}: el total está incompleto.`
      : (con.find((g) => g.costo.problema)?.costo.problema ?? null),
  };
}
