/**
 * Cómo se arma un producto terminado, paso a paso. Por ahora, las cajas.
 *
 * Cada paso agrega unas caras a la caja; el dibujo en 3D
 * (`components/terminados/armado-caja.tsx`) las coloca. Las medidas son las
 * exteriores, como en el despiece (`piezas.ts`):
 *
 *   m1  el largo  (eje x)
 *   m2  el ancho  (eje z, la profundidad)
 *   m3  el alto   (eje y)
 *
 * Puro: sin React, para probarlo sin navegador.
 */

import type { Geometria, Medidas } from "./geometria";

export type Cara = "base" | "frente" | "fondo" | "izquierda" | "derecha" | "tapa";

export interface PasoDeArmado {
  titulo: string;
  /** Qué hacer, en una o dos frases. */
  indicacion: string;
  /** Las caras que se agregan en este paso. */
  caras: Cara[];
  /** La medida de cada cara de este paso, en cm: "30 × 20 cm". */
  medida: string;
  cantidad: number;
}

export interface ArmadoDeCaja {
  /** cm */
  largo: number;
  ancho: number;
  alto: number;
  pasos: PasoDeArmado[];
}

const positivo = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x) && x > 0;
const n = (x: number) => String(+x.toFixed(2));

/** Las geometrías que se saben armar en 3D. */
export const tieneArmado = (g: Geometria) => g === "caja_cerrada" || g === "caja_abierta";

/** Los pasos para armar una caja, o `null` si no es una caja o le faltan medidas. */
export function armadoDeCaja(geometria: Geometria, m: Medidas): ArmadoDeCaja | null {
  if (!tieneArmado(geometria) || !positivo(m.m1) || !positivo(m.m2) || !positivo(m.m3)) return null;
  const [largo, ancho, alto] = [m.m1, m.m2, m.m3];

  const pasos: PasoDeArmado[] = [
    {
      titulo: "Base",
      indicacion: "Apoya la base sobre la mesa, con el lado protegido hacia abajo. Las paredes van sobre ella.",
      caras: ["base"],
      medida: `${n(largo)} × ${n(ancho)} cm`,
      cantidad: 1,
    },
    {
      titulo: "Frente y fondo",
      indicacion: "Pega el frente y el fondo de pie, sobre los dos bordes largos de la base.",
      caras: ["frente", "fondo"],
      medida: `${n(largo)} × ${n(alto)} cm`,
      cantidad: 2,
    },
    {
      titulo: "Laterales",
      indicacion: "Cierra los costados: cada lateral va entre el frente y el fondo. Escuadra antes de que seque.",
      caras: ["izquierda", "derecha"],
      medida: `${n(ancho)} × ${n(alto)} cm`,
      cantidad: 2,
    },
  ];
  if (geometria === "caja_cerrada") {
    pasos.push({
      titulo: "Tapa",
      indicacion: "La tapa va encima. Si es removible no se pega: solo se verifica que asiente parejo.",
      caras: ["tapa"],
      medida: `${n(largo)} × ${n(ancho)} cm`,
      cantidad: 1,
    });
  }
  return { largo, ancho, alto, pasos };
}
