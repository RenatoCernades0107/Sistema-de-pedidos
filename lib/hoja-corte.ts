/**
 * Lo que la hoja de corte dice en palabras: qué indicaciones dejó quien registró
 * el pedido y de dónde sale cada plancha.
 *
 * Funciones puras: las usa la hoja en el navegador y las pruebas sin React.
 */

import { detalleDesdeLineas } from "./cotizaciones";
import { filaDe } from "./cortes/calcular";
import type { CorteGuardado, PlanchaGuardada } from "./cortes/guardado";
import type { LineaDePedido } from "./pedido-lineas";

/**
 * Las indicaciones para el taller, sin la lista de productos que el detalle del
 * pedido lleva delante.
 *
 * Al registrar, el detalle se arma como "las líneas + una línea en blanco + las
 * indicaciones" (`registrarPedido`). En la hoja las líneas ya están dibujadas, así
 * que repetirlas sería ruido. Si el detalle no empieza por esas líneas —se editó
 * a mano, o es de un pedido de antes—, se devuelve entero: mejor de más que
 * perder una indicación.
 */
export function indicacionesDe(detalle: string, lineas: LineaDePedido[]): string {
  const texto = detalle.trim();
  if (!texto || lineas.length === 0) return texto;

  const base = detalleDesdeLineas(
    lineas.map((l) => ({
      posicion: l.posicion,
      productoId: l.productoId,
      nombre: l.nombre,
      codigo: l.codigo,
      descripcion: l.descripcion,
      cantidad: l.cantidad,
      precioUnitario: 0,
      corte: l.corte,
      terminado: l.terminado,
      importe: 0,
    })),
  );
  return texto.startsWith(base) ? texto.slice(base.length).trim() : texto;
}

const n = (x: number) => String(+x.toFixed(2));

/**
 * De qué sale una plancha: una nueva del formato elegido o un sobrante del
 * almacén. Los sobrantes llegan con la Fase 5; el plano ya sabe decirlo.
 */
export function origenDePlancha(
  p: Pick<PlanchaGuardada, "origen" | "ancho" | "alto">,
  formato: CorteGuardado["formato"],
): string {
  return p.origen.tipo === "sobrante"
    ? `Sobrante ${p.origen.id} del almacén (${n(p.ancho)}×${n(p.alto)})`
    : `Plancha nueva ${formato.codigo} (${n(p.ancho)}×${n(p.alto)})`;
}

/** Cuántas piezas de cada medida lleva una plancha: "4 × #1, 2 × #3". */
export function piezasDePlancha(p: Pick<PlanchaGuardada, "paneles">): { fila: number; cantidad: number }[] {
  const cuenta = new Map<number, number>();
  for (const panel of p.paneles) {
    if (panel.libre || !panel.piezaId) continue;
    const fila = filaDe(panel.piezaId);
    cuenta.set(fila, (cuenta.get(fila) ?? 0) + 1);
  }
  return [...cuenta].sort((a, b) => a[0] - b[0]).map(([fila, cantidad]) => ({ fila, cantidad }));
}
