/**
 * Leer las órdenes de compra de Odoo, contra el Odoo falso.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BASE, CLAVE, USUARIO, crearOdooFalso } from "../../e2e/odoo-falso.mjs";
import { asegurarAlmacen, crearOrdenCompra, recibirOrdenCompra } from "./almacenes";
import { buscarOrdenDeCompra, leerOrden, leerOrdenesDeCompra, nombresDeOrdenes } from "./compras-importar";
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

/** Una orden hecha directo en Odoo, sin el origen de la app. */
async function ordenDeOdoo(lineas: { productoId: number; cantidad: number; costo: number }[], origen: string | false = false) {
  const almacen = await asegurarAlmacen({ nombre: "Católica", codigo: "CAT" });
  const id = await crearOrdenCompra({
    almacen,
    proveedorId: 2,
    origen: origen || "",
    documento: "PRO-1",
    moneda: "PEN",
    fechaPrevista: null,
    lineas,
  });
  if (!origen) await ejecutar("purchase.order", "write", [[id], { origin: false }]);
  return { id, almacen };
}

describe("leerOrdenesDeCompra", () => {
  it("lee la orden con su proveedor, almacén, líneas y códigos", async () => {
    const { id, almacen } = await ordenDeOdoo([
      { productoId: 20, cantidad: 10, costo: 95.5 },
      { productoId: 21, cantidad: 4, costo: 40 },
    ]);
    const { ordenes, truncado } = await leerOrdenesDeCompra([]);
    expect(truncado).toBe(false);
    expect(ordenes).toHaveLength(1);
    expect(ordenes[0]).toMatchObject({
      id,
      proveedorId: 2,
      referencia: "PRO-1",
      moneda: "PEN",
      almacenOdooId: almacen.warehouseId,
      ultimaRecepcionId: null,
    });
    expect(ordenes[0].lineas).toEqual([
      expect.objectContaining({ productoId: 20, codigo: "F7E024", cantidad: 10, recibida: 0, precio: 95.5 }),
      expect.objectContaining({ productoId: 21, codigo: "F9.5E015", cantidad: 4, recibida: 0, precio: 40 }),
    ]);
  });

  it("el código sale del producto, no del texto de la línea, y el nombre no lo lleva pegado", async () => {
    const { id } = await ordenDeOdoo([{ productoId: 20, cantidad: 1, costo: 1 }]);
    // La línea quedó con la descripción de cuando el producto tenía otro código.
    await ejecutar("purchase.order.line", "write", [[1], { name: "[CODIGO-VIEJO] ACRILICO ECO" }]);
    const { ordenes } = await leerOrdenesDeCompra([]);
    expect(ordenes[0].id).toBe(id);
    expect(ordenes[0].lineas[0]).toMatchObject({ codigo: "F7E024", nombre: "ACRILICO ECO CRISTAL 3MM 1.22X1.83" });
  });

  it("trae lo recibido y la última recepción hecha", async () => {
    const { id } = await ordenDeOdoo([{ productoId: 20, cantidad: 10, costo: 100 }]);
    const picking = await recibirOrdenCompra(id, [{ productoId: 20, cantidad: 6, recibidoAntes: 0 }]);
    const { ordenes } = await leerOrdenesDeCompra([]);
    expect(ordenes[0].lineas[0]).toMatchObject({ cantidad: 10, recibida: 6 });
    expect(ordenes[0].ultimaRecepcionId).toBe(picking);
  });

  it("salta las que la app ya tiene, y no lee las que no están confirmadas", async () => {
    const { id } = await ordenDeOdoo([{ productoId: 20, cantidad: 1, costo: 1 }]);
    expect((await leerOrdenesDeCompra([id])).ordenes).toEqual([]);

    // Una solicitud de cotización (borrador) no es una compra.
    await ejecutar("purchase.order", "create", [
      { partner_id: 2, picking_type_id: 1, order_line: [[0, 0, { product_id: 20, name: "x", product_qty: 1 }]] },
    ]);
    expect((await leerOrdenesDeCompra([])).ordenes.map((o) => o.id)).toEqual([id]);
  });

  it("'desde' filtra en Odoo y no después: no depende de cuántas órdenes viejas haya", async () => {
    const { id: vieja } = await ordenDeOdoo([{ productoId: 20, cantidad: 1, costo: 1 }]);
    const { id: nueva } = await ordenDeOdoo([{ productoId: 20, cantidad: 1, costo: 1 }]);
    await ejecutar("purchase.order", "write", [[vieja], { date_order: "2025-01-10 10:00:00", date_approve: "2025-01-11 10:00:00" }]);
    expect((await leerOrdenesDeCompra([], "2026-01-01")).ordenes.map((o) => o.id)).toEqual([nueva]);
    expect((await leerOrdenesDeCompra([])).ordenes.map((o) => o.id)).toEqual([vieja, nueva]);
  });

  it("'desde' cuenta desde la CONFIRMACIÓN: una solicitud vieja confirmada hace poco entra", async () => {
    const { id } = await ordenDeOdoo([{ productoId: 20, cantidad: 1, costo: 1 }]);
    // Se pidió en octubre, se confirmó ahora (como P01726).
    await ejecutar("purchase.order", "write", [[id], { date_order: "2026-10-01 09:00:00" }]);
    expect((await leerOrdenesDeCompra([], "2026-11-22")).ordenes.map((o) => o.id)).toEqual([id]);
  });

  it("busca una orden por su número sin filtros de estado, y la lee por id aunque no esté confirmada", async () => {
    const { id } = await ordenDeOdoo([{ productoId: 20, cantidad: 1, costo: 1 }]);
    const [nombre] = [...(await nombresDeOrdenes([id])).values()];
    const [vista] = await buscarOrdenDeCompra(nombre.toLowerCase());
    expect(vista).toMatchObject({ id, nombre, estado: "purchase", origen: null });
    expect(vista.confirmadaEn).toBeTruthy();
    expect(await buscarOrdenDeCompra("P99999")).toEqual([]);
    expect((await leerOrden(id))?.lineas).toHaveLength(1);
    expect(await leerOrden(9999)).toBeNull();

    // Una solicitud en borrador: la importación no la trae, pero la búsqueda sí la ve.
    const borrador = await ejecutar<number>("purchase.order", "create", [
      { partner_id: 2, picking_type_id: 1, order_line: [[0, 0, { product_id: 20, name: "x", product_qty: 1 }]] },
    ]);
    const [nb] = [...(await nombresDeOrdenes([borrador])).values()];
    expect((await buscarOrdenDeCompra(nb))[0]).toMatchObject({ id: borrador, estado: "draft" });
  });

  it("da el número de la orden en Odoo", async () => {
    const { id } = await ordenDeOdoo([{ productoId: 20, cantidad: 1, costo: 1 }]);
    expect(await nombresDeOrdenes([id, id, 999])).toEqual(new Map([[id, expect.stringMatching(/^P\d+$/)]]));
    expect(await nombresDeOrdenes([])).toEqual(new Map());
  });

  it("devuelve el origen, para distinguir las que creó la app", async () => {
    await ordenDeOdoo([{ productoId: 20, cantidad: 1, costo: 1 }], "App Plexiacril CMP-00001");
    const { ordenes } = await leerOrdenesDeCompra([]);
    expect(ordenes[0].origen).toBe("App Plexiacril CMP-00001");
  });
});
