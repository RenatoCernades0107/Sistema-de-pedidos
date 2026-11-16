/**
 * Los almacenes en Odoo, contra el Odoo falso: crearlos una sola vez, saber
 * cuánto hay en cada uno, y meterles stock con una compra o un ajuste.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BASE, CLAVE, USUARIO, crearOdooFalso } from "../../e2e/odoo-falso.mjs";
import { ajustarInventario, asegurarAlmacen, ingresarCompra, leerAlmacen, stockPorAlmacen, transferirInterno } from "./almacenes";
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

  it("una transferencia pasa stock de un almacén a otro", async () => {
    const tienda = await asegurarAlmacen({ nombre: "Andahuaylas", codigo: "AND" });
    const taller = await asegurarAlmacen({ nombre: "Católica", codigo: "CAT" });
    await ajustarInventario({ ubicacionId: taller.ubicacionId, lineas: [{ productoId: 21, cantidad: 5 }] });
    await transferirInterno({ desde: taller, hacia: tienda, origen: "App Plexiacril TR-1", lineas: [{ productoId: 21, cantidad: 2 }] });
    const stock = await stockPorAlmacen(
      [21],
      [
        { almacenId: "and", ubicacionId: tienda.ubicacionId },
        { almacenId: "cat", ubicacionId: taller.ubicacionId },
      ],
    );
    expect(stock.get(21)?.porAlmacen).toEqual({ and: 2, cat: 3 });
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
