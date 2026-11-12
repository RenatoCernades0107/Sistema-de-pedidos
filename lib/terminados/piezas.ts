/**
 * Las piezas que se cortan para una unidad de un producto terminado, deducidas
 * de su forma y sus medidas.
 *
 * Son rectángulos con las medidas exteriores, sin descontar el espesor: para
 * presupuestar es mejor sobrar un poco que quedarse corto. Lo redondo (las tapas
 * de un cilindro, una letra) se corta de su rectángulo envolvente, que es lo que
 * ocupa en la plancha.
 *
 * Puro: lo usan el navegador y el servidor.
 */

import type { PiezaPedida } from "../cortes/calcular";
import type { Geometria, Medidas } from "./geometria";

export interface PiezaDeTerminado extends PiezaPedida {
  /** "Base y tapa", "Laterales"… */
  nombre: string;
}

const positivo = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x) && x > 0;

/** Al milímetro, hacia arriba: una pieza nunca sale más chica de lo que hace falta. */
const alMm = (x: number) => Math.ceil(x * 10 - 1e-9) / 10;

/**
 * Junta las piezas de la misma medida (en cualquier orientación: se pueden
 * girar) en una sola fila. Un cubo son seis caras iguales: una fila de seis.
 */
function juntar(piezas: PiezaDeTerminado[]): PiezaDeTerminado[] {
  const salida: PiezaDeTerminado[] = [];
  for (const p of piezas) {
    const igual = salida.find(
      (q) =>
        (Math.abs(q.ancho - p.ancho) < 1e-6 && Math.abs(q.alto - p.alto) < 1e-6) ||
        (Math.abs(q.ancho - p.alto) < 1e-6 && Math.abs(q.alto - p.ancho) < 1e-6),
    );
    if (igual) {
      igual.cantidad += p.cantidad;
      igual.nombre = `${igual.nombre}, ${p.nombre.toLowerCase()}`;
    } else salida.push({ ...p });
  }
  return salida;
}

/**
 * Las piezas de una unidad. `null` si la forma no se despieza (la manual) o le
 * falta alguna medida.
 */
export function piezasDeTerminado(geometria: Geometria, m: Medidas, anchoDeLetra = 0.7): PiezaDeTerminado[] | null {
  const pieza = (nombre: string, ancho: number, alto: number, cantidad: number): PiezaDeTerminado => ({
    nombre,
    ancho: alMm(ancho),
    alto: alMm(alto),
    cantidad,
  });

  switch (geometria) {
    case "caja_cerrada":
    case "caja_abierta": {
      if (!positivo(m.m1) || !positivo(m.m2) || !positivo(m.m3)) return null;
      const cerrada = geometria === "caja_cerrada";
      return juntar([
        pieza(cerrada ? "Base y tapa" : "Base", m.m1, m.m2, cerrada ? 2 : 1),
        pieza("Frente y fondo", m.m1, m.m3, 2),
        pieza("Laterales", m.m2, m.m3, 2),
      ]);
    }
    case "cilindro": {
      // El tambor de sorteo viene como diámetro × largo: el largo hace de altura.
      const alto = positivo(m.altura) ? m.altura : m.m1;
      if (!positivo(m.diametro) || !positivo(alto)) return null;
      return [pieza("Pared (se curva)", Math.PI * m.diametro, alto, 1), pieza("Tapas", m.diametro, m.diametro, 2)];
    }
    case "lamina":
      if (!positivo(m.m1) || !positivo(m.m2)) return null;
      return [pieza("Lámina", m.m1, m.m2, 1)];
    case "lamina_plegada":
      if (!positivo(m.m1) || !positivo(m.m2)) return null;
      return [pieza("Lámina (se dobla)", m.m1, m.m2 + (positivo(m.m3) ? m.m3 : 0), 1)];
    case "letras":
      if (!positivo(m.altura) || !positivo(m.letras) || !(anchoDeLetra > 0)) return null;
      return [pieza("Letras", m.altura * anchoDeLetra, m.altura, Math.floor(m.letras))];
    case "manual":
      return null;
  }
}
