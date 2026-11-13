/**
 * El catálogo de productos terminados en el idioma de la pantalla. Sin
 * dependencias de servidor: lo usan también los componentes del navegador.
 *
 * Un producto estándar tiene forma fija: cambian la medida, el material, el
 * espesor y las opciones. Lo que tenga otra forma es personalizado y no pasa
 * por aquí.
 */

import { compactar } from "../busqueda-inteligente";
import type { ParametrosCad } from "../cad/tipos";
import type { ProductoTerminado as EtiquetaDePedido } from "../dominio";
import type { ConfigTerminados } from "./config";
import type { Geometria, Medidas } from "./geometria";

export type ClaseOpcion = "personalizacion" | "acabado" | "complemento";

export const CLASES_OPCION: Record<ClaseOpcion, string> = {
  personalizacion: "Personalizaciones",
  acabado: "Acabados",
  complemento: "Complementos",
};

export interface TipoTerminado {
  /** "CAJ", "ANF"… el prefijo de los códigos. */
  codigo: string;
  nombre: string;
  orden: number;
  /** Por cuánto se multiplica el costo del material para llegar al precio. */
  factor: number;
}

export interface MedidaEstandar {
  id: string;
  orden: number;
  m1: number | null;
  m2: number | null;
  m3: number | null;
  diametro: number | null;
  altura: number | null;
  alturaMax: number | null;
  /** "A4", "A3"… */
  formato: string | null;
  estimado: boolean;
  nota: string | null;
}

export interface EspesorRecomendado {
  id: string;
  orden: number;
  minMm: number;
  maxMm: number;
  aplicacion: string | null;
  material: string | null;
  estimado: boolean;
  nota: string | null;
}

export interface Opcion {
  id: number;
  clase: ClaseOpcion;
  nombre: string;
  /** Lo que suma al precio de cada unidad. */
  extra: number;
}

export interface OpcionDeProducto {
  opcionId: number;
  /** Un complemento que el producto trae siempre viene marcado. */
  opcional: boolean;
  detalle: string | null;
}

export interface MaterialDeProducto {
  nombre: string;
  componente: string | null;
  opcional: boolean;
  especificacion: string | null;
}

export interface ProductoEstandar {
  /** "CAJ-001". */
  codigo: string;
  tipo: string;
  nombre: string;
  usos: string | null;
  /** Se fabrica a medida: las medidas listadas son solo una referencia. */
  aMedida: boolean;
  contactoAlimentario: string | null;
  imagenUrl: string | null;
  notas: string | null;
  geometria: Geometria;
  activo: boolean;
  /** La plantilla del motor CAD que lo dibuja ("caja", "letras"…); null si ninguna. */
  plantillaCad: string | null;
  /** Sus parámetros para la primera medida, en mm (`lib/terminados/plantilla-cad.ts`). */
  parametrosCad: ParametrosCad | null;
  medidas: MedidaEstandar[];
  espesores: EspesorRecomendado[];
  /** Los nombres de los colores de acrílico en que se hace. */
  colores: string[];
  opciones: OpcionDeProducto[];
  materiales: MaterialDeProducto[];
}

export interface CatalogoTerminados {
  tipos: TipoTerminado[];
  productos: ProductoEstandar[];
  opciones: Opcion[];
  colores: { id: number; nombre: string }[];
  config: ConfigTerminados;
}

/** La etiqueta del pedido (`pedidos.tipo_producto_terminado`) de cada tipo del catálogo. */
const ETIQUETAS: Record<string, EtiquetaDePedido> = {
  CAJ: "cajas",
  ANF: "anforas",
  DSP: "displays",
  PAF: "porta_afiches",
  ALZ: "alzadores",
  TAR: "tarecos",
  ATR: "atriles",
  LTR: "letreros",
  LET: "letras",
};

/** Un tipo que no está en la lista —o un personalizado sin tipo— es "otro". */
export const etiquetaDeTipo = (codigo: string | null | undefined): EtiquetaDePedido =>
  (codigo && ETIQUETAS[codigo]) || "otro";

const n = (x: number) => String(+x.toFixed(2));

/** Las medidas de una fila del catálogo, como las pide el cálculo. */
export function medidasDe(m: MedidaEstandar): Medidas {
  return { m1: m.m1, m2: m.m2, m3: m.m3, diametro: m.diametro, altura: m.altura };
}

/** "30 × 20 × 20 cm", "Ø 20 × 25 cm", "A4 (21 × 29.7 cm)", "10 a 30 cm de alto". */
export function textoDeMedidaEstandar(m: MedidaEstandar): string {
  let texto: string;
  if (m.diametro && m.altura) texto = `Ø ${n(m.diametro)} × ${n(m.altura)} cm`;
  else if (m.diametro && m.m1) texto = `Ø ${n(m.diametro)} × ${n(m.m1)} cm`;
  else if (m.m1) texto = `${[m.m1, m.m2, m.m3].filter((x): x is number => !!x).map(n).join(" × ")} cm`;
  else if (m.altura && m.alturaMax) texto = `${n(m.altura)} a ${n(m.alturaMax)} cm de alto`;
  else if (m.altura) texto = `${n(m.altura)} cm de alto`;
  else texto = "—";
  return m.formato ? `${m.formato} (${texto})` : texto;
}

/** "3 mm", "3 a 5 mm (Grande)". */
export function textoDeEspesor(e: EspesorRecomendado): string {
  const rango = e.minMm === e.maxMm ? `${n(e.minMm)} mm` : `${n(e.minMm)} a ${n(e.maxMm)} mm`;
  return e.aplicacion ? `${rango} (${e.aplicacion})` : rango;
}

/** Si un espesor de plancha cae en alguno de los recomendados para el producto. */
export const espesorRecomendado = (p: Pick<ProductoEstandar, "espesores">, mm: number) =>
  p.espesores.some((e) => mm >= e.minMm - 1e-6 && mm <= e.maxMm + 1e-6);

/** Los productos que coinciden con lo escrito ("caja ranura", "anf-003"): cada palabra, en cualquier orden. */
export function buscarProductos<P extends Pick<ProductoEstandar, "codigo" | "nombre">>(
  productos: P[],
  consulta: string,
): P[] {
  const palabras = consulta.split(/\s+/).map(compactar).filter(Boolean);
  if (palabras.length === 0) return productos;
  return productos.filter((p) => {
    const donde = compactar(`${p.codigo} ${p.nombre}`);
    return palabras.every((x) => donde.includes(x));
  });
}

/** Las opciones de un producto, con su nombre y su extra, agrupadas por clase. */
export function opcionesDeProducto(
  catalogo: Pick<CatalogoTerminados, "opciones">,
  producto: Pick<ProductoEstandar, "opciones">,
): Record<ClaseOpcion, (Opcion & OpcionDeProducto)[]> {
  const porId = new Map(catalogo.opciones.map((o) => [o.id, o]));
  const salida: Record<ClaseOpcion, (Opcion & OpcionDeProducto)[]> = {
    personalizacion: [],
    acabado: [],
    complemento: [],
  };
  for (const op of producto.opciones) {
    const o = porId.get(op.opcionId);
    if (o) salida[o.clase].push({ ...o, ...op });
  }
  for (const lista of Object.values(salida)) lista.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  return salida;
}
