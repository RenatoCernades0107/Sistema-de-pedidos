/**
 * Búsqueda de clientes y productos de Odoo, pensada para el mostrador.
 *
 * Quien cotiza escribe rápido, sin tildes, con errores y en el orden que le sale:
 * "acri cristal 3", "acrilico transparente 3mm", "acrlico". O dicta un código:
 * "a-ce cero cero tres". Las reglas, en orden de importancia:
 *
 *   1. **El código manda.** La referencia interna de Odoo (`default_code`), el
 *      código de barras y el RUC/DNI se comparan *compactados* —sin espacios,
 *      guiones ni puntos—, así que `AC-003`, `ac 003` y `AC003` son lo mismo. Un
 *      código exacto va siempre primero; luego los que empiezan por lo escrito.
 *   2. **Cada palabra de la consulta tiene que aparecer**, en cualquier orden:
 *      exacta > empieza por > contiene > con un error de tipeo.
 *   3. A igualdad, gana lo que más se cotiza.
 *
 * Puro y sin dependencias: lo usan el servidor (que busca) y el navegador (que
 * resalta), y se prueba sin red.
 */

import { normalizar } from "./busqueda";

/* ── Texto ─────────────────────────────────────────────────────────────────── */

/**
 * `normalizar` (minúsculas, sin tildes, separadores unificados) más dos cosas
 * que importan en este catálogo: la puntuación es un separador y los números se
 * despegan de las letras. "3mm" y "3 mm" dicen lo mismo, y "30x50" es "30 x 50".
 */
export function normalizarTexto(s: string): string {
  return normalizar(s)
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .trim();
}

export const palabras = (s: string): string[] => {
  const n = normalizarTexto(s);
  return n ? n.split(" ") : [];
};

/** Un código sin nada que no sea letra o número: `AC-003` → `ac003`. */
export const compactar = (s: string): string => normalizar(s).replace(/[^a-z0-9]/g, "");

/** Solo los dígitos: para comparar RUC, DNI y teléfonos. */
export const soloDigitos = (s: string): string => s.replace(/\D/g, "");

/**
 * Sinónimos del rubro. Pocos y solo los que se han visto de verdad: en acrílico,
 * "transparente" es como el cliente dice "cristal", que es como lo nombra el
 * catálogo. Para añadir uno basta una línea; un sinónimo dudoso ensucia todas las
 * búsquedas, así que mejor no adivinarlos.
 */
export const SINONIMOS: Record<string, string[]> = {
  transparente: ["cristal"],
  cristal: ["transparente"],
};

/** La palabra y sus sinónimos, también cuando todavía se está escribiendo ("transpa"). */
function alternativas(palabra: string): string[] {
  const salida = [palabra];
  for (const [clave, sinonimos] of Object.entries(SINONIMOS)) {
    if (clave === palabra || (palabra.length >= 4 && clave.startsWith(palabra))) {
      salida.push(...sinonimos);
    }
  }
  return salida;
}

/* ── Errores de tipeo ──────────────────────────────────────────────────────── */

/**
 * Distancia de Damerau-Levenshtein (versión "alineamiento óptimo"): cuántas
 * letras hay que meter, quitar, cambiar o intercambiar con la vecina. Se corta
 * en cuanto pasa de `tope`, que es lo único que interesa.
 */
export function distancia(a: string, b: string, tope = 2): number {
  if (Math.abs(a.length - b.length) > tope) return tope + 1;
  const filas = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: filas }, (_, i) =>
    Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i < filas; i++) {
    let minimoFila = Infinity;
    for (let j = 1; j < cols; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + costo);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, d[i - 2][j - 2] + 1);
      }
      d[i][j] = v;
      minimoFila = Math.min(minimoFila, v);
    }
    if (minimoFila > tope) return tope + 1;
  }
  return d[a.length][b.length];
}

/**
 * Cuántos errores se le perdonan a una palabra según su largo. A un número,
 * ninguno: "20512345671" no es "20123456786" con dos dedos torpes, es otro RUC,
 * y "1220" no es "1250". Los errores de tipeo se perdonan en las palabras.
 */
const toleranciaDe = (palabra: string) =>
  /\d/.test(palabra) ? 0 : palabra.length >= 8 ? 2 : palabra.length >= 4 ? 1 : 0;

/**
 * Si `palabra` (de la consulta) es `objetivo` con algún error. Se compara contra
 * el inicio de `objetivo` con largos parecidos: así "acrlic" encuentra "acrilico"
 * aunque todavía no se haya terminado de escribir.
 */
function casiIgual(palabra: string, objetivo: string): boolean {
  const tope = toleranciaDe(palabra);
  if (tope === 0) return false;
  for (let largo = palabra.length - 1; largo <= palabra.length + 1; largo++) {
    if (largo < 1 || largo > objetivo.length) continue;
    if (distancia(palabra, objetivo.slice(0, largo), tope) <= tope) return true;
  }
  return false;
}

/* ── Índice ────────────────────────────────────────────────────────────────── */

/** Lo que de un elemento se puede buscar. */
export interface CamposBuscables {
  /** El nombre: lo que más pesa después del código. */
  nombre: string;
  /** Referencia interna, código de barras, RUC/DNI. Se comparan compactados. */
  codigos?: (string | null | undefined)[];
  /** Lo demás: teléfono, correo, ciudad, categoría. Cuenta menos que el nombre. */
  extra?: (string | null | undefined)[];
  /** Teléfonos: además de como texto, se comparan por dígitos. */
  telefonos?: (string | null | undefined)[];
}

interface Preparado<T> {
  item: T;
  nombre: string[];
  extra: string[];
  codigos: string[];
  telefonos: string[];
}

export type TipoCoincidenciaCodigo = "exacto" | "prefijo" | "contiene";

export interface Encontrado<T> {
  item: T;
  puntaje: number;
  /** Si entró por su código, y cómo. `null` si entró solo por el texto. */
  porCodigo: TipoCoincidenciaCodigo | null;
}

export interface OpcionesBusqueda<T> {
  limite?: number;
  /** Cuántas veces se cotizó, para desempatar. */
  popularidad?: (item: T) => number;
  /** Solo coincidencias exactas de código (para el lector de código de barras). */
  soloCodigoExacto?: boolean;
}

/** Lo que la consulta dice de sí misma, calculado una vez por búsqueda. */
export interface Consulta {
  original: string;
  palabras: string[];
  compacta: string;
  digitos: string;
  /** Una sola palabra con números ("AC003", "ac-0"): casi seguro un código. */
  pareceCodigo: boolean;
}

export function analizarConsulta(q: string): Consulta {
  const original = q.trim();
  const compacta = compactar(original);
  return {
    original,
    palabras: palabras(original),
    compacta,
    digitos: /^[\d\s\-.]+$/.test(original) ? soloDigitos(original) : "",
    pareceCodigo: !/\s/.test(original) && /\d/.test(original) && compacta.length >= 2,
  };
}

const PUNTOS_CODIGO: Record<TipoCoincidenciaCodigo, number> = {
  exacto: 1000,
  prefijo: 600,
  contiene: 300,
};

function puntajeCodigo(
  codigos: string[],
  c: Consulta,
): { tipo: TipoCoincidenciaCodigo; puntos: number } | null {
  if (!c.compacta) return null;
  let mejor: { tipo: TipoCoincidenciaCodigo; puntos: number } | null = null;
  for (const codigo of codigos) {
    let actual: { tipo: TipoCoincidenciaCodigo; puntos: number } | null = null;
    if (codigo === c.compacta) {
      actual = { tipo: "exacto", puntos: PUNTOS_CODIGO.exacto };
    } else if (codigo.startsWith(c.compacta)) {
      // Entre dos prefijos, el código más corto está más cerca de lo escrito.
      actual = {
        tipo: "prefijo",
        puntos: PUNTOS_CODIGO.prefijo - Math.min(codigo.length - c.compacta.length, 50),
      };
    } else if (c.compacta.length >= 3 && codigo.includes(c.compacta)) {
      actual = { tipo: "contiene", puntos: PUNTOS_CODIGO.contiene };
    }
    if (actual && (!mejor || actual.puntos > mejor.puntos)) mejor = actual;
  }
  return mejor;
}

/** Qué tan bien una palabra de la consulta encuentra a una palabra del texto. */
function puntajePalabra(palabra: string, objetivo: string): number {
  if (objetivo === palabra) return 30;
  if (objetivo.startsWith(palabra)) return 20;
  if (palabra.length >= 3 && objetivo.includes(palabra)) return 10;
  if (casiIgual(palabra, objetivo)) return 6;
  return 0;
}

function mejorEn(palabra: string, lista: string[]): number {
  let mejor = 0;
  for (const alternativa of alternativas(palabra)) {
    // El sinónimo vale un poco menos que lo que se escribió tal cual.
    const castigo = alternativa === palabra ? 0 : 2;
    for (const objetivo of lista) {
      const p = puntajePalabra(alternativa, objetivo) - castigo;
      if (p > mejor) mejor = p;
      if (mejor >= 30) return mejor;
    }
  }
  return mejor;
}

/** Todas las palabras de la consulta tienen que aparecer. 0 si falta alguna. */
function puntajeTexto(d: Preparado<unknown>, c: Consulta): number {
  if (c.palabras.length === 0) return 0;
  let total = 0;
  let enNombre = 0;
  for (const palabra of c.palabras) {
    const enElNombre = mejorEn(palabra, d.nombre);
    const enLoDemas = mejorEn(palabra, d.extra) * 0.6;
    const p = Math.max(enElNombre, enLoDemas);
    if (p <= 0) return 0;
    if (enElNombre >= enLoDemas) enNombre++;
    total += p;
  }
  // A igualdad, el nombre más corto es el que más se parece a lo que se pidió:
  // "acrilico 3mm" está más cerca de "ACRILICO 3MM" que de "ACRILICO 3MM ESPEJO".
  const cobertura = d.nombre.length ? enNombre / d.nombre.length : 0;
  return total + 5 * Math.min(cobertura, 1);
}

function puntajeTelefono(d: Preparado<unknown>, c: Consulta): number {
  if (c.digitos.length < 4) return 0;
  return d.telefonos.some((t) => t.includes(c.digitos)) ? 250 : 0;
}

/**
 * El buscador sobre una lista fija. Prepara el texto de cada elemento una vez,
 * no en cada tecla: con miles de productos, normalizar todo por búsqueda se nota.
 */
export class Buscador<T> {
  private readonly preparados: Preparado<T>[];

  constructor(items: T[], campos: (item: T) => CamposBuscables) {
    this.preparados = items.map((item) => {
      const c = campos(item);
      const codigos = (c.codigos ?? [])
        .filter((x): x is string => !!x)
        .map(compactar)
        .filter(Boolean);
      return {
        item,
        nombre: palabras(c.nombre),
        // Los códigos también se buscan como palabras, para "acrilico ac 003".
        extra: [
          ...(c.extra ?? []).filter((x): x is string => !!x).flatMap(palabras),
          ...(c.codigos ?? []).filter((x): x is string => !!x).flatMap(palabras),
        ],
        codigos,
        telefonos: (c.telefonos ?? [])
          .filter((x): x is string => !!x)
          .map(soloDigitos)
          .filter(Boolean),
      };
    });
  }

  get tamano() {
    return this.preparados.length;
  }

  buscar(q: string, opciones: OpcionesBusqueda<T> = {}): Encontrado<T>[] {
    const { limite = 20, popularidad, soloCodigoExacto = false } = opciones;
    const c = analizarConsulta(q);
    if (!c.compacta) return [];

    const encontrados: Encontrado<T>[] = [];
    for (const d of this.preparados) {
      const codigo = puntajeCodigo(d.codigos, c);
      if (soloCodigoExacto) {
        if (codigo?.tipo === "exacto") encontrados.push({ item: d.item, puntaje: 1000, porCodigo: "exacto" });
        continue;
      }
      const texto = puntajeTexto(d, c);
      const telefono = puntajeTelefono(d, c);
      if (!codigo && texto === 0 && telefono === 0) continue;

      const pop = popularidad ? Math.min(popularidad(d.item), 20) * 0.5 : 0;
      encontrados.push({
        item: d.item,
        puntaje: (codigo?.puntos ?? 0) + texto + telefono + pop,
        porCodigo: codigo?.tipo ?? null,
      });
    }

    encontrados.sort((a, b) => b.puntaje - a.puntaje);
    return encontrados.slice(0, limite);
  }
}

/* ── Resaltado ─────────────────────────────────────────────────────────────── */

export interface Tramo {
  texto: string;
  marcado: boolean;
}

/**
 * Lo que hay que pintar en negrita dentro de `texto` para la consulta `q`. Se
 * compara letra a letra sin tildes ni mayúsculas, pero se devuelve el texto
 * original: "José" sigue llevando su tilde aunque se haya escrito "jose".
 *
 * Una palabra de una sola letra o cifra solo se resalta al inicio de una palabra
 * ("3" en "3MM", no en "30x50"): resaltar cada "3" no ayuda a nadie.
 */
export function resaltar(texto: string, q: string): Tramo[] {
  const terminos = [...new Set(palabras(q).flatMap(alternativas))].filter(Boolean);
  if (!texto || terminos.length === 0) return [{ texto, marcado: false }];

  // Cada letra del original con su forma comparable (sin tilde, en minúscula).
  const letras = [...texto];
  const comparables = letras.map((l) => {
    const n = normalizar(l);
    return n.length === 1 && /[a-z0-9]/.test(n) ? n : " ";
  });
  const plano = comparables.join("");
  const marcas = new Array<boolean>(letras.length).fill(false);

  for (const termino of terminos) {
    let desde = 0;
    while (desde <= plano.length - termino.length) {
      const i = plano.indexOf(termino, desde);
      if (i < 0) break;
      const inicioDePalabra = i === 0 || plano[i - 1] === " " || /\d/.test(plano[i - 1]) !== /\d/.test(plano[i]);
      if (termino.length > 1 || inicioDePalabra) {
        for (let k = i; k < i + termino.length; k++) marcas[k] = true;
      }
      desde = i + 1;
    }
  }

  return aTramos(letras, marcas);
}

/**
 * Resalta en un código lo que coincide con la consulta compactada: en `AC-003`
 * con "ac0" se marcan `AC-0`, saltando el guion igual que lo salta la búsqueda.
 */
export function resaltarCodigo(codigo: string, q: string): Tramo[] {
  const consulta = compactar(q);
  const letras = [...codigo];
  const marcas = new Array<boolean>(letras.length).fill(false);
  if (!consulta) return [{ texto: codigo, marcado: false }];

  // Posición en el original de cada letra que sobrevive a `compactar`.
  const indices: number[] = [];
  let compacto = "";
  letras.forEach((l, i) => {
    const n = compactar(l);
    if (n.length === 1) {
      indices.push(i);
      compacto += n;
    }
  });

  const i = compacto.indexOf(consulta);
  if (i >= 0) {
    const inicio = indices[i];
    const fin = indices[i + consulta.length - 1];
    for (let k = inicio; k <= fin; k++) marcas[k] = true;
  }
  return aTramos(letras, marcas);
}

function aTramos(letras: string[], marcas: boolean[]): Tramo[] {
  const tramos: Tramo[] = [];
  letras.forEach((letra, i) => {
    const ultimo = tramos[tramos.length - 1];
    if (ultimo && ultimo.marcado === marcas[i]) ultimo.texto += letra;
    else tramos.push({ texto: letra, marcado: marcas[i] });
  });
  return tramos;
}

/* ── Documentos peruanos ───────────────────────────────────────────────────── */

export type TipoDocumentoCliente = "RUC" | "DNI";

/**
 * RUC: 11 dígitos, empieza por 10 (persona con negocio), 15, 16, 17 o 20
 * (empresa), y el último es un dígito verificador módulo 11. Comprobarlo aquí
 * ataja el error de tipeo antes de mandárselo a Odoo.
 */
export function rucValido(ruc: string): boolean {
  if (!/^(10|15|16|17|20)\d{9}$/.test(ruc)) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((s, p, i) => s + p * Number(ruc[i]), 0);
  const resto = 11 - (suma % 11);
  const verificador = resto === 10 ? 0 : resto === 11 ? 1 : resto;
  return verificador === Number(ruc[10]);
}

export function tipoDeDocumento(documento: string): TipoDocumentoCliente | null {
  const d = soloDigitos(documento);
  if (d.length === 11 && d === documento.replace(/[\s-]/g, "")) return "RUC";
  if (d.length === 8 && d === documento.replace(/[\s-]/g, "")) return "DNI";
  return null;
}
