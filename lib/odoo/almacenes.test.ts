/**
 * Los almacenes en Odoo, contra el Odoo falso: crearlos una sola vez, saber
 * cuánto hay en cada uno, y meterles stock con una compra o un ajuste.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BASE, CLAVE, USUARIO, crearOdooFalso } from "../../e2e/odoo-falso.mjs";
import {
  ajustarInventario,
  ajustarPorDiferencia,
  asegurarAlmacen,
  darDeBaja,
  movimientosDeProducto,
  asegurarTransito,
  enviarATransito,
  ingresarCompra,
  leerAlmacen,
  recibirDeTransito,
  stockPorAlmacen,
} from "./almacenes";
import { crearLoteSobrante } from "./sobrantes";
import { almacenDeVenta, cambiarAlmacenDeVenta, confirmarPedidoDeVenta, crearPedidoDeVenta } from "./pedidos-venta";
import { ejecutar, reiniciarCacheOdoo } from "./rpc";

let odoo: Awaited<ReturnType<typeof crearOdooFalso>>;

beforeAll(async () => {
  odoo = await crearOdooFalso();
  vi.stubEnv("ODOO_URL", odoo.url);
  vi.stubEnv("ODOO_DB", BASE);
  vi.stubEnv("ODOO_USERNAME", USUARIO);
  vi.stubEnv("ODOO_PASSWORD", CLAVE);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await odoo.cerrar();
});

beforeEach(() => {
  odoo.reiniciar();
  reiniciarCacheOdoo();
});

describe("asegurarAlmacen", () => {
  it("crea el almacén con sus operaciones, y la segunda vez lo reutiliza", async () => {
    const a = await asegurarAlmacen({ nombre: "Católica", codigo: "CAT" });
    const b = await asegurarAlmacen({ nombre: "Católica", codigo: "CAT" });
    expect(b).toEqual(a);
    expect(a.recepcionId).toBeTruthy();
    expect(a.internoId).toBeTruthy();
    expect(a.fabricacionId).toBeTruthy();
    expect(odoo.estado().almacenes.map((w) => w.code)).toEqual(["WH", "CAT"]);
  });
});

/** Una compra como se hacía antes: la recepción sola, ya validada, sin orden de compra. */
async function crearRecepcionSuelta(almacen: Awaited<ReturnType<typeof asegurarAlmacen>>, origen: string): Promise<number> {
  const picking = await ejecutar<number>("stock.picking", "create", [
    { picking_type_id: almacen.recepcionId, partner_id: 2, origin: origen, location_id: 11, location_dest_id: almacen.ubicacionId },
  ]);
  const mov = await ejecutar<number>("stock.move", "create", [
    { picking_id: picking, product_id: 20, product_uom_qty: 4, product_uom: 1, location_id: 11, location_dest_id: almacen.ubicacionId, price_unit: 150, name: "Compra" },
  ]);
  await ejecutar("stock.picking", "action_confirm", [[picking]]);
  await ejecutar("stock.move", "write", [[mov], { quantity: 4, picked: true }]);
  await ejecutar("stock.picking", "button_validate", [[picking]], { context: { skip_backorder: true } });
  return picking;
}

describe("compra, ajuste y stock por almacén", () => {
  it("una compra es una orden de compra de Odoo, recibida por completo, y no se duplica al reintentar", async () => {
    const taller = await asegurarAlmacen({ nombre: "Católica", codigo: "CAT" });
    const compra = {
      almacen: taller,
      proveedorId: 2,
      origen: "App Plexiacril ING-00001",
      documento: "F001-123",
      lineas: [{ productoId: 20, cantidad: 4, costo: 150 }],
    };
    const id = await ingresarCompra(compra);
    expect(await ingresarCompra(compra)).toBe(id);

    const { compras, pickings } = odoo.estado();
    expect(compras).toHaveLength(1);
    expect(compras[0]).toMatchObject({
      state: "purchase",
      origin: "App Plexiacril ING-00001",
      partner_id: [2, expect.anything()],
      partner_ref: "F001-123",
      picking_type_id: [taller.recepcionId, expect.anything()],
    });
    expect(compras[0].lineas).toEqual([expect.objectContaining({ product_qty: 4, price_unit: 150, qty_received: 4 })]);

    expect(pickings).toHaveLength(1);
    const [p] = pickings;
    expect(p).toMatchObject({ id, state: "done", picking_type_code: "incoming", purchase_id: [compras[0].id, compras[0].name] });
    expect(p.movimientos).toEqual([expect.objectContaining({ product_uom_qty: 4, price_unit: 150, quantity: 4, picked: true })]);

    const stock = await stockPorAlmacen([20], [{ almacenId: "cat", ubicacionId: taller.ubicacionId }]);
    expect(stock.get(20)).toEqual({ porAlmacen: { cat: 4 }, total: 14, fuera: 10 });
  });

  it("si Odoo falla al confirmar, reintentar retoma la misma orden sin duplicarla", async () => {
    const taller = await asegurarAlmacen({ nombre: "Católica", codigo: "CAT" });
    const compra = { almacen: taller, proveedorId: 2, origen: "App Plexiacril ING-00002", documento: null, lineas: [{ productoId: 21, cantidad: 3, costo: 80 }] };
    odoo.fijarModo("compra-por-aprobar");
    await expect(ingresarCompra(compra)).rejects.toThrow(/espera aprobación/);
    expect(odoo.estado().pickings).toHaveLength(0);

    odoo.fijarModo(null);
    // La orden quedó "to approve": se aprueba en Odoo y se reintenta.
    await ejecutar("purchase.order", "button_approve", [[odoo.estado().compras[0].id]]);
    const id = await ingresarCompra(compra);
    expect(odoo.estado().compras).toHaveLength(1);
    expect(odoo.estado().pickings).toEqual([expect.objectContaining({ id, state: "done" })]);
  });

  it("una compra sin la app Compras instalada avisa qué hacer, y no mete stock", async () => {
    const taller = await asegurarAlmacen({ nombre: "Católica", codigo: "CAT" });
    const modelos = odoo.estado().modelos;
    modelos.splice(modelos.findIndex((m) => m.model === "purchase.order"), 1);
    await expect(
      ingresarCompra({ almacen: taller, proveedorId: 2, origen: "App Plexiacril ING-00003", documento: null, lineas: [{ productoId: 20, cantidad: 1 }] }),
    ).rejects.toThrow(/app Compras/);
    expect(odoo.estado().pickings).toHaveLength(0);
  });

  it("una compra de antes (recepción sin orden) se deja como está: no duplica el stock", async () => {
    const taller = await asegurarAlmacen({ nombre: "Católica", codigo: "CAT" });
    const vieja = await crearRecepcionSuelta(taller, "App Plexiacril ING-00004");
    const compra = { almacen: taller, proveedorId: 2, origen: "App Plexiacril ING-00004", documento: null, lineas: [{ productoId: 20, cantidad: 4, costo: 150 }] };
    expect(await ingresarCompra(compra)).toBe(vieja);
    expect(odoo.estado().compras).toHaveLength(0);
    expect(odoo.estado().pickings).toHaveLength(1);
  });

  it("un ajuste deja lo contado y devuelve lo que había", async () => {
    const tienda = await asegurarAlmacen({ nombre: "Andahuaylas", codigo: "AND" });
    await ajustarInventario({ ubicacionId: tienda.ubicacionId, lineas: [{ productoId: 20, cantidad: 3 }] });
    const antes = await ajustarInventario({ ubicacionId: tienda.ubicacionId, lineas: [{ productoId: 20, cantidad: 1 }] });
    expect(antes.get(20)).toBe(3);
    const stock = await stockPorAlmacen([20], [{ almacenId: "and", ubicacionId: tienda.ubicacionId }]);
    expect(stock.get(20)?.porAlmacen.and).toBe(1);
  });

  it("una transferencia sale a tránsito y llega al recibirla", async () => {
    const tienda = await asegurarAlmacen({ nombre: "Andahuaylas", codigo: "AND" });
    const taller = await asegurarAlmacen({ nombre: "Católica", codigo: "CAT" });
    await ajustarInventario({ ubicacionId: taller.ubicacionId, lineas: [{ productoId: 21, cantidad: 5 }] });
    const ubicaciones = [
      { almacenId: "and", ubicacionId: tienda.ubicacionId },
      { almacenId: "cat", ubicacionId: taller.ubicacionId },
    ];
    const t = { desde: taller, hacia: tienda, origen: "App Plexiacril TRF-1", lineas: [{ productoId: 21, cantidad: 2 }] };

    const envio = await enviarATransito(t);
    // Enviar otra vez (un reintento) no la duplica.
    expect(await enviarATransito(t)).toBe(envio);
    let stock = await stockPorAlmacen([21], ubicaciones);
    expect(stock.get(21)?.porAlmacen).toEqual({ and: 0, cat: 3 });
    const transito = await asegurarTransito();
    expect(await asegurarTransito()).toBe(transito);
    expect(odoo.estado().pickings.find((p) => p.id === envio)).toMatchObject({
      origin: "App Plexiacril TRF-1 envío",
      state: "done",
      picking_type_id: [taller.internoId, expect.anything()],
      location_dest_id: [transito, ""],
    });

    await recibirDeTransito(t);
    stock = await stockPorAlmacen([21], ubicaciones);
    expect(stock.get(21)?.porAlmacen).toEqual({ and: 2, cat: 3 });
  });

  it("un sobrante viaja como su lote, y no otro del mismo producto", async () => {
    const tienda = await asegurarAlmacen({ nombre: "Andahuaylas", codigo: "AND" });
    const taller = await asegurarAlmacen({ nombre: "Católica", codigo: "CAT" });
    const material = { codigoBase: "F7E024", nombre: "SOBRANTE ACRILICO ECO CRISTAL 3MM" };
    const nuevo = (nombre: string) =>
      crearLoteSobrante({ material, nombre, largo: 100, ancho: 50, nota: null, ubicacionId: taller.ubicacionId });
    const otro = await nuevo("SOB-00001");
    const lote = await nuevo("SOB-00002");
    const productoId = odoo.estado().lotes.find((l) => l.id === lote)!.product_id as [number, string];

    const t = { desde: taller, hacia: tienda, origen: "App Plexiacril TRF-2", lineas: [{ productoId: productoId[0], cantidad: 1, loteId: lote }] };
    await enviarATransito(t);
    await recibirDeTransito(t);

    const dondeEsta = (id: number) =>
      odoo
        .estado()
        .quants.filter((q) => (q.lot_id as [number, string] | false) && (q.lot_id as [number, string])[0] === id && Number(q.quantity) > 0)
        .map((q) => (q.location_id as [number, string])[0]);
    expect(dondeEsta(lote)).toEqual([tienda.ubicacionId]);
    expect(dondeEsta(otro)).toEqual([taller.ubicacionId]);
  });

  it("el stock libre no cuenta lo reservado", async () => {
    const tienda = await asegurarAlmacen({ nombre: "Andahuaylas", codigo: "AND" });
    await ajustarInventario({ ubicacionId: tienda.ubicacionId, lineas: [{ productoId: 20, cantidad: 4 }] });
    const stock = await stockPorAlmacen([20], [{ almacenId: "and", ubicacionId: tienda.ubicacionId }], { libre: true });
    expect(stock.get(20)?.porAlmacen.and).toBe(4);
    expect(odoo.estado().llamadas.some((l) => JSON.stringify(l.kwargs.fields) === '["free_qty"]')).toBe(true);
  });
});

describe("la venta y su almacén", () => {
  const linea = { productoId: 20, nombreProducto: "PLANCHA", codigo: "F7E024", cantidad: 1, precioUnitario: 200, descripcion: null };

  it("sale del almacén que se le dice, y la entrega descuenta de ahí", async () => {
    const tienda = await asegurarAlmacen({ nombre: "Andahuaylas", codigo: "AND" });
    const taller = await asegurarAlmacen({ nombre: "Católica", codigo: "CAT" });
    const v = await crearPedidoDeVenta({ cotizacionId: "c-alm", clienteId: 1, lineas: [linea], warehouseId: tienda.warehouseId });
    expect(await almacenDeVenta(v.orderId)).toBe(tienda.warehouseId);

    // Mientras es cotización se puede cambiar; confirmada, ya no.
    expect(await cambiarAlmacenDeVenta(v.orderId, taller.warehouseId)).toBe(true);
    expect(await almacenDeVenta(v.orderId)).toBe(taller.warehouseId);
    await confirmarPedidoDeVenta(v.orderId);
    expect(await cambiarAlmacenDeVenta(v.orderId, tienda.warehouseId)).toBe(false);

    const [orden] = odoo.estado().ordenes;
    expect(orden.entregas[0].movimientos[0]).toMatchObject({ location_id: [taller.ubicacionId, ""] });
  });
});

describe("leerAlmacen", () => {
  it("con el código, un id que ahora es de otro almacén cuenta como que no existe", async () => {
    const tienda = await asegurarAlmacen({ nombre: "Andahuaylas", codigo: "AND" });
    await expect(leerAlmacen(tienda.warehouseId, "AND")).resolves.toEqual(tienda);
    await expect(leerAlmacen(tienda.warehouseId, "CAT")).rejects.toThrow(/ya no es CAT/);
    await expect(leerAlmacen(999, "AND")).rejects.toThrow(/ya no existe/);
  });
});

describe("bajas, diferencias y kárdex", () => {
  it("una baja es un desecho validado; repetirla con el mismo origen no la duplica", async () => {
    const taller = await asegurarAlmacen({ nombre: "Católica", codigo: "CAT" });
    await ajustarInventario({ ubicacionId: taller.ubicacionId, lineas: [{ productoId: 20, cantidad: 5 }] });
    const baja = { ubicacionId: taller.ubicacionId, productoId: 20, cantidad: 2, origen: "App Plexiacril CAS-1" };
    const id = await darDeBaja(baja);
    expect(await darDeBaja(baja)).toBe(id);
    const stock = await stockPorAlmacen([20], [{ almacenId: "cat", ubicacionId: taller.ubicacionId }]);
    expect(stock.get(20)?.porAlmacen.cat).toBe(3);
  });

  it("no da de baja más de lo que hay", async () => {
    const taller = await asegurarAlmacen({ nombre: "Católica", codigo: "CAT" });
    await expect(darDeBaja({ ubicacionId: taller.ubicacionId, productoId: 22, cantidad: 1, origen: "App Plexiacril CAS-2" })).rejects.toThrow(
      /no hay suficiente stock/,
    );
  });

  it("una diferencia suma o quita sobre lo que hay ahora, no sobre lo contado", async () => {
    const taller = await asegurarAlmacen({ nombre: "Católica", codigo: "CAT" });
    await ajustarInventario({ ubicacionId: taller.ubicacionId, lineas: [{ productoId: 21, cantidad: 5 }] });
    // Se contaron 4 (falta 1), y mientras tanto salieron 2: quedan 3, y al aplicar, 2.
    await ajustarInventario({ ubicacionId: taller.ubicacionId, lineas: [{ productoId: 21, cantidad: 3 }] });
    await ajustarPorDiferencia({ almacen: taller, productoId: 21, delta: -1, origen: "App Plexiacril CAS-3" });
    await ajustarPorDiferencia({ almacen: taller, productoId: 21, delta: -1, origen: "App Plexiacril CAS-3" });
    await ajustarPorDiferencia({ almacen: taller, productoId: 21, delta: 2, origen: "App Plexiacril CAS-4" });
    const stock = await stockPorAlmacen([21], [{ almacenId: "cat", ubicacionId: taller.ubicacionId }]);
    expect(stock.get(21)?.porAlmacen.cat).toBe(4);
  });

  it("el kárdex trae cada movimiento hecho con su origen, del más nuevo al más viejo", async () => {
    const taller = await asegurarAlmacen({ nombre: "Católica", codigo: "CAT" });
    await ajustarInventario({ ubicacionId: taller.ubicacionId, lineas: [{ productoId: 20, cantidad: 5 }] });
    await darDeBaja({ ubicacionId: taller.ubicacionId, productoId: 20, cantidad: 1, origen: "App Plexiacril CAS-9" });
    await ajustarPorDiferencia({ almacen: taller, productoId: 20, delta: 2, origen: "App Plexiacril CAS-10" });
    const movs = await movimientosDeProducto({ productoId: 20, ubicaciones: [taller.ubicacionId] });
    expect(movs.map((m) => ({ c: m.cantidad, o: m.origen, b: m.baja, i: m.inventario, h: m.hacia === taller.ubicacionId }))).toEqual([
      { c: 2, o: "App Plexiacril CAS-10", b: false, i: false, h: true },
      { c: 1, o: "App Plexiacril CAS-9", b: true, i: false, h: false },
      { c: 5, o: null, b: false, i: true, h: true },
    ]);
  });
});
