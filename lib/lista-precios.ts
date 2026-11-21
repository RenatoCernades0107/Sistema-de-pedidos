/**
 * La lista de precios para el cliente: las planchas y los accesorios con precio,
 * ordenados en secciones listas para dibujar en el PDF.
 *
 * Sin dependencias de servidor: lo usan el route handler, el diálogo del
 * almacén y las pruebas.
 */

import {
  claveCategoria,
  claveMaterial,
  notasDe,
  type ConfigListaPrecios,
} from "./lista-precios-config";

export const DISENOS_LISTA = {
  clasico: { nombre: "Clásico", descripcion: "Como la lista de siempre: tablas con bordes y celdas unidas." },
  moderno: { nombre: "Moderno", descripcion: "Banda de color, tarjetas por material y filas alternadas." },
  compacto: { nombre: "Catálogo", descripcion: "A dos columnas, para que entre en menos hojas." },
} as const;

export type DisenoLista = keyof typeof DISENOS_LISTA;

export const esDiseno = (v: unknown): v is DisenoLista => typeof v === "string" && v in DISENOS_LISTA;

/** Lo que hace falta de una plancha para la lista. */
export interface PlanchaParaLista {
  material: string;
  color: string;
  espesorMm: number;
  anchoCm: number;
  largoCm: number;
  codigo: string;
  precio: number | null;
  activo: boolean;
}

/** Lo que hace falta de un accesorio para la lista. */
export interface AccesorioParaLista {
  categoriaId: string;
  nombre: string;
  codigo: string;
  precio: number | null;
  activo: boolean;
}

export interface FilaPlancha {
  /** "WHITE MOON". */
  color: string;
  /** La referencia del proveedor, si el color la trae entre paréntesis: "KP-460". */
  ref: string | null;
  codigo: string;
  precio: number;
}

/** Las filas de una misma medida y espesor: en el PDF comparten esas celdas. */
export interface BloquePlanchas {
  /** "0.76 × 3.68 m". */
  medida: string;
  /** "12 mm". */
  espesor: string;
  filas: FilaPlancha[];
}

interface SeccionBase {
  clave: string;
  titulo: string;
  notas: string[];
}

export interface SeccionPlanchas extends SeccionBase {
  tipo: "planchas";
  /** Si alguna fila trae referencia del proveedor (si no, esa columna no va). */
  conRef: boolean;
  bloques: BloquePlanchas[];
}

export interface SeccionAccesorios extends SeccionBase {
  tipo: "accesorios";
  filas: { nombre: string; codigo: string; precio: number }[];
}

export type SeccionLista = SeccionPlanchas | SeccionAccesorios;

export interface ListaPrecios {
  telefonos: string;
  notaPie: string;
  /** "2026-11-21": el día en Lima en que se generó. */
  fecha: string;
  secciones: SeccionLista[];
}

/** Lo que se eligió en el diálogo. `null`: todo. */
export interface SeleccionLista {
  materiales: string[] | null;
  categorias: string[] | null;
}

/** "White Moon (KP-460)" → { color: "WHITE MOON", ref: "KP-460" }. */
export function separarRef(color: string): { color: string; ref: string | null } {
  const m = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(color.trim());
  if (!m || !m[1]) return { color: color.trim().toUpperCase(), ref: null };
  return { color: m[1].trim().toUpperCase(), ref: m[2].trim() };
}

const metros = (cm: number) => String(+(cm / 100).toFixed(3));

/** "0.76 × 3.68 m". */
export const medidaEnMetros = (anchoCm: number, largoCm: number) => `${metros(anchoCm)} × ${metros(largoCm)} m`;

const espesor = (mm: number) => `${String(+mm.toFixed(2))} mm`;

const tienePrecio = (p: number | null): p is number => p !== null && Number.isFinite(p) && p > 0;

/** Los materiales que tienen al menos una plancha activa con precio, en el orden del catálogo. */
export function materialesConPrecio(planchas: PlanchaParaLista[]): string[] {
  const vistos: string[] = [];
  for (const p of planchas) if (p.activo && tienePrecio(p.precio) && !vistos.includes(p.material)) vistos.push(p.material);
  return vistos;
}

export function armarLista(
  datos: {
    planchas: PlanchaParaLista[];
    accesorios: AccesorioParaLista[];
    categorias: { id: string; nombre: string; orden: number }[];
  },
  seleccion: SeleccionLista,
  config: ConfigListaPrecios,
  fecha: string,
): ListaPrecios {
  const secciones: SeccionLista[] = [];
  const conf = (clave: string) => config.secciones[clave];

  /* Planchas: una sección por material, en el orden del catálogo. */
  for (const material of materialesConPrecio(datos.planchas)) {
    if (seleccion.materiales && !seleccion.materiales.includes(material)) continue;
    const clave = claveMaterial(material);
    const vistos = new Set<string>();
    const deMaterial = datos.planchas.filter((p) => {
      if (p.material !== material || !p.activo || !tienePrecio(p.precio) || vistos.has(p.codigo)) return false;
      vistos.add(p.codigo); // Un código compartido (varios colores, un producto) va una vez.
      return true;
    });

    // Bloques por medida y espesor: las medidas en el orden del catálogo y,
    // dentro de cada una, del espesor más delgado al más grueso.
    const bloques = new Map<string, { anchoCm: number; largoCm: number; espesorMm: number; filas: FilaPlancha[] }>();
    for (const p of deMaterial) {
      const k = `${p.anchoCm}x${p.largoCm}|${p.espesorMm}`;
      if (!bloques.has(k)) bloques.set(k, { anchoCm: p.anchoCm, largoCm: p.largoCm, espesorMm: p.espesorMm, filas: [] });
      bloques.get(k)!.filas.push({ ...separarRef(p.color), codigo: p.codigo, precio: p.precio! });
    }
    const ordenMedida = [...new Set([...bloques.values()].map((b) => `${b.anchoCm}x${b.largoCm}`))];
    const ordenados = [...bloques.values()].sort(
      (a, b) =>
        ordenMedida.indexOf(`${a.anchoCm}x${a.largoCm}`) - ordenMedida.indexOf(`${b.anchoCm}x${b.largoCm}`) ||
        a.espesorMm - b.espesorMm,
    );

    secciones.push({
      tipo: "planchas",
      clave,
      titulo: conf(clave)?.titulo || material,
      notas: notasDe(conf(clave)?.nota),
      conRef: deMaterial.some((p) => separarRef(p.color).ref !== null),
      bloques: ordenados.map((b) => ({
        medida: medidaEnMetros(b.anchoCm, b.largoCm),
        espesor: espesor(b.espesorMm),
        // Por precio, para que los iguales queden juntos y compartan la celda.
        filas: b.filas.map((f, i) => ({ f, i })).sort((x, y) => x.f.precio - y.f.precio || x.i - y.i).map((x) => x.f),
      })),
    });
  }

  /* Accesorios: una sección por categoría, en su orden. */
  for (const cat of [...datos.categorias].sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre))) {
    if (seleccion.categorias && !seleccion.categorias.includes(cat.id)) continue;
    const filas = datos.accesorios
      .filter((a) => a.categoriaId === cat.id && a.activo && tienePrecio(a.precio))
      .map((a) => ({ nombre: a.nombre, codigo: a.codigo, precio: a.precio! }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { numeric: true }));
    if (!filas.length) continue;
    const clave = claveCategoria(cat.id);
    secciones.push({ tipo: "accesorios", clave, titulo: conf(clave)?.titulo || cat.nombre, notas: notasDe(conf(clave)?.nota), filas });
  }

  return { telefonos: config.telefonos, notaPie: config.notaPie, fecha, secciones };
}

/** Filas consecutivas con el mismo precio: [inicio, cantidad]. Para unir la celda del precio. */
export function tramosDePrecio(filas: { precio: number }[]): [number, number][] {
  const tramos: [number, number][] = [];
  filas.forEach((f, i) => {
    const ultimo = tramos.at(-1);
    if (ultimo && filas[ultimo[0]].precio === f.precio) ultimo[1]++;
    else tramos.push([i, 1]);
  });
  return tramos;
}

/** "lista-de-precios-2026-11-21.pdf". */
export const nombreArchivoLista = (fecha: string) => `lista-de-precios-${fecha}.pdf`;
