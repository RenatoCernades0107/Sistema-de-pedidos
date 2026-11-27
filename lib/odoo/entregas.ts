/**
 * Lo que pasa en el almacén de Odoo después de vender: descontar el stock al
 * terminar el pedido, y soltar la reserva si el pedido se anula antes.
 *
 * Al confirmarse la venta, Odoo crea una entrega (`stock.picking` de salida) con
 * un movimiento (`stock.move`) por cada producto almacenable, y reserva las
 * planchas. El stock real no baja hasta que esa entrega se valida: eso es
 * `validarEntrega`, con las cantidades que de verdad salieron.
 *
 * Supone la entrega en un paso (la configuración por defecto del almacén). Con
 * recolección y empaque habría varias operaciones en cadena, y aquí solo se
 * valida la que está lista.
 */

import { campoCantidad, ejecutar, ErrorOdoo, idDe, texto } from "./rpc";

type Fila = Record<string, unknown>;

/** Cuánto sale de cada producto: id de `product.product` → unidades. */
export type CantidadesPorProducto = Map<number, number>;

export interface MovimientoDeEntrega {
  id: number;
  productoId: number;
  /** Lo que la venta pidió. */
  demanda: number;
}

const redondear = (n: number) => Math.round((n + Number.EPSILON) * 1e4) / 1e4;

/**
 * Reparte lo que de verdad salió de cada producto entre los movimientos de la
 * entrega. Una venta puede tener el mismo producto en varias líneas —un corte va
 * como "2 planchas completas" y "1 media", las dos del mismo producto—, y cada
 * línea es un movimiento. Se llenan en orden hasta su demanda, y lo que sobra va
 * al último: si se usaron más planchas de las calculadas, salen igual.
 *
 * Un producto que la venta no tiene no se puede sacar por esta entrega: se
 * ignora.
 */
export function repartirCantidades(
  movimientos: MovimientoDeEntrega[],
  cantidades: CantidadesPorProducto,
): Map<number, number> {
  const salida = new Map<number, number>();
  const porProducto = new Map<number, MovimientoDeEntrega[]>();
  for (const m of movimientos) {
    porProducto.set(m.productoId, [...(porProducto.get(m.productoId) ?? []), m]);
  }

  for (const [productoId, lista] of porProducto) {
    // Un producto del que nadie dijo nada sale tal como se vendió.
    let resto = cantidades.get(productoId) ?? lista.reduce((s, m) => s + m.demanda, 0);
    lista.forEach((m, i) => {
      const ultimo = i === lista.length - 1;
      const toca = ultimo ? Math.max(0, resto) : Math.min(m.demanda, Math.max(0, resto));
      salida.set(m.id, redondear(toca));
      resto -= toca;
    });
  }
  return salida;
}

/**
 * El contexto con que se valida. `skip_backorder` + `picking_ids_not_to_backorder`
 * dicen "lo que no salió, no va a salir": sin ellos, una entrega con menos de lo
 * pedido abre el asistente de entregas parciales, que por la API no se puede
 * contestar. `skip_immediate` (hasta la 16) y `skip_sms` evitan otros dos
 * asistentes.
 */
const contextoValidar = (ids: number[]) => ({
  skip_backorder: true,
  picking_ids_not_to_backorder: ids,
  skip_immediate: true,
  skip_sms: true,
});

/** Si el resultado de un botón es un asistente que espera respuesta. */
const esAsistente = (r: unknown) => typeof r === "object" && r !== null && "res_model" in r;

export type ResultadoEntrega =
  /** `yaEstaba`: alguien la validó antes (desde aquí o desde Odoo). */
  | { estado: "validada"; yaEstaba: boolean }
  /** La venta no tiene productos almacenables: no hay stock que descontar. */
  | { estado: "sin-entrega" };

/**
 * Valida la entrega de una venta con lo que realmente salió. Se puede repetir:
 * si ya está validada, no hace nada.
 *
 * Si la venta todavía es una cotización (se registró con Odoo caído y nadie la
 * confirmó), primero se confirma: sin eso no hay entrega que validar.
 */
/** Una pieza del almacén (un sobrante) que sale con la venta: su producto y su lote. */
export interface PiezaDeEntrega {
  productoId: number;
  loteId: number;
}

export async function validarEntrega(
  orderId: number,
  cantidades: CantidadesPorProducto,
  /**
   * Las piezas del almacén que vende un corte. Su producto va por lotes y cada
   * pieza es una distinta: salen con su lote exacto, no con el que Odoo reservó.
   */
  piezas: PiezaDeEntrega[] = [],
): Promise<ResultadoEntrega> {
  const ordenes = await ejecutar<Fila[]>("sale.order", "read", [[orderId]], { fields: ["state"] });
  const estadoOrden = texto(ordenes[0]?.state);
  if (!estadoOrden) throw new ErrorOdoo("La orden de venta ya no existe en Odoo.");
  if (estadoOrden === "cancel") throw new ErrorOdoo("La orden de venta está cancelada en Odoo.");
  if (estadoOrden === "draft" || estadoOrden === "sent") {
    await ejecutar("sale.order", "action_confirm", [[orderId]]);
  }

  const entregas = await ejecutar<Fila[]>(
    "stock.picking",
    "search_read",
    [[["sale_id", "=", orderId], ["picking_type_code", "=", "outgoing"]]],
    { fields: ["state"] },
  );
  const pendientes = entregas.filter((e) => e.state !== "done" && e.state !== "cancel").map((e) => e.id as number);
  if (pendientes.length === 0) {
    return entregas.some((e) => e.state === "done")
      ? { estado: "validada", yaEstaba: true }
      : { estado: "sin-entrega" };
  }

  const filas = await ejecutar<Fila[]>(
    "stock.move",
    "search_read",
    [[["picking_id", "in", pendientes], ["state", "not in", ["done", "cancel"]]]],
    { fields: ["product_id", "product_uom_qty", "location_id", "location_dest_id"], order: "id" },
  );
  const conLote = new Set(piezas.map((p) => p.productoId));
  const movimientos: MovimientoDeEntrega[] = filas
    .map((f) => ({ id: f.id as number, productoId: idDe(f.product_id) ?? 0, demanda: Number(f.product_uom_qty) || 0 }))
    .filter((m) => m.productoId > 0 && !conLote.has(m.productoId));
  const reparto = repartirCantidades(movimientos, cantidades);
  const movimientosDePiezas = filas.filter((f) => conLote.has(idDe(f.product_id) ?? 0));

  if ([...reparto.values()].every((q) => q <= 0) && piezas.length === 0) {
    throw new ErrorOdoo("No salió nada del almacén: la entrega no se puede validar con todo en cero.");
  }

  /* Desde la 17 la cantidad hecha es `quantity` y se marca `picked`; hasta la 16
     era `quantity_done`. Se escribe la que este Odoo tenga. */
  const { picked, campoMov: campo, campoLinea } = await campoCantidad();

  for (const [moveId, cantidad] of reparto) {
    const valores: Record<string, unknown> = { [campo]: cantidad };
    if (picked) valores.picked = cantidad > 0;
    await ejecutar("stock.move", "write", [[moveId], valores]);
  }

  await sacarPiezas(movimientosDePiezas, piezas, { picked, campoLinea });

  const r = await ejecutar("stock.picking", "button_validate", [pendientes], {
    context: contextoValidar(pendientes),
  });
  if (esAsistente(r)) {
    throw new ErrorOdoo("Odoo pidió confirmar algo más para validar la entrega. Valídala desde Odoo.");
  }
  return { estado: "validada", yaEstaba: false };
}

/**
 * Las piezas del almacén, cada una con su lote: se quita lo que Odoo reservó por
 * su cuenta (puede ser otra pieza del mismo material) y se pone una línea por
 * lote, desde donde está ese lote. Cada movimiento se lleva tantos lotes como su
 * demanda, en orden; los que sobran van al último.
 */
async function sacarPiezas(
  movimientos: Fila[],
  piezas: PiezaDeEntrega[],
  campos: { picked: boolean; campoLinea: string },
) {
  if (!piezas.length) return;
  const porProducto = new Map<number, Fila[]>();
  for (const m of movimientos) {
    const p = idDe(m.product_id) ?? 0;
    porProducto.set(p, [...(porProducto.get(p) ?? []), m]);
  }

  for (const [productoId, lista] of porProducto) {
    const lotes = piezas.filter((p) => p.productoId === productoId).map((p) => p.loteId);
    const previas = await ejecutar<number[]>("stock.move.line", "search", [
      [["move_id", "in", lista.map((m) => m.id as number)], ["state", "!=", "done"]],
    ]);
    if (previas.length) await ejecutar("stock.move.line", "unlink", [previas]);

    let i = 0;
    for (const [n, m] of lista.entries()) {
      const toca = n === lista.length - 1 ? lotes.length - i : Math.min(Number(m.product_uom_qty) || 0, lotes.length - i);
      for (const lote of lotes.slice(i, i + toca)) {
        await ejecutar("stock.move.line", "create", [
          {
            move_id: m.id,
            product_id: productoId,
            lot_id: lote,
            location_id: (await dondeEsta(lote)) ?? idDe(m.location_id),
            location_dest_id: idDe(m.location_dest_id),
            [campos.campoLinea]: 1,
            ...(campos.picked ? { picked: true } : {}),
          },
        ]);
      }
      i += toca;
      if (campos.picked) await ejecutar("stock.move", "write", [[m.id], { picked: toca > 0 }]);
    }
  }
}

/** La ubicación interna donde hay stock de un lote. */
async function dondeEsta(loteId: number): Promise<number | null> {
  const quants = await ejecutar<Fila[]>(
    "stock.quant",
    "search_read",
    [[["lot_id", "=", loteId], ["quantity", ">", 0], ["location_id.usage", "=", "internal"]]],
    { fields: ["location_id"], limit: 1 },
  );
  return idDe(quants[0]?.location_id);
}

/**
 * Cancela la venta de un pedido anulado: Odoo suelta la reserva de las planchas
 * y cancela la entrega. Se puede repetir.
 *
 * Solo sirve mientras nada salió del almacén. Después, deshacer es una
 * devolución, y eso no se hace desde aquí.
 */
export async function cancelarPedidoDeVenta(orderId: number): Promise<void> {
  const ordenes = await ejecutar<Fila[]>("sale.order", "read", [[orderId]], { fields: ["state"] });
  const estado = texto(ordenes[0]?.state);
  if (!estado) throw new ErrorOdoo("La orden de venta ya no existe en Odoo.");
  if (estado === "cancel") return;
  if (estado === "done") throw new ErrorOdoo("La orden está bloqueada en Odoo: hay que desbloquearla para cancelarla.");

  // Desde la 15, cancelar una orden confirmada abre un asistente que pregunta si
  // avisar al cliente. `disable_cancel_warning` lo salta.
  const r = await ejecutar("sale.order", "action_cancel", [[orderId]], {
    context: { disable_cancel_warning: true },
  });
  if (esAsistente(r)) {
    throw new ErrorOdoo("Odoo pidió confirmar la cancelación. Cancélala desde Odoo.");
  }
}
