/**
 * El corte conjunto de un proyecto: las piezas de todos sus diseños acomodadas
 * juntas en las planchas del catálogo, para perder menos material y cortar de una.
 *
 * Es lo puro: toma las piezas de cada diseño (ya generadas), les pone a cada una
 * el prefijo de su diseño (`d2__lateral`) para que no choquen —un `lateral` de
 * un diseño no es el de otro—, resuelve el material de cada copia con el de SU
 * diseño y deja el reparto en grupos de plancha con `planchasDeCopias`. El
 * mismo prefijo lo usa el DXF (`cad/motor/proyecto.py`), así que los ids de las
 * planchas que salen de aquí valen tal cual allá.
 *
 * Las copias de corte aparte (MDF…) quedan fuera de las planchas: se devuelven
 * en `corteAparte` para bajarlas como DXF suelto de su diseño.
 */

import type { GrupoPlancha } from "@/lib/cortes/catalogo";
import type { MaterialDiseno, ParametrosCad, PiezaCad } from "./tipos";
import {
  esCorteAparte,
  nodosDe,
  planchasDeCopias,
  resolverCopias,
  type GrupoDelDiseno,
  type MaterialesPorCopia,
  type PlanchasDeGrupo,
} from "./materiales";
import type { OrdenAcomodo, ResultadoAcomodo } from "./acomodo";

/** Lo que separa el diseño de la pieza en un id de proyecto: `d2__lateral`. */
export const SEPARADOR_REF = "__";

/** Tope del id de una pieza en el motor y en el sandbox. */
export const MAX_ID_PIEZA = 64;

/** Cuántos diseños entran en un corte conjunto (los mismos que crea el asistente de una vez). */
export const MAX_DISENOS_CORTE = 10;

/** La referencia corta de un diseño dentro del corte: `d1`, `d2`… (por su posición en el proyecto). */
export const refDeDiseno = (posicion: number) => `d${posicion + 1}`;

/** `d2__lateral`. Lanza si no cabe en el tope del motor. */
export function idDeProyecto(ref: string, id: string): string {
  const completo = `${ref}${SEPARADOR_REF}${id}`;
  if (completo.length > MAX_ID_PIEZA) {
    throw new Error(`La pieza «${id}» tiene un nombre demasiado largo para un corte conjunto (máximo ${MAX_ID_PIEZA - ref.length - SEPARADOR_REF.length} caracteres).`);
  }
  return completo;
}

/** Vuelve de `d2__lateral` a `{ ref: "d2", id: "lateral" }`. `null` si no tiene el prefijo. */
export function partirId(idPrefijado: string): { ref: string; id: string } | null {
  const i = idPrefijado.indexOf(SEPARADOR_REF);
  if (i <= 0) return null;
  return { ref: idPrefijado.slice(0, i), id: idPrefijado.slice(i + SEPARADOR_REF.length) };
}

/** Un diseño del proyecto tal como entra al corte. */
export type DisenoParaCorte = {
  ref: string;
  nombre: string;
  piezas: readonly PiezaCad[];
  /** El material del diseño; `null` si todavía no tiene. */
  material: MaterialDiseno | null;
  porCopia: MaterialesPorCopia;
  parametros: ParametrosCad;
};

/** Las piezas de un diseño con el prefijo de su ref en el id, en los nodos y en el nombre (para los mensajes). */
export function piezasDeDiseno(d: Pick<DisenoParaCorte, "ref" | "nombre" | "piezas">): PiezaCad[] {
  return d.piezas.map((p) => ({
    ...p,
    id: idDeProyecto(d.ref, p.id),
    nombre: `${d.nombre} › ${p.nombre}`,
    nodos: nodosDe(p).map((n) => idDeProyecto(d.ref, n)),
    ...(p.origen ? { origen: idDeProyecto(d.ref, p.origen) } : {}),
  }));
}

/** El material propio de cada copia con los nodos prefijados. */
const porCopiaDeDiseno = (d: Pick<DisenoParaCorte, "ref" | "porCopia">): MaterialesPorCopia =>
  Object.fromEntries(Object.entries(d.porCopia).map(([nodo, m]) => [idDeProyecto(d.ref, nodo), m]));

/** Las copias de una pieza que se cortan aparte, de un diseño. */
export type CorteAparteDePieza = {
  ref: string;
  /** El id de la pieza en SU diseño (sin prefijo). */
  piezaId: string;
  nombre: string;
  /** Qué copias son, de 1 a la cantidad de la pieza. */
  indices: number[];
  /** «MDF 12 mm», como lo nombró quien lo eligió (sin el espesor de la pieza, que va aparte). */
  material: string;
  espesorMm: number;
};

export type CorteConjunto = {
  /** Los grupos de plancha con su acomodo; los ids de pieza llevan el prefijo del diseño. */
  grupos: PlanchasDeGrupo[];
  corteAparte: CorteAparteDePieza[];
  problemas: string[];
  avisos: string[];
};

export function cortarProyecto(entrada: {
  disenos: readonly DisenoParaCorte[];
  catalogo: readonly GrupoPlancha[];
  corte: { kerfMm: number; margenMm: number };
  sugerencia?: {
    politica: OrdenAcomodo["politica"];
    costoDe?: (g: GrupoDelDiseno, r: ResultadoAcomodo) => number | null;
  };
  formatosElegidos?: Readonly<Record<string, string>>;
}): CorteConjunto {
  const { disenos, catalogo, corte } = entrada;
  const problemas: string[] = [];
  const copias = disenos.flatMap((d) => {
    const resueltas = resolverCopias(piezasDeDiseno(d), d.material, porCopiaDeDiseno(d), catalogo);
    if (resueltas.some((c) => c.material === null)) {
      problemas.push(`«${d.nombre}» no tiene material: elígelo en su pestaña Planchas.`);
    }
    return resueltas;
  });

  const r = planchasDeCopias(copias, { corte, sugerencia: entrada.sugerencia, formatosElegidos: entrada.formatosElegidos });
  problemas.push(...r.problemas);

  // Lo que se corta aparte, por diseño y pieza.
  const aparte = new Map<string, CorteAparteDePieza>();
  for (const c of copias.filter(esCorteAparte)) {
    const partido = partirId(c.pieza.id);
    if (!partido) continue;
    const clave = c.pieza.id;
    const previo = aparte.get(clave);
    if (previo) previo.indices.push(c.indice);
    else {
      aparte.set(clave, {
        ref: partido.ref,
        piezaId: partido.id,
        nombre: c.pieza.nombre.split(" › ").slice(1).join(" › ") || c.pieza.nombre,
        indices: [c.indice],
        material: c.material!.material,
        espesorMm: c.espesorMm,
      });
    }
  }
  return { grupos: r.grupos, corteAparte: [...aparte.values()], problemas, avisos: r.avisos };
}

/** `{ lateral: [1, 2] }` por diseño: lo que pide el DXF suelto (`solo`) de las copias de corte aparte. */
export function soloDeCorteAparte(corteAparte: readonly CorteAparteDePieza[], ref: string): Record<string, number[]> {
  const solo: Record<string, number[]> = {};
  for (const c of corteAparte) if (c.ref === ref) solo[c.piezaId] = [...c.indices].sort((a, b) => a - b);
  return solo;
}

/** Un grupo de plancha para mostrar: qué es, cuántas planchas y qué aporta cada diseño. */
export type ResumenGrupo = {
  clave: string;
  etiqueta: string;
  formato: { anchoMm: number; altoMm: number } | null;
  planchas: number;
  mermaPct: number | null;
  /** Copias que aporta cada diseño, por su ref. */
  aportes: { ref: string; copias: number }[];
  /** Lo que impide cortarlo, si algo. */
  problemas: string[];
};

export function resumirGrupos(grupos: readonly PlanchasDeGrupo[]): ResumenGrupo[] {
  return grupos.map((g) => {
    const porRef = new Map<string, number>();
    for (const p of g.piezas) {
      const ref = partirId(p.id)?.ref;
      if (ref) porRef.set(ref, (porRef.get(ref) ?? 0) + p.cantidad);
    }
    return {
      clave: g.clave,
      etiqueta: g.etiqueta,
      formato: g.acomodo ? { anchoMm: g.acomodo.anchoMm, altoMm: g.acomodo.altoMm } : null,
      planchas: g.acomodo?.planchas.length ?? 0,
      mermaPct: g.acomodo ? Math.round(g.acomodo.mermaPct * 10) / 10 : null,
      aportes: [...porRef].map(([ref, copias]) => ({ ref, copias })),
      problemas: g.problemas,
    };
  });
}
