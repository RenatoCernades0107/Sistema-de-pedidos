/**
 * La búsqueda de precios del agente, sobre la misma lista que el PDF de la
 * Lista de precios (`cargarDatosListaPrecios`): planchas y accesorios activos con
 * su precio de venta de Odoo. Sin dependencias de servidor, para poder probarla.
 *
 * El cliente escribe como escribe ("cuánto el acrilico transparente de 3 milímetros"),
 * así que se compara por palabras sueltas, sin tildes, sin plurales, y con los
 * espesores y medidas normalizados ("3mm", "3 mm" y "3 milímetros" son lo mismo).
 */

import type { DatosListaPrecios } from "@/lib/lista-precios-servidor";
import { medidaEnMetros } from "@/lib/lista-precios";

export interface PrecioEncontrado {
  tipo: "plancha" | "accesorio";
  producto: string;
  codigo: string;
  /** "1.22 × 2.44 m", solo en planchas. */
  medida?: string;
  espesorMm?: number;
  /** De la categoría, en accesorios. */
  categoria?: string;
  precio: number;
}

export interface ResultadoPrecios {
  encontrados: PrecioEncontrado[];
  /** Cuántos más coincidían y no se devolvieron. */
  mas: number;
}

/** Palabras que no ayudan a encontrar un producto. */
const VACIAS = new Set(
  (
    "a al algo alguna alguno algun con cual cuales cuanto cuanta cuantos cuantas cuesta cuestan de del el ella en es " +
    "esta estan este estos esas eso esto hay la las le lo los me mas mi mis necesito o para plancha planchas por precio " +
    "precios que quiero quisiera queria sale salen se si sus su tiene tienen tendran tendria un una unos unas y ya hola " +
    "buenas buenos dias tardes noches info informacion favor porfa porfavor gracias cotizar cotizacion valor costo " +
    "tienes vende venden venta saber dime digame consulta pregunta ustedes usted tu"
  ).split(" "),
);

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** "Acrílicos" → "acrilico"; "colores" → "color". Lo justo para que el plural no estorbe. */
function raiz(palabra: string): string {
  if (/^\d/.test(palabra)) return palabra;
  if (palabra.length > 4 && palabra.endsWith("es") && !/[aeiou]es$/.test(palabra)) return palabra.slice(0, -2);
  if (palabra.length > 3 && palabra.endsWith("s")) return palabra.slice(0, -1);
  return palabra;
}

/** Las palabras de un texto, normalizadas. Exportado para las pruebas. */
export function palabrasDe(texto: string): string[] {
  const t = sinTildes(texto.toLowerCase())
    .replace(/(\d),(\d)/g, "$1.$2")
    // "3 mm", "3 milimetros", "3mm." → "3mm"
    .replace(/(\d+(?:\.\d+)?)\s*(?:mm|milimetros?|mlm)\b/g, " $1mm ")
    // "1.22x2.44", "1.22 × 2.44" → las dos medidas sueltas
    .replace(/[x×*]/g, " ");
  return t
    .split(/[^a-z0-9.]+/)
    .map((p) => p.replace(/^\.+|\.+$/g, ""))
    .filter((p) => p && !VACIAS.has(p))
    .map(raiz);
}

interface Candidato extends PrecioEncontrado {
  palabras: Set<string>;
}

function candidatos(datos: DatosListaPrecios): Candidato[] {
  const categorias = new Map(datos.categorias.map((c) => [c.id, c.nombre]));
  const planchas = datos.planchas
    .filter((p) => p.activo && p.precio !== null && p.precio > 0)
    .map((p): Candidato => {
      const medida = medidaEnMetros(p.anchoCm, p.largoCm);
      const producto = `${p.material} ${p.color} ${p.espesorMm} mm`;
      const metros = medida.replace(/[^\d.×]/g, "").split("×");
      return {
        tipo: "plancha",
        producto,
        codigo: p.codigo,
        medida,
        espesorMm: p.espesorMm,
        precio: p.precio!,
        palabras: new Set([...palabrasDe(`${producto} ${p.codigo}`), ...metros.filter(Boolean)]),
      };
    });
  const accesorios = datos.accesorios
    .filter((a) => a.activo && a.precio !== null && a.precio > 0)
    .map((a): Candidato => {
      const categoria = categorias.get(a.categoriaId);
      return {
        tipo: "accesorio",
        producto: a.nombre,
        codigo: a.codigo,
        categoria,
        precio: a.precio!,
        palabras: new Set(palabrasDe(`${a.nombre} ${categoria ?? ""} ${a.codigo}`)),
      };
    });
  return [...planchas, ...accesorios];
}

/** Si una palabra de la consulta está en el producto: igual, o como comienzo de una más larga ("transp" → "transparente"). */
function coincide(palabra: string, del: Set<string>): boolean {
  if (del.has(palabra)) return true;
  if (/^\d/.test(palabra)) return false;
  if (palabra.length < 3) return false;
  for (const p of del) if (p.startsWith(palabra) || (p.length >= 4 && palabra.startsWith(p))) return true;
  return false;
}

/**
 * Los productos con precio que mejor coinciden con la consulta, primero los que
 * tienen más palabras en común. Si la consulta trae un espesor ("3mm"), solo
 * valen los de ese espesor.
 */
export function buscarPrecios(datos: DatosListaPrecios, consulta: string, limite = 15): ResultadoPrecios {
  const palabras = [...new Set(palabrasDe(consulta))];
  if (palabras.length === 0) return { encontrados: [], mas: 0 };
  const espesores = palabras.filter((p) => /^\d+(\.\d+)?mm$/.test(p));

  const puntuados = candidatos(datos)
    .filter((c) => espesores.every((e) => c.palabras.has(e)))
    .map((c) => ({ c, puntos: palabras.filter((p) => coincide(p, c.palabras)).length }))
    .filter((x) => x.puntos > 0)
    .sort((a, b) => b.puntos - a.puntos || a.c.producto.localeCompare(b.c.producto) || a.c.precio - b.c.precio);

  if (puntuados.length === 0) return { encontrados: [], mas: 0 };
  // Solo los que empatan con los mejores, o les falta una palabra: lo demás es ruido.
  const mejor = puntuados[0].puntos;
  const buenos = puntuados.filter((x) => x.puntos >= Math.max(1, mejor - 1));
  const encontrados = buenos.slice(0, limite).map(({ c }): PrecioEncontrado => {
    const { palabras, ...resto } = c;
    void palabras;
    return resto;
  });
  return { encontrados, mas: Math.max(0, buenos.length - limite) };
}
