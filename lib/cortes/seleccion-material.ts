import { normalizar } from "../busqueda";
import { colorDe, medidaDe, type GrupoPlancha } from "./catalogo";

/**
 * La cascada Material → Color → Espesor con la que se elige una plancha.
 *
 * Un `GrupoPlancha` es un material en un color y un espesor. Aquí se parte el
 * catálogo en esos tres pasos: los colores que se ofrecen dependen del material
 * y los espesores, del material y el color. Sin dependencias de React ni de
 * servidor para poder probarlo.
 */

type Datos = Pick<GrupoPlancha, "material" | "variante" | "detalle" | "espesorMm">;

/** Lo que lleva elegido la persona. Cada paso depende del anterior. */
export interface SeleccionMaterial {
  material: string | null;
  color: string | null;
  espesorMm: number | null;
}

export const SIN_SELECCION: SeleccionMaterial = { material: null, color: null, espesorMm: null };

export interface OpcionMaterial {
  nombre: string;
  /** Cuántos colores distintos tiene. */
  colores: number;
}

export interface OpcionColor {
  nombre: string;
  /** Cuántos espesores distintos tiene en ese material. */
  espesores: number;
}

export interface OpcionEspesor {
  espesorMm: number;
  /** El grupo que resuelve este espesor. */
  grupo: GrupoPlancha;
  /** "122×183", "150×300": solo informativo. */
  medidas: string[];
}

const mismo = (a: string, b: string) => normalizar(a) === normalizar(b);
const alfabetico = (a: string, b: string) => a.localeCompare(b, "es");

/** Los materiales del catálogo, sin repetir y en orden alfabético. */
export function materialesDe(catalogo: readonly GrupoPlancha[]): OpcionMaterial[] {
  const porClave = new Map<string, { nombre: string; colores: Set<string> }>();
  for (const g of catalogo) {
    const clave = normalizar(g.material);
    const fila = porClave.get(clave) ?? { nombre: g.material, colores: new Set<string>() };
    fila.colores.add(normalizar(colorDe(g)));
    porClave.set(clave, fila);
  }
  return [...porClave.values()]
    .map((f) => ({ nombre: f.nombre, colores: f.colores.size }))
    .sort((a, b) => alfabetico(a.nombre, b.nombre));
}

/** Los colores que tiene un material. */
export function coloresDe(catalogo: readonly GrupoPlancha[], material: string | null): OpcionColor[] {
  if (!material) return [];
  const porClave = new Map<string, { nombre: string; espesores: Set<number> }>();
  for (const g of catalogo) {
    if (!mismo(g.material, material)) continue;
    const color = colorDe(g);
    const clave = normalizar(color);
    const fila = porClave.get(clave) ?? { nombre: color, espesores: new Set<number>() };
    fila.espesores.add(g.espesorMm);
    porClave.set(clave, fila);
  }
  return [...porClave.values()]
    .map((f) => ({ nombre: f.nombre, espesores: f.espesores.size }))
    .sort((a, b) => alfabetico(a.nombre, b.nombre));
}

/** Los espesores de un material en un color, de menor a mayor, cada uno con su grupo. */
export function espesoresDe(
  catalogo: readonly GrupoPlancha[],
  material: string | null,
  color: string | null,
): OpcionEspesor[] {
  if (!material || !color) return [];
  const porEspesor = new Map<number, OpcionEspesor>();
  for (const g of catalogo) {
    if (!mismo(g.material, material) || !mismo(colorDe(g), color)) continue;
    // Si el catálogo trae dos grupos con el mismo nombre, manda el primero.
    if (porEspesor.has(g.espesorMm)) continue;
    porEspesor.set(g.espesorMm, {
      espesorMm: g.espesorMm,
      grupo: g,
      medidas: g.formatos.filter((f) => f.activo).map(medidaDe),
    });
  }
  return [...porEspesor.values()].sort((a, b) => a.espesorMm - b.espesorMm);
}

/** El grupo que resuelve una selección completa, o `null` si falta algo o no existe. */
export function resolverGrupo(catalogo: readonly GrupoPlancha[], s: SeleccionMaterial): GrupoPlancha | null {
  if (s.espesorMm === null) return null;
  return espesoresDe(catalogo, s.material, s.color).find((e) => e.espesorMm === s.espesorMm)?.grupo ?? null;
}

/** La selección que corresponde a un grupo. */
export function seleccionDe(g: Datos): SeleccionMaterial {
  return { material: g.material, color: colorDe(g), espesorMm: g.espesorMm };
}

/**
 * Completa los pasos que solo tienen una opción: si el material tiene un solo
 * color se elige ese color, y si el color tiene un solo espesor, también.
 * Un paso que ya trae valor no se toca, y uno que no existe en el catálogo se
 * descarta junto con los de abajo.
 */
export function completarSeleccion(catalogo: readonly GrupoPlancha[], s: SeleccionMaterial): SeleccionMaterial {
  const material = s.material && materialesDe(catalogo).find((m) => mismo(m.nombre, s.material!))?.nombre;
  if (!material) return SIN_SELECCION;

  const colores = coloresDe(catalogo, material);
  const color = s.color
    ? colores.find((c) => mismo(c.nombre, s.color!))?.nombre
    : colores.length === 1
      ? colores[0].nombre
      : undefined;
  if (!color) return { material, color: null, espesorMm: null };

  const espesores = espesoresDe(catalogo, material, color);
  const espesorMm =
    s.espesorMm !== null
      ? espesores.find((e) => e.espesorMm === s.espesorMm)?.espesorMm
      : espesores.length === 1
        ? espesores[0].espesorMm
        : undefined;
  return { material, color, espesorMm: espesorMm ?? null };
}

/** Elegir un material: los pasos de abajo se reinician y los que tienen una sola opción se completan. */
export const elegirMaterial = (catalogo: readonly GrupoPlancha[], material: string) =>
  completarSeleccion(catalogo, { material, color: null, espesorMm: null });

/** Elegir un color del material vigente. */
export const elegirColor = (catalogo: readonly GrupoPlancha[], s: SeleccionMaterial, color: string) =>
  completarSeleccion(catalogo, { material: s.material, color, espesorMm: null });

/** Elegir un espesor del material y color vigentes. */
export const elegirEspesor = (catalogo: readonly GrupoPlancha[], s: SeleccionMaterial, espesorMm: number) =>
  completarSeleccion(catalogo, { ...s, espesorMm });

/** El paso que sigue sin valor, para abrirlo después de elegir el anterior. */
export function pasoPendiente(s: SeleccionMaterial): "material" | "color" | "espesor" | null {
  if (!s.material) return "material";
  if (!s.color) return "color";
  if (s.espesorMm === null) return "espesor";
  return null;
}
