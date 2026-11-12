/**
 * Cuánta plancha lleva un producto terminado, a partir de su forma y sus
 * medidas.
 *
 * Es una estimación para cotizar y para reservar: el área de las caras que se
 * cortan, sin el acomodo en la plancha. Quien cotiza la puede corregir, y lo
 * que de verdad se descuenta del almacén lo anota logística al terminar.
 */

export type Geometria =
  | "caja_cerrada"
  | "caja_abierta"
  | "cilindro"
  | "lamina"
  | "lamina_plegada"
  | "letras"
  | "manual";

/** En centímetros. Lo que una forma no usa, va vacío. */
export interface Medidas {
  m1?: number | null;
  m2?: number | null;
  m3?: number | null;
  diametro?: number | null;
  altura?: number | null;
  /** Solo en las letras: cuántas son. */
  letras?: number | null;
}

export type CampoMedida = keyof Medidas;

export const GEOMETRIAS: Record<Geometria, { nombre: string; campos: CampoMedida[]; formula: string }> = {
  caja_cerrada: {
    nombre: "Caja cerrada (6 caras)",
    campos: ["m1", "m2", "m3"],
    formula: "2 × (m1×m2 + m1×m3 + m2×m3)",
  },
  caja_abierta: {
    nombre: "Caja abierta (5 caras)",
    campos: ["m1", "m2", "m3"],
    formula: "m1×m2 + 2 × (m1×m3 + m2×m3)",
  },
  cilindro: {
    nombre: "Cilindro",
    campos: ["diametro", "altura"],
    formula: "pared (π × diámetro × altura) + dos tapas",
  },
  lamina: { nombre: "Lámina plana", campos: ["m1", "m2"], formula: "m1 × m2" },
  lamina_plegada: {
    nombre: "Lámina plegada",
    campos: ["m1", "m2", "m3"],
    formula: "m1 × (m2 + m3)",
  },
  letras: {
    nombre: "Letras",
    campos: ["altura", "letras"],
    formula: "por letra: altura × (altura × ancho de letra)",
  },
  manual: { nombre: "Sin cálculo (a mano)", campos: ["m1", "m2", "m3"], formula: "el área la escribe quien cotiza" },
};

export const ETIQUETA_MEDIDA: Record<CampoMedida, string> = {
  m1: "Medida 1",
  m2: "Medida 2",
  m3: "Medida 3",
  diametro: "Diámetro",
  altura: "Altura",
  letras: "Nº de letras",
};

const positivo = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x) && x > 0;

const redondear4 = (x: number) => Math.round((x + Number.EPSILON) * 10000) / 10000;

/**
 * El área de una unidad, en m², sin merma. `null` si la forma no se calcula o
 * le falta alguna medida.
 */
export function areaM2(geometria: Geometria, m: Medidas, anchoDeLetra = 0.7): number | null {
  let cm2: number | null = null;
  switch (geometria) {
    case "caja_cerrada":
      if (positivo(m.m1) && positivo(m.m2) && positivo(m.m3)) cm2 = 2 * (m.m1 * m.m2 + m.m1 * m.m3 + m.m2 * m.m3);
      break;
    case "caja_abierta":
      if (positivo(m.m1) && positivo(m.m2) && positivo(m.m3)) cm2 = m.m1 * m.m2 + 2 * (m.m1 * m.m3 + m.m2 * m.m3);
      break;
    case "cilindro": {
      // El tambor de sorteo viene como diámetro × largo: el largo hace de altura.
      const alto = positivo(m.altura) ? m.altura : m.m1;
      if (positivo(m.diametro) && positivo(alto)) {
        cm2 = Math.PI * m.diametro * alto + 2 * Math.PI * (m.diametro / 2) ** 2;
      }
      break;
    }
    case "lamina":
      if (positivo(m.m1) && positivo(m.m2)) cm2 = m.m1 * m.m2;
      break;
    case "lamina_plegada":
      if (positivo(m.m1) && positivo(m.m2)) cm2 = m.m1 * (m.m2 + (positivo(m.m3) ? m.m3 : 0));
      break;
    case "letras":
      if (positivo(m.altura) && positivo(m.letras)) cm2 = m.altura * (m.altura * anchoDeLetra) * Math.floor(m.letras);
      break;
    case "manual":
      break;
  }
  return cm2 === null ? null : redondear4(cm2 / 10000);
}

const n = (x: number) => String(+x.toFixed(2));

/** "30 × 20 × 20 cm", "Ø 20 × 25 cm", "12 letras de 15 cm". Vacío si no hay ninguna. */
export function textoDeMedidas(m: Medidas): string {
  if (positivo(m.letras) && positivo(m.altura)) {
    return `${Math.floor(m.letras)} ${m.letras === 1 ? "letra" : "letras"} de ${n(m.altura)} cm`;
  }
  if (positivo(m.diametro)) {
    const alto = positivo(m.altura) ? m.altura : m.m1;
    return positivo(alto) ? `Ø ${n(m.diametro)} × ${n(alto)} cm` : `Ø ${n(m.diametro)} cm`;
  }
  const lados = [m.m1, m.m2, m.m3].filter(positivo);
  if (lados.length) return `${lados.map(n).join(" × ")} cm`;
  return positivo(m.altura) ? `${n(m.altura)} cm de alto` : "";
}

/** Las mismas medidas, sin lo que no es un número mayor que cero. */
export function limpiarMedidas(m: Medidas): Medidas {
  const salida: Medidas = {};
  for (const k of ["m1", "m2", "m3", "diametro", "altura", "letras"] as const) {
    if (positivo(m[k])) salida[k] = k === "letras" ? Math.floor(m[k]!) : m[k]!;
  }
  return salida;
}
