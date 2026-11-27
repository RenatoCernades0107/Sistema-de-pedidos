import { describe, expect, it } from "vitest";
import { planificarImportacion, type ContextoImportacion, type OrdenOdoo } from "./compras-importar";

const ctx: ContextoImportacion = {
  almacenes: [
    { id: "alm-1", odooWarehouseId: 1 },
    { id: "alm-sin-odoo", odooWarehouseId: null },
  ],
  catalogo: new Set(["F7E024", "F9.5E015"]),
  tcActual: 3.75,
};

const orden = (cambios: Partial<OrdenOdoo> = {}): OrdenOdoo => ({
  id: 7,
  nombre: "P00007",
  origen: null,
  proveedorId: 2,
  proveedorNombre: "Andina SAC",
  referencia: "PRO-55",
  moneda: "PEN",
  tasaPorDolar: null,
  almacenOdooId: 1,
  fechaPedido: "2026-11-20 15:30:00",
  confirmadaEn: "2026-11-20 16:00:00",
  fechaPrevista: "2026-12-05 12:00:00",
  ultimaRecepcionId: null,
  lineas: [{ productoId: 20, nombre: "Eco 3mm", codigo: "F7E024", cantidad: 10, recibida: 0, precio: 200 }],
  ...cambios,
});

describe("planificarImportacion", () => {
  it("trae una orden en soles como compra nacional confirmada", () => {
    const { porImportar, omitidas } = planificarImportacion([orden()], ctx);
    expect(omitidas).toEqual([]);
    expect(porImportar).toHaveLength(1);
    expect(porImportar[0]).toMatchObject({
      ordenId: 7,
      almacenId: "alm-1",
      tipo: "nacional",
      moneda: "PEN",
      tcMercaderia: null,
      condicionPago: "contado",
      documento: "PRO-55",
      fechaLlegadaEstimada: "2026-12-05",
      creadaEn: "2026-11-20T15:30:00Z",
      confirmadaEn: "2026-11-20T16:00:00Z",
      estado: "confirmada",
    });
    expect(porImportar[0].lineas).toEqual([
      { productoId: 20, codigo: "F7E024", nombre: "Eco 3mm", cantidad: 10, precio: 200, recibida: 0 },
    ]);
  });

  it("una orden en dólares es importación y usa el tipo de cambio de la orden, o el de hoy", () => {
    const propia = planificarImportacion([orden({ moneda: "USD", tasaPorDolar: 3.7 })], ctx).porImportar[0];
    expect(propia).toMatchObject({ tipo: "importacion", tcMercaderia: 3.7, condicionPago: "adelantado" });
    const deHoy = planificarImportacion([orden({ moneda: "USD" })], ctx).porImportar[0];
    expect(deHoy.tcMercaderia).toBe(3.75);
  });

  it("deja el estado según lo recibido en Odoo", () => {
    const dos = [
      { productoId: 20, nombre: "A", codigo: "F7E024", cantidad: 10, recibida: 10, precio: 1 },
      { productoId: 21, nombre: "B", codigo: "F9.5E015", cantidad: 4, recibida: 1, precio: 1 },
    ];
    expect(planificarImportacion([orden({ lineas: dos })], ctx).porImportar[0].estado).toBe("recibida_parcial");
    const todo = dos.map((l) => ({ ...l, recibida: l.cantidad }));
    expect(planificarImportacion([orden({ lineas: todo, ultimaRecepcionId: 9 })], ctx).porImportar[0]).toMatchObject({
      estado: "recibida",
      ultimaRecepcionId: 9,
    });
  });

  it("no cuenta de más lo recibido de más, y junta un producto repetido con su precio promedio", () => {
    const lineas = [
      { productoId: 20, nombre: "A", codigo: "F7E024", cantidad: 10, recibida: 12, precio: 100 },
      { productoId: 20, nombre: "A", codigo: "F7E024", cantidad: 30, recibida: 0, precio: 200 },
    ];
    const [c] = planificarImportacion([orden({ lineas })], ctx).porImportar;
    expect(c.lineas).toEqual([{ productoId: 20, codigo: "F7E024", nombre: "A", cantidad: 40, precio: 175, recibida: 10 }]);
  });

  it("ignora lo que la app misma creó en Odoo y lo anterior a 'desde'", () => {
    const plan = planificarImportacion(
      [orden({ origen: "App Plexiacril CMP-00001" }), orden({ id: 8, fechaPedido: "2026-01-02 10:00:00" })],
      { ...ctx, desde: "2026-06-01" },
    );
    expect(plan).toEqual({ porImportar: [], omitidas: [], deLaApp: 1 });
  });

  it.each([
    ["sin proveedor", { proveedorId: null }, /proveedor/],
    ["almacén que la app no tiene", { almacenOdooId: 99 }, /almacén/],
    ["almacén de la app sin Odoo", { almacenOdooId: null }, /almacén/],
    ["moneda que no maneja", { moneda: "EUR" }, /EUR/],
    ["dólares sin tipo de cambio", { moneda: "USD" }, /tipo de cambio/],
    ["sin ítems", { lineas: [] }, /ítems/],
    [
      "producto fuera del catálogo",
      { lineas: [{ productoId: 5, nombre: "Tornillo", codigo: "TOR-1", cantidad: 1, recibida: 0, precio: 1 }] },
      /Tornillo/,
    ],
    [
      "producto sin código",
      { lineas: [{ productoId: 5, nombre: "Sin código", codigo: null, cantidad: 1, recibida: 0, precio: 1 }] },
      /Sin código/,
    ],
    [
      "cantidad con decimales",
      { lineas: [{ productoId: 20, nombre: "A", codigo: "F7E024", cantidad: 2.5, recibida: 0, precio: 1 }] },
      /enteras/,
    ],
    [
      "demasiadas unidades",
      { lineas: [{ productoId: 20, nombre: "A", codigo: "F7E024", cantidad: 100_000, recibida: 0, precio: 1 }] },
      /unidades/,
    ],
  ] as [string, Partial<OrdenOdoo>, RegExp][])("deja fuera, diciendo por qué: %s", (_n, cambios, motivo) => {
    const sinTc = { ...ctx, tcActual: null };
    const plan = planificarImportacion([orden(cambios)], sinTc);
    expect(plan.porImportar).toEqual([]);
    expect(plan.omitidas).toEqual([expect.objectContaining({ ordenId: 7, ordenNombre: "P00007", motivo: expect.stringMatching(motivo) })]);
  });

  it("una orden mala no frena a las demás", () => {
    const plan = planificarImportacion([orden({ id: 1, proveedorId: null }), orden({ id: 2 })], ctx);
    expect(plan.porImportar.map((c) => c.ordenId)).toEqual([2]);
    expect(plan.omitidas.map((o) => o.ordenId)).toEqual([1]);
  });
});
