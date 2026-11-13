/**
 * Lo que se deduce del esquema de una plantilla sin pintar nada: valores por
 * defecto, qué control le toca a cada parámetro y cómo se limpia lo que se
 * escribe. Es puro para poder probarlo; el formulario solo lo dibuja.
 */

import type {
  EsquemaParametros,
  ParametrosCad,
  PropiedadEsquema,
  ValorParametro,
} from "./tipos";

export type ControlCampo =
  | "numero"
  | "entero"
  | "interruptor"
  | "lista"
  | "texto";

export interface CampoEsquema {
  clave: string;
  etiqueta: string;
  ayuda?: string;
  control: ControlCampo;
  requerido: boolean;
  minimo?: number;
  maximo?: number;
  opciones: string[];
  propiedad: PropiedadEsquema;
}

function controlDe(p: PropiedadEsquema): ControlCampo {
  if (p.type === "boolean") return "interruptor";
  if (p.type === "integer") return "entero";
  if (p.type === "number") return "numero";
  return p.enum?.length ? "lista" : "texto";
}

/** Los campos en el orden en que el motor declara las propiedades. */
export function camposDe(
  esquema: EsquemaParametros | null | undefined,
): CampoEsquema[] {
  const requeridos = new Set(esquema?.required ?? []);
  return Object.entries(esquema?.properties ?? {}).map(
    ([clave, propiedad]) => ({
      clave,
      etiqueta: propiedad.title || clave,
      ayuda: propiedad.description || undefined,
      control: controlDe(propiedad),
      requerido: requeridos.has(clave),
      minimo: propiedad.minimum,
      maximo: propiedad.maximum,
      opciones: propiedad.enum ?? [],
      propiedad,
    }),
  );
}

/** El valor con el que arranca un parámetro que el motor dejó sin `default`. */
function valorInicial(p: PropiedadEsquema): ValorParametro | undefined {
  if (p.default !== undefined) return p.default;
  if (p.type === "boolean") return false;
  if (p.type === "string") return p.enum?.[0];
  return p.minimum;
}

export function valoresPorDefecto(
  esquema: EsquemaParametros | null | undefined,
): ParametrosCad {
  const valores: ParametrosCad = {};
  for (const [clave, p] of Object.entries(esquema?.properties ?? {})) {
    const v = valorInicial(p);
    if (v !== undefined) valores[clave] = v;
  }
  return valores;
}

/**
 * Los parámetros guardados sobre los valores por defecto. Lo que ya no esté en
 * el esquema se descarta: una plantilla puede haber cambiado de versión desde
 * que se guardó el diseño.
 */
export function completarParametros(
  esquema: EsquemaParametros | null | undefined,
  parametros: ParametrosCad,
): ParametrosCad {
  const completos = valoresPorDefecto(esquema);
  for (const clave of Object.keys(esquema?.properties ?? {})) {
    const v = parametros[clave];
    if (v !== undefined) completos[clave] = v;
  }
  return completos;
}

const acotar = (n: number, p: PropiedadEsquema) =>
  Math.min(p.maximum ?? Infinity, Math.max(p.minimum ?? -Infinity, n));

/**
 * Lo que se escribió, convertido al tipo de la propiedad. `undefined` si no se
 * puede leer (un número a medio escribir): ahí no se regenera nada.
 *
 * `acotar` es opcional porque al teclear no conviene: con mínimo 50, escribir
 * "120" pasa por "1" y por "12", y acotarlos reescribiría el campo bajo los dedos.
 */
export function normalizarValor(
  p: PropiedadEsquema,
  crudo: unknown,
  opciones: { acotar?: boolean } = {},
): ValorParametro | undefined {
  if (p.type === "boolean") {
    if (typeof crudo === "boolean") return crudo;
    if (crudo === "true") return true;
    if (crudo === "false") return false;
    return undefined;
  }

  if (p.type === "string") {
    if (typeof crudo !== "string") return undefined;
    if (p.enum?.length && !p.enum.includes(crudo)) return undefined;
    return crudo;
  }

  const texto =
    typeof crudo === "string" ? crudo.trim().replace(",", ".") : crudo;
  if (texto === "" || texto === null || typeof texto === "boolean")
    return undefined;
  let n = Number(texto);
  if (!Number.isFinite(n)) return undefined;
  if (p.type === "integer") n = Math.round(n);
  return opciones.acotar ? acotar(n, p) : n;
}

/**
 * La unidad que se pinta junto a un campo numérico. Todas las medidas del motor
 * van en mm, pero no todo número es una medida: un entero suele ser una
 * cantidad (divisiones, niveles) y un ángulo va en grados.
 */
export function unidadDe(p: PropiedadEsquema): string | null {
  if (p.type !== "number" && p.type !== "integer") return null;
  const texto = `${p.title ?? ""} ${p.description ?? ""}`.toLowerCase();
  if (/ángulo|angulo|grados|°/.test(texto)) return "°";
  if (/\bmm\b|milímetro/.test(texto)) return "mm";
  return p.type === "number" ? "mm" : null;
}

/** El paso del deslizador: entero para cantidades, y fino solo en rangos cortos. */
export function pasoDe(p: PropiedadEsquema): number {
  if (p.type === "integer") return 1;
  const rango = (p.maximum ?? 0) - (p.minimum ?? 0);
  return rango > 0 && rango <= 20 ? 0.5 : 1;
}

/** Un número de mm sin ceros de sobra: `200`, `12.5`. */
export function medida(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** `diseno-caja-200x150x100.dxf`. Sin dimensiones, `diseno-caja.dxf`. */
export function nombreArchivo(
  plantilla: string,
  dimensiones: { x: number; y: number; z: number } | null | undefined,
  extension: string,
): string {
  const codigo = plantilla.replace(/[^a-z0-9_-]+/gi, "-") || "diseno";
  const medidas = dimensiones
    ? `-${[dimensiones.x, dimensiones.y, dimensiones.z].map((n) => Math.round(n)).join("x")}`
    : "";
  return `diseno-${codigo}${medidas}.${extension}`;
}

/**
 * A qué pieza del despiece pertenece un nodo del GLB. El motor los nombra `<id>`
 * o `<id>_<n>` cuando la pieza se repite, y los exportadores de glTF añaden a
 * veces sufijos propios, así que gana el id más largo que encaje: con piezas
 * `lateral` y `lateral_corto`, el nodo `lateral_corto_2` es de la segunda.
 */
export function nodoAPieza(
  nombre: string,
  ids: readonly string[],
): string | null {
  let mejor: string | null = null;
  for (const id of ids) {
    if (nombre !== id && !nombre.startsWith(`${id}_`)) continue;
    if (!mejor || id.length > mejor.length) mejor = id;
  }
  return mejor;
}
