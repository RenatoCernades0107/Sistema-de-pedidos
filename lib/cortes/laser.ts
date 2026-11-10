/**
 * Cuánto tarda y cuánto cuesta cortar unas piezas con el láser.
 *
 * No depende de cómo queden acomodadas en la plancha: solo del perímetro de cada
 * pieza y del espesor, que es lo que fija la velocidad.
 */

import type { ConfigCortes, FilaLaser } from "./config";

export interface PiezaPedida {
  /** cm */
  ancho: number;
  /** cm */
  alto: number;
  cantidad: number;
}

export interface TiempoLaser {
  segundos: number;
  /** Sin IGV. */
  costo: number;
}

/**
 * La fila que corresponde a un espesor: interpolada entre las dos vecinas y, si
 * cae fuera de la tabla, la del extremo. Las pasadas no se interpolan a medias:
 * 1.4 pasadas son 2.
 */
export function parametrosLaser(tabla: FilaLaser[], mm: number): FilaLaser {
  const filas = [...tabla].sort((a, b) => a.mm - b.mm);
  if (mm <= filas[0].mm) return { ...filas[0], mm };
  const ultima = filas[filas.length - 1];
  if (mm >= ultima.mm) return { ...ultima, mm };

  const i = filas.findIndex((f) => f.mm >= mm);
  const a = filas[i - 1];
  const b = filas[i];
  const t = (mm - a.mm) / (b.mm - a.mm);
  const entre = (x: number, y: number) => x + (y - x) * t;
  return {
    mm,
    velocidad: entre(a.velocidad, b.velocidad),
    pierce: entre(a.pierce, b.pierce),
    pasadas: Math.ceil(entre(a.pasadas, b.pasadas) - 1e-9),
  };
}

export function tiempoLaser(
  piezas: PiezaPedida[],
  espesorMm: number,
  config: ConfigCortes["laser"],
): TiempoLaser {
  const { velocidad, pierce, pasadas } = parametrosLaser(config.tabla, espesorMm);
  const efectiva = velocidad * config.factorVelocidad;

  let segundos = 0;
  for (const p of piezas) {
    if (!(p.ancho > 0) || !(p.alto > 0) || !(p.cantidad > 0)) continue;
    const perimetroMm = 2 * (p.ancho + p.alto) * 10;
    segundos += p.cantidad * ((perimetroMm * pasadas) / efectiva + pierce + config.overheadPorPieza);
  }
  return { segundos, costo: (segundos / 60) * config.costoPorMinuto };
}
