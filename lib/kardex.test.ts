import { describe, expect, it } from "vitest";
import { clasificar, filasDeKardex, type Referencias } from "./kardex";
import type { MovimientoOdoo } from "./odoo/almacenes";

const COT = "0b6c5c1e-1d2a-4f3b-9a4e-3c2d1e0f9a8b";
const refs: Referencias = {
  ingresos: new Map([["ING-00001", "compra"]]),
  casos: new Map([
    ["CAS-00002", "diferencia"],
    ["CAS-00003", "baja"],
  ]),
  pedidoDeVenta: new Map([["S00042", "P2611-007"]]),
  pedidoDeCotizacion: new Map([[COT, "P2611-008"]]),
};

let n = 0;
const mov = (m: Partial<MovimientoOdoo>): MovimientoOdoo => ({
  id: ++n,
  fecha: `2026-11-${String(n).padStart(2, "0")} 10:00:00`,
  cantidad: 1,
  desde: null,
  hacia: null,
  loteId: null,
  referencia: null,
  origen: null,
  baja: false,
  inventario: false,
  origenProduccion: null,
  ...m,
});

describe("qué fue cada movimiento", () => {
  it("lo que hizo la app, por su código", () => {
    expect(clasificar(mov({ origen: "App Plexiacril ING-00001" }), refs)).toMatchObject({ tipo: "compra", detalle: "Compra ING-00001" });
    expect(clasificar(mov({ origen: "App Plexiacril TRF-00004 envío" }), refs)).toMatchObject({ tipo: "transferencia" });
    expect(clasificar(mov({ origen: "App Plexiacril CAS-00002" }), refs)).toMatchObject({ tipo: "conteo", detalle: "Ajuste de conteo CAS-00002" });
    expect(clasificar(mov({ origen: "App Plexiacril CAS-00003", baja: true }), refs)).toMatchObject({ tipo: "baja", detalle: "Baja CAS-00003" });
  });

  it("una venta y una orden de fabricación llevan al pedido", () => {
    expect(clasificar(mov({ origen: "S00042" }), refs)).toEqual({ tipo: "venta", detalle: "Venta · P2611-007", enlace: "/pedidos/P2611-007" });
    expect(clasificar(mov({ origenProduccion: `App Plexiacril ${COT} #2`, referencia: "MO/00003" }), refs)).toMatchObject({
      tipo: "produccion",
      enlace: "/pedidos/P2611-008",
    });
  });

  it("lo hecho directo en Odoo", () => {
    expect(clasificar(mov({ baja: true, referencia: "SP/00009" }), refs).detalle).toBe("Baja en Odoo · SP/00009");
    expect(clasificar(mov({ inventario: true }), refs).tipo).toBe("ajuste");
    expect(clasificar(mov({ referencia: "WH/INT/00001" }), refs)).toMatchObject({ tipo: "odoo", detalle: "WH/INT/00001" });
  });
});

describe("las filas y el saldo", () => {
  const ubicaciones = new Map([
    [30, "cat"],
    [31, "and"],
  ]);

  it("el saldo va hacia atrás desde hoy; una transferencia sale en los dos almacenes", () => {
    const compra = mov({ hacia: 30, cantidad: 5, origen: "App Plexiacril ING-00001" });
    const transferencia = mov({ desde: 30, hacia: 31, cantidad: 2, origen: "App Plexiacril TRF-00001 envío" });
    const venta = mov({ desde: 31, hacia: 9, cantidad: 1, origen: "S00042" });
    const filas = filasDeKardex([compra, transferencia, venta], ubicaciones, { cat: 3, and: 1 }, refs);
    expect(filas.map((f) => [f.almacenId, f.tipo, f.entra, f.sale, f.saldo])).toEqual([
      ["and", "venta", 0, 1, 1],
      ["and", "transferencia", 2, 0, 2],
      ["cat", "transferencia", 0, 2, 3],
      ["cat", "compra", 5, 0, 5],
    ]);
  });

  it("un movimiento dentro del mismo almacén no aparece", () => {
    expect(filasDeKardex([mov({ desde: 30, hacia: 30 })], ubicaciones, { cat: 1 }, refs)).toEqual([]);
  });
});
