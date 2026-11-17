/**
 * Los almacenes en Odoo, contra el Odoo falso: crearlos una sola vez, saber
 * cuánto hay en cada uno, y meterles stock con una compra o un ajuste.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BASE, CLAVE, USUARIO, crearOdooFalso } from "../../e2e/odoo-falso.mjs";
import {
  ajustarInventario,
  asegurarAlmacen,
  asegurarTransito,
  enviarATransito,
  ingresarCompra,
  leerAlmacen,
  recibirDeTransito,
  stockPorAlmacen,
} from "./almacenes";
import { crearLoteSobrante } from "./sobrantes";
import { almacenDeVenta, cambiarAlmacenDeVenta, confirmarPedidoDeVenta, crearPedidoDeVenta } from "./pedidos-venta";
import { reiniciarCacheOdoo } from "./rpc";

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

describe("compra, ajuste y stock por almacén", () => {
  it("una compra entra al almacén con su proveedor y su costo, y no se duplica al reintentar", async () => {
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

    const [p] = odoo.estado().pickings;
    expect(p).toMatchObject({ state: "done", picking_type_code: "incoming", partner_id: [2, ""], partner_ref: "F001-123" });
    expect(p.movimientos).toEqual([expect.objectContaining({ product_uom_qty: 4, price_unit: 150, quantity: 4, picked: true })]);

    const stock = await stockPorAlmacen([20], [{ almacenId: "cat", ubicacionId: taller.ubicacionId }]);
    expect(stock.get(20)).toEqual({ porAlmacen: { cat: 4 }, total: 14, fuera: 10 });
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
