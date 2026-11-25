/**
 * El diseño acomodado en planchas del catálogo: une el despiece del motor CAD
 * (`PiezaCad`, en mm) con el optimizador de cortes (`lib/cortes/optimizador.ts`).
 *
 * Se empaqueta por caja envolvente: cada copia de cada pieza es un rectángulo de
 * `ancho_mm × alto_mm`. El optimizador no sabe de unidades, así que se le pasan
 * milímetros directamente; el catálogo guarda centímetros y se convierte aquí,
 * en `formatosDeGrupo`.
 *
 * Puro: corre igual en el navegador y en el servidor.
 */

import { empaquetar, entraSola, type Pieza } from "@/lib/cortes/optimizador";
import type { GrupoPlancha } from "@/lib/cortes/catalogo";
import type { PoliticaSugerencia } from "@/lib/cortes/config";
import type { ParametrosCad, PiezaCad, PlanchaAcomodadaCad } from "./tipos";

/** Un formato de plancha, en mm: `ancho` en X, `alto` (el largo del catálogo) en Y. */
export interface FormatoAcomodo {
  id: string;
  anchoMm: number;
  altoMm: number;
}

/** Una copia de una pieza ya colocada. Origen arriba a la izquierda, Y hacia abajo (como el SVG). */
export interface PiezaColocada {
  id: string;
  indice: number;
  xMm: number;
  yMm: number;
  /** Medidas tal como quedó colocada (giradas si `rotada`). */
  anchoMm: number;
  altoMm: number;
  rotada: boolean;
}

export interface PlanchaUsada {
  anchoMm: number;
  altoMm: number;
  piezas: PiezaColocada[];
  areaUsadaMm2: number;
  usoPct: number;
  /** El rectángulo libre más grande que queda: el retazo que vuelve al almacén. */
  mayorRetazo: { anchoMm: number; altoMm: number } | null;
}

export interface ResultadoAcomodo {
  formatoId: string;
  anchoMm: number;
  altoMm: number;
  planchas: PlanchaUsada[];
  /** Copias que no entran en el formato elegido. */
  noCaben: { id: string; indice: number }[];
  areaPiezasMm2: number;
  areaPlanchasMm2: number;
  /** Lo que se pierde de las planchas usadas, en %. */
  mermaPct: number;
}

export interface OpcionesAcomodo {
  /** Si las piezas se pueden girar 90° (`grupos_plancha.rotable`). */
  rotable: boolean;
  kerfMm?: number;
  margenMm?: number;
}

/** Los formatos activos de un grupo del catálogo, de cm a mm. */
export function formatosDeGrupo(grupo: Pick<GrupoPlancha, "formatos">): FormatoAcomodo[] {
  return grupo.formatos
    .filter((f) => f.activo)
    .map((f) => ({ id: f.id, anchoMm: f.anchoCm * 10, altoMm: f.largoCm * 10 }));
}

const clave = (id: string, indice: number) => `${id}#${indice}`;

function deClave(k: string): { id: string; indice: number } {
  const i = k.lastIndexOf("#");
  return { id: k.slice(0, i), indice: Number(k.slice(i + 1)) };
}

/**
 * Una pieza para acomodar. `indices`: qué copias de la pieza son (las de un
 * grupo de plancha cuando las copias van en materiales o espesores distintos);
 * sin él, de la 1 a `cantidad`.
 */
export type PiezaAcomodo = PiezaCad & { indices?: number[] };

/** Cada copia de cada pieza como un rectángulo del optimizador. */
function copias(piezas: PiezaAcomodo[], rotable: boolean): Pieza[] {
  return piezas.flatMap((p) =>
    Array.from({ length: p.cantidad }, (_, i) => ({
      id: clave(p.id, p.indices?.[i] ?? i + 1),
      ancho: p.ancho_mm,
      alto: p.alto_mm,
      rotable,
    })),
  );
}

/**
 * Las piezas que no entran solas en ninguno de los formatos (ni giradas, si el
 * grupo es rotable). Vacío: todo cabe en algún formato.
 */
export function piezasQueNoEntran(
  piezas: PiezaCad[],
  formatos: FormatoAcomodo[],
  opciones: OpcionesAcomodo,
): PiezaCad[] {
  const margen = 2 * (opciones.margenMm ?? 0);
  return piezas.filter(
    (p) =>
      !formatos.some((f) =>
        entraSola(
          { id: p.id, ancho: p.ancho_mm, alto: p.alto_mm, rotable: opciones.rotable },
          f.anchoMm - margen,
          f.altoMm - margen,
          opciones.rotable,
        ),
      ),
  );
}

/** Acomoda en un formato concreto. */
export function acomodarEnFormato(
  piezas: PiezaAcomodo[],
  formato: FormatoAcomodo,
  opciones: OpcionesAcomodo,
): ResultadoAcomodo {
  const r = empaquetar(formato.anchoMm, formato.altoMm, copias(piezas, opciones.rotable), {
    rotar: opciones.rotable,
    kerf: opciones.kerfMm ?? 0,
    margen: opciones.margenMm ?? 0,
  });

  const planchas: PlanchaUsada[] = r.planchas.map((p) => {
    const colocadas: PiezaColocada[] = [];
    let retazo: { anchoMm: number; altoMm: number } | null = null;
    for (const panel of p.paneles) {
      const w = panel.x2 - panel.x1;
      const h = panel.y2 - panel.y1;
      if (panel.libre || !panel.piezaId) {
        if (w > 0 && h > 0 && (!retazo || w * h > retazo.anchoMm * retazo.altoMm)) {
          retazo = { anchoMm: w, altoMm: h };
        }
        continue;
      }
      const { id, indice } = deClave(panel.piezaId);
      colocadas.push({ id, indice, xMm: panel.x1, yMm: panel.y1, anchoMm: w, altoMm: h, rotada: !!panel.rotada });
    }
    return {
      anchoMm: p.ancho,
      altoMm: p.alto,
      piezas: colocadas,
      areaUsadaMm2: p.areaUsada,
      usoPct: p.usoPct,
      mayorRetazo: retazo,
    };
  });

  const areaPiezasMm2 = planchas.reduce((s, p) => s + p.areaUsadaMm2, 0);
  const areaPlanchasMm2 = planchas.length * formato.anchoMm * formato.altoMm;
  return {
    formatoId: formato.id,
    anchoMm: formato.anchoMm,
    altoMm: formato.altoMm,
    planchas,
    noCaben: r.noCaben.map((p) => deClave(p.id)),
    areaPiezasMm2,
    areaPlanchasMm2,
    mermaPct: areaPlanchasMm2 > 0 ? (1 - areaPiezasMm2 / areaPlanchasMm2) * 100 : 0,
  };
}

/** Cómo se escoge el formato: la política de Configuración y, si la hay, la elección a mano. */
export interface OrdenAcomodo {
  politica: PoliticaSugerencia;
  /**
   * Lo que cuesta cortar con ese acomodo. Sin ella (o sin precio), "precio" y
   * "promedio" se quedan con la merma.
   */
  costoDe?: (r: ResultadoAcomodo) => number | null;
  /** El formato que eligió quien arma el diseño. Si ya no sirve, manda la política. */
  formatoId?: string | null;
}

/** El puesto (0 = mejor) de cada acomodo según un valor; los empatados comparten puesto. */
function puestos(rs: ResultadoAcomodo[], valor: (r: ResultadoAcomodo) => number): Map<ResultadoAcomodo, number> {
  const orden = [...new Set(rs.map(valor))].sort((a, b) => a - b);
  return new Map(rs.map((r) => [r, orden.indexOf(valor(r))]));
}

/**
 * Cada formato con el diseño acomodado, del más conveniente al menos. Siempre
 * van primero los que dejan menos copias fuera. Entre ellos manda la política:
 *  - "merma" (y, sin precios, "precio" y "promedio"): el que gasta menos área de
 *    plancha y, a igualdad, abre menos planchas.
 *  - "precio": el que menos cuesta.
 *  - "promedio": el mejor promedio entre su puesto en precio y en merma.
 *  - "tamano": la plancha más chica.
 */
export function compararAcomodos(
  piezas: PiezaAcomodo[],
  formatos: FormatoAcomodo[],
  opciones: OpcionesAcomodo,
  orden: Pick<OrdenAcomodo, "politica" | "costoDe"> = { politica: "merma" },
): ResultadoAcomodo[] {
  const todos = formatos.map((f) => acomodarEnFormato(piezas, f, opciones));
  const costos = new Map(todos.map((r) => [r, orden.costoDe?.(r) ?? null]));
  const conPrecio = todos.length > 0 && todos.every((r) => costos.get(r) !== null);
  const costo = (r: ResultadoAcomodo) => costos.get(r) ?? 0;
  const porPrecio = puestos(todos, costo);
  const porMerma = puestos(todos, (r) => r.areaPlanchasMm2);
  const promedio = (r: ResultadoAcomodo) => ((porPrecio.get(r) ?? 0) + (porMerma.get(r) ?? 0)) / 2;
  const merma = (a: ResultadoAcomodo, b: ResultadoAcomodo) =>
    a.areaPlanchasMm2 - b.areaPlanchasMm2 || a.planchas.length - b.planchas.length;
  const area = (r: ResultadoAcomodo) => r.anchoMm * r.altoMm;
  const politica = conPrecio ? orden.politica : orden.politica === "tamano" ? "tamano" : "merma";

  return todos.sort((a, b) => {
    const fuera = a.noCaben.length - b.noCaben.length;
    if (fuera) return fuera;
    switch (politica) {
      case "precio":
        return costo(a) - costo(b) || merma(a, b);
      case "promedio":
        return promedio(a) - promedio(b) || costo(a) - costo(b) || merma(a, b);
      case "tamano":
        return area(a) - area(b) || merma(a, b);
      default:
        return merma(a, b);
    }
  });
}

/**
 * El mejor formato para el diseño según la política (por defecto, el que menos
 * plancha gasta). Con `formatoId`, ese formato si deja tantas copias fuera como
 * el mejor. `null` sin formatos.
 */
export function acomodar(
  piezas: PiezaAcomodo[],
  formatos: FormatoAcomodo[],
  opciones: OpcionesAcomodo,
  orden?: OrdenAcomodo,
): ResultadoAcomodo | null {
  const ordenados = compararAcomodos(piezas, formatos, opciones, orden);
  const mejor = ordenados[0] ?? null;
  if (!mejor || !orden?.formatoId) return mejor;
  const elegido = ordenados.find((r) => r.formatoId === orden.formatoId);
  return elegido && elegido.noCaben.length <= mejor.noCaben.length ? elegido : mejor;
}

/**
 * Lo que recibe `POST /dxf/planchas`: el motor pone el origen abajo a la
 * izquierda con Y hacia arriba, y la esquina que pide es la inferior izquierda.
 */
export function aPlanchasMotor(r: ResultadoAcomodo): PlanchaAcomodadaCad[] {
  return r.planchas.map((p) => ({
    ancho_mm: p.anchoMm,
    alto_mm: p.altoMm,
    piezas: p.piezas.map((c) => ({
      id: c.id,
      indice: c.indice,
      x_mm: c.xMm,
      y_mm: p.altoMm - (c.yMm + c.altoMm),
      rotada: c.rotada,
    })),
  }));
}

/* ── Material y espesor ────────────────────────────────────────────────────── */

/** El parámetro de las plantillas que lleva el espesor, en mm. */
export const PARAMETRO_ESPESOR = "espesor";

/**
 * Qué no cuadra entre el diseño y el grupo elegido: el parámetro `espesor` o el
 * espesor de alguna pieza distinto al de la plancha. `null` si todo cuadra.
 */
export function problemaDeEspesor(
  parametros: ParametrosCad,
  piezas: PiezaCad[] | undefined,
  grupo: Pick<GrupoPlancha, "espesorMm">,
): string | null {
  const iguales = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  const valor = parametros[PARAMETRO_ESPESOR];
  if (typeof valor === "number" && !iguales(valor, grupo.espesorMm)) {
    return `El diseño tiene ${valor} mm de espesor, pero la plancha elegida es de ${grupo.espesorMm} mm.`;
  }
  const distinta = piezas?.find((p) => !iguales(p.espesor_mm, grupo.espesorMm));
  if (distinta) {
    return `La pieza «${distinta.nombre}» es de ${distinta.espesor_mm} mm y la plancha de ${grupo.espesorMm} mm.`;
  }
  return null;
}

/**
 * El acomodo de un despiece en un grupo y lo que impide cortarlo ahí (espesor
 * distinto, piezas que no entran en ningún formato). Lo usa el asistente al
 * elegir material y al calcular el costo; la pantalla hace lo mismo en
 * `components/disenos/diseno-contexto.tsx`.
 */
export function planchasDeDiseno(
  grupo: Pick<GrupoPlancha, "formatos" | "espesorMm" | "rotable">,
  parametros: ParametrosCad,
  piezas: PiezaCad[] | undefined,
  corte: { kerfMm: number; margenMm: number },
): { acomodo: ResultadoAcomodo | null; problemas: string[]; piezasFuera: PiezaCad[] } {
  const problemas: string[] = [];
  const espesor = problemaDeEspesor(parametros, piezas, grupo);
  if (espesor) problemas.push(espesor);
  if (!piezas?.length) return { acomodo: null, problemas, piezasFuera: [] };

  const formatos = formatosDeGrupo(grupo);
  const opciones = { rotable: grupo.rotable, kerfMm: corte.kerfMm, margenMm: corte.margenMm };
  if (formatos.length === 0) {
    problemas.push("El material elegido no tiene formatos de plancha activos.");
    return { acomodo: null, problemas, piezasFuera: [] };
  }
  const piezasFuera = piezasQueNoEntran(piezas, formatos, opciones);
  for (const p of piezasFuera) {
    problemas.push(
      `«${p.nombre}» (${Math.round(p.ancho_mm)} × ${Math.round(p.alto_mm)} mm) no entra en ninguna plancha de este material${grupo.rotable ? "" : " (no se puede girar)"}.`,
    );
  }
  return { acomodo: acomodar(piezas, formatos, opciones), problemas, piezasFuera };
}
