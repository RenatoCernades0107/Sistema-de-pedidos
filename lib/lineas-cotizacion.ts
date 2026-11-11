/**
 * Las líneas de una cotización mientras se arma, en el navegador.
 *
 * Funciones puras sobre un arreglo: el formulario las usa con `useState` y las
 * pruebas sin React. La regla que más se nota al registrar: agregar otra vez el
 * mismo producto suma uno a su línea, salvo que esa línea ya tenga un detalle
 * (medidas): la misma plancha con otro corte es otra línea.
 *
 * Hay dos clases de línea: un producto de Odoo tal cual, y un corte a medida,
 * que no existe en Odoo y trae su cálculo (`lib/cortes/`).
 */

import type { CalculoCorte, Modalidad, PiezaPedida } from "./cortes/calcular";

export interface ProductoElegible {
  id: number;
  nombre: string;
  codigo: string | null;
  unidad: string | null;
  precio: number;
}

export interface LineaCotizacion {
  tipo?: undefined;
  /** Identidad de la línea en pantalla. El producto se puede repetir; esto no. */
  clave: string;
  productoId: number;
  nombre: string;
  codigo: string | null;
  unidad: string | null;
  cantidad: number;
  precioUnitario: number;
  /** Medidas, acabado. Viaja a la descripción de la línea en Odoo. */
  descripcion: string;
}

/** Un corte a medida: piezas que salen de planchas de un material. */
export interface LineaCorte {
  tipo: "corte";
  clave: string;
  /** El grupo del catálogo de planchas: material, color y espesor. */
  grupoId: string;
  material: string;
  /** El color con que se muestra y se guarda; si el código es de varios, el que se pidió. */
  color: string;
  espesorMm: number;
  rotable: boolean;
  modalidad: Modalidad;
  piezas: PiezaPedida[];
  /**
   * El cálculo sobre el formato elegido. Es lo que se enseña mientras se arma;
   * al guardar, el servidor lo rehace con sus propios precios.
   */
  calculo: CalculoCorte;
}

export type Linea = LineaCotizacion | LineaCorte;

export const esCorte = (l: Linea): l is LineaCorte => l.tipo === "corte";

/** Redondeo a céntimos sin el clásico 1.005 → 1.00. */
export const redondear2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const subtotalDe = (l: Pick<LineaCotizacion, "cantidad" | "precioUnitario">) =>
  redondear2((Number(l.cantidad) || 0) * (Number(l.precioUnitario) || 0));

/** Lo que suma una línea, sea producto o corte. */
export const importeDe = (l: Linea) => (esCorte(l) ? l.calculo.total : subtotalDe(l));

/**
 * La suma de las líneas. Es referencial: los impuestos y la lista de precios los
 * aplica Odoo al crear la cotización, y el total que vale es el que devuelve.
 */
export const totalReferencial = (lineas: Linea[]) =>
  redondear2(lineas.reduce((suma, l) => suma + importeDe(l), 0));

let contador = 0;
const nuevaClave = () => `l${Date.now().toString(36)}${(contador++).toString(36)}`;

export function agregarProducto<L extends Linea>(
  lineas: L[],
  producto: ProductoElegible,
  clave: () => string = nuevaClave,
): { lineas: (L | LineaCotizacion)[]; clave: string; sumada: boolean } {
  const existente = lineas.find(
    (l): l is L & LineaCotizacion => !esCorte(l) && l.productoId === producto.id && !l.descripcion.trim(),
  );
  if (existente) {
    return {
      lineas: lineas.map((l) =>
        !esCorte(l) && l.clave === existente.clave ? { ...l, cantidad: redondear3(l.cantidad + 1) } : l,
      ),
      clave: existente.clave,
      sumada: true,
    };
  }

  const nueva: LineaCotizacion = {
    clave: clave(),
    productoId: producto.id,
    nombre: producto.nombre,
    codigo: producto.codigo,
    unidad: producto.unidad,
    cantidad: 1,
    precioUnitario: redondear2(producto.precio),
    descripcion: "",
  };
  return { lineas: [...lineas, nueva], clave: nueva.clave, sumada: false };
}

export function actualizarLinea<L extends Linea>(
  lineas: L[],
  clave: string,
  cambios: Partial<Pick<LineaCotizacion, "cantidad" | "precioUnitario" | "descripcion">>,
): L[] {
  return lineas.map((l) => (!esCorte(l) && l.clave === clave ? { ...l, ...cambios } : l));
}

export const quitarLinea = <L extends Linea>(lineas: L[], clave: string) =>
  lineas.filter((l) => l.clave !== clave);

/** Sube o baja la cantidad con los botones ±, sin bajar de 1 ni dejar decimales sucios. */
export function cambiarCantidad<L extends Linea>(lineas: L[], clave: string, delta: number): L[] {
  return lineas.map((l) =>
    !esCorte(l) && l.clave === clave ? { ...l, cantidad: Math.max(1, redondear3(l.cantidad + delta)) } : l,
  );
}

/**
 * Agrega un corte o, si trae la clave de uno que ya estaba, lo reemplaza en su
 * sitio: editar un corte no lo manda al final de la lista.
 */
export function ponerCorte(
  lineas: Linea[],
  corte: Omit<LineaCorte, "tipo" | "clave"> & { clave?: string },
  clave: () => string = nuevaClave,
): { lineas: Linea[]; clave: string } {
  const existente = corte.clave && lineas.some((l) => l.clave === corte.clave) ? corte.clave : null;
  const nueva: LineaCorte = { ...corte, tipo: "corte", clave: existente ?? clave() };
  return {
    lineas: existente ? lineas.map((l) => (l.clave === existente ? nueva : l)) : [...lineas, nueva],
    clave: nueva.clave,
  };
}

const redondear3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

/** Lo que falta para poder crear, en palabras. `null` si no falta nada. */
export function problemaDeLineas(lineas: Linea[]): string | null {
  if (lineas.length === 0) return "Agrega al menos un producto.";
  for (const l of lineas) {
    if (esCorte(l)) {
      if (l.calculo.problema) return l.calculo.problema;
      continue;
    }
    if (!(Number(l.cantidad) > 0)) return `La cantidad de ${l.nombre} tiene que ser mayor que cero.`;
    if (!(Number(l.precioUnitario) >= 0)) return `El precio de ${l.nombre} no puede ser negativo.`;
  }
  return null;
}
