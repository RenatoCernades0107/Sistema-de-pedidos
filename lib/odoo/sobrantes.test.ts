/**
 * Los sobrantes en Odoo, contra el Odoo falso: el producto por material, los
 * campos de medida del lote, el lote con su unidad en stock, y la lectura de lo
 * que hay.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BASE, CLAVE, USUARIO, crearOdooFalso } from "../../e2e/odoo-falso.mjs";
import { reiniciarCacheOdoo } from "./rpc";
import { anotarLote, crearLoteSobrante, lotesEnStock, productoSobrante } from "./sobrantes";

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

const material = { codigoBase: "F7E024", nombre: "SOBRANTE ACRILICO ECO CRISTAL 3MM" };
const lote = (nombre: string, largo = 183, ancho = 61) => ({ material, nombre, largo, ancho, nota: "Rack 2" });

describe("crearLoteSobrante", () => {
  it("crea el producto, los campos de medida y el lote con una unidad en stock", async () => {
    const id = await crearLoteSobrante(lote("SOB-00001"));
    const e = odoo.estado();

    const producto = e.productos.find((p) => p.default_code === "SOB-F7E024");
    expect(producto?.name).toBe("SOBRANTE ACRILICO ECO CRISTAL 3MM");
    const alta = e.llamadas.find((l) => l.modelo === "product.template" && l.metodo === "create");
    expect(alta?.args[0]).toMatchObject({ tracking: "lot", sale_ok: false, purchase_ok: false, type: "product" });

    const campos = e.llamadas.filter((l) => l.modelo === "ir.model.fields" && l.metodo === "create");
    expect(campos.map((l) => (l.args[0] as { name: string }).name)).toEqual(["x_largo", "x_ancho"]);

    expect(e.lotes).toEqual([
      expect.objectContaining({ id, name: "SOB-00001", x_largo: 183, x_ancho: 61, note: "Rack 2", cantidad: 1 }),
    ]);
  });

  it("el producto y los campos se crean una sola vez", async () => {
    await crearLoteSobrante(lote("SOB-00001"));
    await crearLoteSobrante(lote("SOB-00002", 100, 50));
    const e = odoo.estado();
    expect(e.llamadas.filter((l) => l.modelo === "product.template" && l.metodo === "create")).toHaveLength(1);
    expect(e.llamadas.filter((l) => l.modelo === "ir.model.fields")).toHaveLength(2);
    expect(e.lotes.map((l) => l.cantidad)).toEqual([1, 1]);
  });

  it("reintentar no duplica el lote ni el stock", async () => {
    const a = await crearLoteSobrante(lote("SOB-00001"));
    const b = await crearLoteSobrante(lote("SOB-00001"));
    expect(b).toBe(a);
    expect(odoo.estado().lotes).toHaveLength(1);
    expect(odoo.estado().lotes[0].cantidad).toBe(1);
  });

  it("si el usuario no puede crear campos, lo dice claro", async () => {
    odoo.fijarModo("sin-admin");
    await expect(crearLoteSobrante(lote("SOB-00001"))).rejects.toThrow(/x_largo, x_ancho/);
    expect(odoo.estado().lotes).toHaveLength(0);
  });

  it("reutiliza el producto que ya existe", async () => {
    const id = await productoSobrante(material);
    reiniciarCacheOdoo();
    expect(await productoSobrante(material)).toBe(id);
  });
});

describe("lotesEnStock", () => {
  it("devuelve los sobrantes con existencias, con sus medidas", async () => {
    await crearLoteSobrante(lote("SOB-00001"));
    await crearLoteSobrante(lote("SOB-00002", 100, 50));
    const lotes = await lotesEnStock();
    expect(lotes).toEqual([
      expect.objectContaining({ nombre: "SOB-00001", codigoProducto: "SOB-F7E024", largo: 183, ancho: 61, nota: "Rack 2" }),
      expect.objectContaining({ nombre: "SOB-00002", largo: 100, ancho: 50 }),
    ]);
  });

  it("sin productos Sobrante no hay nada", async () => {
    expect(await lotesEnStock()).toEqual([]);
  });

  it("la nota se cambia aparte", async () => {
    const id = await crearLoteSobrante(lote("SOB-00001"));
    await anotarLote(id, "Rack 5");
    expect(odoo.estado().lotes[0].note).toBe("Rack 5");
  });
});
