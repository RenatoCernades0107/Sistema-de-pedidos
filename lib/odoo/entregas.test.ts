/**
 * La entrega de Odoo contra el Odoo falso: descontar el stock con lo que de
 * verdad salió, y cancelar la venta de un pedido anulado.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BASE, CLAVE, USUARIO, crearOdooFalso } from "../../e2e/odoo-falso.mjs";
import { cancelarPedidoDeVenta, repartirCantidades, validarEntrega } from "./entregas";
import { confirmarPedidoDeVenta, crearPedidoDeVenta } from "./pedidos-venta";
import { reiniciarCacheOdoo } from "./rpc";

describe("repartirCantidades", () => {
  const movs = [
    { id: 1, productoId: 20, demanda: 2 },
    { id: 2, productoId: 20, demanda: 1 },
    { id: 3, productoId: 10, demanda: 4 },
  ];

  it("sin nada anotado, cada movimiento sale con su demanda", () => {
    expect([...repartirCantidades(movs, new Map())]).toEqual([
      [1, 2],
      [2, 1],
      [3, 4],
    ]);
  });

  it("si se usó menos, se llena en orden y el último queda corto", () => {
    expect(repartirCantidades(movs, new Map([[20, 2]]))).toEqual(
      new Map([
        [1, 2],
        [2, 0],
        [3, 4],
      ]),
    );
  });

  it("si se usó más, lo que sobra va al último movimiento del producto", () => {
    expect(repartirCantidades(movs, new Map([[20, 4.5]])).get(2)).toBe(2.5);
  });

  it("ignora productos que la venta no tiene", () => {
    expect(repartirCantidades(movs, new Map([[99, 3]])).has(99)).toBe(false);
  });
});

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

const linea = (productoId: number, cantidad: number, precioUnitario: number) => ({
  productoId,
  nombreProducto: "PLANCHA",
  codigo: null,
  cantidad,
  precioUnitario,
  descripcion: null,
});

/** Un corte de 2 planchas completas y 1 media del F7E024, su servicio y un producto sin stock. */
async function venta(confirmar = true) {
  const v = await crearPedidoDeVenta({
    cotizacionId: "c-entregas",
    clienteId: 1,
    lineas: [linea(20, 2, 200), linea(20, 1, 110), linea(31, 1, 45), linea(10, 1, 120)],
  });
  if (confirmar) await confirmarPedidoDeVenta(v.orderId);
  return v.orderId;
}

const stock = (id: number) => odoo.estado().productos.find((p) => p.id === id)?.qty_available;

describe("validarEntrega", () => {
  it("al confirmar nace una entrega solo con lo almacenable", async () => {
    await venta();
    const [orden] = odoo.estado().ordenes;
    expect(orden.entregas).toHaveLength(1);
    expect(orden.entregas[0].movimientos.map((m) => m.product_uom_qty)).toEqual([2, 1]);
  });

  it("descuenta lo que de verdad salió, sin dejar entregas pendientes", async () => {
    const orderId = await venta();
    const r = await validarEntrega(orderId, new Map([[20, 2]]));
    expect(r).toEqual({ estado: "validada", yaEstaba: false });

    expect(stock(20)).toBe(8);
    const [orden] = odoo.estado().ordenes;
    expect(orden.entregas).toHaveLength(1);
    expect(orden.entregas[0].state).toBe("done");
    expect(orden.entregas[0].movimientos.map((m) => m.state)).toEqual(["done", "cancel"]);

    const validar = odoo.estado().llamadas.find((l) => l.metodo === "button_validate");
    expect(validar?.kwargs.context).toMatchObject({ skip_backorder: true });
  });

  it("si se usaron más planchas de las calculadas, salen igual", async () => {
    const orderId = await venta();
    await validarEntrega(orderId, new Map([[20, 4]]));
    expect(stock(20)).toBe(6);
  });

  it("se puede repetir: la segunda vez no toca nada", async () => {
    const orderId = await venta();
    await validarEntrega(orderId, new Map());
    expect(stock(20)).toBe(7);
    expect(await validarEntrega(orderId, new Map())).toEqual({ estado: "validada", yaEstaba: true });
    expect(stock(20)).toBe(7);
  });

  it("confirma antes la venta que se quedó en cotización", async () => {
    const orderId = await venta(false);
    await validarEntrega(orderId, new Map());
    expect(odoo.estado().ordenes[0].state).toBe("sale");
    expect(stock(20)).toBe(7);
  });

  it("una venta sin productos almacenables no tiene stock que descontar", async () => {
    const v = await crearPedidoDeVenta({ cotizacionId: "c-servicio", clienteId: 1, lineas: [linea(31, 1, 45)] });
    await confirmarPedidoDeVenta(v.orderId);
    expect(await validarEntrega(v.orderId, new Map())).toEqual({ estado: "sin-entrega" });
  });

  it("no valida con todo en cero", async () => {
    const orderId = await venta();
    await expect(validarEntrega(orderId, new Map([[20, 0]]))).rejects.toThrow(/todo en cero/);
  });

  it("con Odoo caído falla con su mensaje y la entrega queda pendiente", async () => {
    const orderId = await venta();
    odoo.fijarModo("caido");
    await expect(validarEntrega(orderId, new Map())).rejects.toThrow(/caído/);
    odoo.fijarModo(null);
    expect(odoo.estado().ordenes[0].entregas[0].state).toBe("assigned");
  });
});

describe("cancelarPedidoDeVenta", () => {
  it("cancela la venta y su entrega, y se puede repetir", async () => {
    const orderId = await venta();
    await cancelarPedidoDeVenta(orderId);
    await cancelarPedidoDeVenta(orderId);
    const [orden] = odoo.estado().ordenes;
    expect(orden.state).toBe("cancel");
    expect(orden.entregas[0].state).toBe("cancel");
    expect(stock(20)).toBe(10);
  });

  it("no cancela lo que ya salió del almacén", async () => {
    const orderId = await venta();
    await validarEntrega(orderId, new Map());
    await expect(cancelarPedidoDeVenta(orderId)).rejects.toThrow(/delivered/);
  });
});
