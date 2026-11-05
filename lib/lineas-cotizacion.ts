/**
 * Las líneas de una cotización mientras se arma, en el navegador.
 *
 * Funciones puras sobre un arreglo: el formulario las usa con `useState` y las
 * pruebas sin React. La regla que más se nota al registrar: agregar otra vez el
 * mismo producto suma uno a su línea, salvo que esa línea ya tenga un detalle
 * (medidas): la misma plancha con otro corte es otra línea.
 */

export interface ProductoElegible {
  id: number;
  nombre: string;
  codigo: string | null;
  unidad: string | null;
  precio: number;
}

export interface LineaCotizacion {
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

/** Redondeo a céntimos sin el clásico 1.005 → 1.00. */
export const redondear2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const subtotalDe = (l: Pick<LineaCotizacion, "cantidad" | "precioUnitario">) =>
  redondear2((Number(l.cantidad) || 0) * (Number(l.precioUnitario) || 0));

/**
 * La suma de las líneas. Es referencial: los impuestos y la lista de precios los
 * aplica Odoo al crear la cotización, y el total que vale es el que devuelve.
 */
export const totalReferencial = (lineas: LineaCotizacion[]) =>
  redondear2(lineas.reduce((suma, l) => suma + subtotalDe(l), 0));

let contador = 0;
const nuevaClave = () => `l${Date.now().toString(36)}${(contador++).toString(36)}`;

export function agregarProducto(
  lineas: LineaCotizacion[],
  producto: ProductoElegible,
  clave: () => string = nuevaClave,
): { lineas: LineaCotizacion[]; clave: string; sumada: boolean } {
  const existente = lineas.find((l) => l.productoId === producto.id && !l.descripcion.trim());
  if (existente) {
    return {
      lineas: lineas.map((l) =>
        l.clave === existente.clave ? { ...l, cantidad: redondear3(l.cantidad + 1) } : l,
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

export function actualizarLinea(
  lineas: LineaCotizacion[],
  clave: string,
  cambios: Partial<Pick<LineaCotizacion, "cantidad" | "precioUnitario" | "descripcion">>,
): LineaCotizacion[] {
  return lineas.map((l) => (l.clave === clave ? { ...l, ...cambios } : l));
}

export const quitarLinea = (lineas: LineaCotizacion[], clave: string) =>
  lineas.filter((l) => l.clave !== clave);

/** Sube o baja la cantidad con los botones ±, sin bajar de 1 ni dejar decimales sucios. */
export function cambiarCantidad(lineas: LineaCotizacion[], clave: string, delta: number) {
  return lineas.map((l) =>
    l.clave === clave ? { ...l, cantidad: Math.max(1, redondear3(l.cantidad + delta)) } : l,
  );
}

const redondear3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

/** Lo que falta para poder crear, en palabras. `null` si no falta nada. */
export function problemaDeLineas(lineas: LineaCotizacion[]): string | null {
  if (lineas.length === 0) return "Agrega al menos un producto.";
  for (const l of lineas) {
    if (!(Number(l.cantidad) > 0)) return `La cantidad de ${l.nombre} tiene que ser mayor que cero.`;
    if (!(Number(l.precioUnitario) >= 0)) return `El precio de ${l.nombre} no puede ser negativo.`;
  }
  return null;
}
