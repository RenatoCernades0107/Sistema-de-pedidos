/**
 * Tipos del motor CAD, tal como viajan por su API (`docs/API_cad.md`).
 *
 * Todas las medidas van en milímetros. El catálogo de la app guarda
 * centímetros: quien cruza la frontera convierte.
 */

export type FamiliaCad =
  | "anforas"
  | "cajas"
  | "displays"
  | "porta_afiches"
  | "letras"
  | "alzadores"
  | "tarecos"
  | "letreros"
  | "atriles";

/** Una propiedad del esquema de parámetros. Solo tipos planos. */
export type PropiedadEsquema = {
  type: "number" | "integer" | "boolean" | "string";
  title?: string;
  description?: string;
  default?: number | boolean | string;
  minimum?: number;
  maximum?: number;
  enum?: string[];
};

export type EsquemaParametros = {
  type: "object";
  properties: Record<string, PropiedadEsquema>;
  required?: string[];
};

export type ValorParametro = number | boolean | string;
export type ParametrosCad = Record<string, ValorParametro>;

export type PlantillaCad = {
  codigo: string;
  nombre: string;
  familia: FamiliaCad;
  version: number;
  descripcion: string;
  esquema: EsquemaParametros;
};

export type PiezaCad = {
  id: string;
  nombre: string;
  cantidad: number;
  espesor_mm: number;
  ancho_mm: number;
  alto_mm: number;
  area_mm2: number;
  perimetro_mm: number;
};

export type ValidacionCad = {
  nivel: "error" | "aviso";
  codigo: string;
  mensaje: string;
  pieza?: string;
};

export type ResultadoGeneracion = {
  plantilla: string;
  version_plantilla: number;
  parametros: ParametrosCad;
  dimensiones: { x: number; y: number; z: number };
  glb_base64: string;
  piezas: PiezaCad[];
  validaciones: ValidacionCad[];
};

export type OpcionesDxf = { kerf_mm?: number; separacion_mm?: number };

/** Un diseño guardado, con su versión vigente. */
export type DisenoCad = {
  id: string;
  nombre: string;
  plantilla: string | null;
  parametros: ParametrosCad;
  version: number;
  creado_en: string;
  actualizado_en: string;
};
