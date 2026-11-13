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

/* ── Planchas: el diseño acomodado en planchas del catálogo ─────────────────── */

/** Una copia de una pieza en una plancha, como la recibe `POST /dxf/planchas`. */
export type PiezaEnPlanchaCad = {
  id: string;
  /** Qué copia es, de 1 a `cantidad`. */
  indice: number;
  /** Esquina inferior izquierda de la caja nominal, origen abajo a la izquierda, Y arriba. */
  x_mm: number;
  y_mm: number;
  /** Girada 90° antihorario. */
  rotada: boolean;
};

export type PlanchaAcomodadaCad = {
  ancho_mm: number;
  alto_mm: number;
  piezas: PiezaEnPlanchaCad[];
};

export type OpcionesDxfPlanchas = { kerf_mm?: number };

/** El material elegido para un diseño: un grupo del catálogo y, si pide, un color. */
export type MaterialDiseno = {
  grupoPlanchaId: string;
  /** Solo en grupos con código compartido entre colores (`pideColor`). */
  color: string | null;
};

/* ── Diseño libre: código build123d ejecutado en el sandbox ─────────────────── */

/** Una versión libre nace en borrador y no va a producción hasta que se aprueba. */
export type EstadoDisenoLibre = "borrador" | "aprobado";

/** El código que pone `plantilla` en las versiones libres. */
export const PLANTILLA_LIBRE = "libre";

/** Lo que devuelve `POST /ejecutar` del sandbox (la forma de `/generar`, más el código). */
export type ResultadoLibre = {
  codigo: string;
  nombre?: string | null;
  dimensiones: { x: number; y: number; z: number };
  glb_base64: string;
  piezas: PiezaCad[];
  validaciones: ValidacionCad[];
  /** Lo que imprimió el código (recortado). */
  salida?: string;
};

/** Por qué el código no produjo un diseño, para que el modelo lo corrija. */
export type ErrorCodigoLibre = {
  tipo:
    | "sintaxis"
    | "prohibido"
    | "ejecucion"
    | "tiempo"
    | "memoria"
    | "contrato"
    | "geometria"
    | "salida";
  mensaje: string;
  linea?: number;
  columna?: number;
  traza?: string;
  salida?: string;
};

/** La versión libre vigente de un diseño. */
export type VersionLibreCad = {
  version: number;
  codigo: string;
  estado: EstadoDisenoLibre;
  aprobadoEn: string | null;
};
