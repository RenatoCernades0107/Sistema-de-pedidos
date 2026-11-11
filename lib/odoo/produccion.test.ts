/**
 * La producción de un corte con el piloto de sobrantes, contra el Odoo falso:
 * crear la orden al confirmar el pedido, cerrarla con lo real al terminar, y
 * que de ahí nazcan los sobrantes como lotes.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BASE, CLAVE, USUARIO, crearOdooFalso } from "../../e2e/odoo-falso.mjs";
import { cancelarProduccion, cerrarProduccion, crearProduccion, productoCorte } from "./produccion";
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

const material = { codigoBase: "F7E024", nombre: "SOBRANTE ACRILICO ECO CRISTAL 3MM" };
const nueva = (origen = "App Plexiacril c1 #1") => ({
  origen,
  material,
  areaM2: 4.8,
  planchaId: 20,
  planchas: 3,
  sobrantesPrevistos: [{ areaM2: 1.1163 }],
});
const stock = (id: number) => odoo.estado().productos.find((p) => p.id === id)?.qty_available as number | undefined;

describe("productoCorte", () => {
  it("crea el corte a medida del material, en m² y almacenable, una sola vez", async () => {
    const id = await productoCorte(material);
    reiniciarCacheOdoo();
    expect(await productoCorte(material)).toBe(id);
    const p = odoo.estado().productos.find((x) => x.id === id)!;
    expect(p).toMatchObject({ default_code: "CAM-F7E024", name: "CORTE A MEDIDA ACRILICO ECO CRISTAL 3MM", uom_id: [3, "m²"] });
    expect(odoo.estado().llamadas.filter((l) => l.modelo === "product.template" && l.metodo === "create")).toHaveLength(1);
  });
});

describe("crearProduccion", () => {
  it("crea y confirma la orden: consume planchas, produce m² y prevé el sobrante con su parte del costo", async () => {
    const mo = await crearProduccion(nueva());
    const [orden] = odoo.estado().producciones;
    expect(orden).toMatchObject({ id: mo.id, name: mo.nombre, state: "confirmed", product_qty: 4.8, origin: "App Plexiacril c1 #1" });
    const [crudo, sub, fin] = orden.movimientos;
    expect(crudo).toMatchObject({ product_id: [20, ""], product_uom_qty: 3, name: "Planchas del corte" });
    expect(sub).toMatchObject({ product_uom_qty: 1, cost_share: 18.87 });
    expect(fin).toMatchObject({ product_uom_qty: 4.8 });
  });

  it("no duplica la orden de un mismo corte", async () => {
    const a = await crearProduccion(nueva());
    const b = await crearProduccion(nueva());
    expect(b.id).toBe(a.id);
    expect(odoo.estado().producciones).toHaveLength(1);
  });

  it("sin sobrantes previstos, no lleva subproductos", async () => {
    await crearProduccion({ ...nueva(), sobrantesPrevistos: [] });
    expect(odoo.estado().producciones[0].move_byproduct_ids).toEqual([]);
  });
});

describe("cerrarProduccion", () => {
  it("cierra con lo real: planchas usadas, m² producidos y un lote por sobrante con su medida", async () => {
    const mo = await crearProduccion(nueva());
    const antes = stock(20)!;
    const lotes = await cerrarProduccion(mo.id, {
      material,
      planchas: 2,
      sobrantes: [
        { nombre: "SOB-00101", largo: 183, ancho: 61, nota: "Rack 1" },
        { nombre: "SOB-00102", largo: 100, ancho: 40, nota: null },
      ],
    });

    const e = odoo.estado();
    expect(e.producciones[0].state).toBe("done");
    expect(stock(20)).toBe(antes - 2);
    expect(e.lotes).toEqual([
      expect.objectContaining({ id: lotes.get("SOB-00101"), name: "SOB-00101", x_largo: 183, x_ancho: 61, note: "Rack 1", cantidad: 1 }),
      expect.objectContaining({ id: lotes.get("SOB-00102"), x_largo: 100, x_ancho: 40, cantidad: 1 }),
    ]);
    const corte = e.productos.find((p) => p.default_code === "CAM-F7E024")!;
    expect(corte.qty_available).toBe(4.8);
    const cierre = e.llamadas.find((l) => l.metodo === "button_mark_done");
    expect(cierre?.kwargs.context).toMatchObject({ skip_consumption: true });
  });

  it("se puede repetir: una orden cerrada no se vuelve a cerrar", async () => {
    const mo = await crearProduccion(nueva());
    const real = { material, planchas: 3, sobrantes: [{ nombre: "SOB-00101", largo: 183, ancho: 61, nota: null }] };
    const a = await cerrarProduccion(mo.id, real);
    const b = await cerrarProduccion(mo.id, real);
    expect(b.get("SOB-00101")).toBe(a.get("SOB-00101"));
    expect(odoo.estado().lotes).toHaveLength(1);
    expect(odoo.estado().llamadas.filter((l) => l.metodo === "button_mark_done")).toHaveLength(1);
  });

  it("con Odoo caído falla con su mensaje y la orden sigue abierta", async () => {
    const mo = await crearProduccion(nueva());
    odoo.fijarModo("caido");
    await expect(cerrarProduccion(mo.id, { material, planchas: 3, sobrantes: [] })).rejects.toThrow(/caído/);
    odoo.fijarModo(null);
    expect(odoo.estado().producciones[0].state).toBe("confirmed");
  });

  it("un sobrante que el cálculo no previó también vuelve al almacén", async () => {
    const mo = await crearProduccion({ ...nueva(), sobrantesPrevistos: [] });
    await cerrarProduccion(mo.id, { material, planchas: 3, sobrantes: [{ nombre: "SOB-1", largo: 50, ancho: 40, nota: null }] });
    const e = odoo.estado();
    expect(e.producciones[0].state).toBe("done");
    expect(e.producciones[0].move_byproduct_ids).toHaveLength(1);
    expect(e.lotes).toEqual([expect.objectContaining({ name: "SOB-1", cantidad: 1 })]);
  });
});

describe("cancelarProduccion", () => {
  it("cancela la orden de un pedido anulado, y se puede repetir", async () => {
    const mo = await crearProduccion(nueva());
    await cancelarProduccion(mo.id);
    await cancelarProduccion(mo.id);
    expect(odoo.estado().producciones[0].state).toBe("cancel");
  });
});
