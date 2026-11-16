/**
 * La producción de un corte con el piloto de sobrantes, contra el Odoo falso:
 * crear la orden al confirmar el pedido, cerrarla con lo real al terminar, y
 * que de ahí nazcan los sobrantes como lotes.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BASE, CLAVE, USUARIO, crearOdooFalso } from "../../e2e/odoo-falso.mjs";
import { asegurarAlmacen } from "./almacenes";
import {
  cancelarProduccion,
  cerrarFabricacion,
  cerrarProduccion,
  crearFabricacion,
  crearProduccion,
  productoCorte,
} from "./produccion";
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
  donde: { ubicacionOrigen: 8, ubicacionDestino: 8, tipoOperacion: 3 },
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
        { nombre: "SOB-00101", largo: 183, ancho: 61, nota: "Rack 1", ubicacionId: 8 },
        { nombre: "SOB-00102", largo: 100, ancho: 40, nota: null, ubicacionId: 8 },
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
    const real = { material, planchas: 3, sobrantes: [{ nombre: "SOB-00101", largo: 183, ancho: 61, nota: null, ubicacionId: 8 }] };
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
    await cerrarProduccion(mo.id, { material, planchas: 3, sobrantes: [{ nombre: "SOB-1", largo: 50, ancho: 40, nota: null, ubicacionId: 8 }] });
    const e = odoo.estado();
    expect(e.producciones[0].state).toBe("done");
    expect(e.producciones[0].move_byproduct_ids).toHaveLength(1);
    expect(e.lotes).toEqual([expect.objectContaining({ name: "SOB-1", cantidad: 1 })]);
  });
});

describe("producción por almacén", () => {
  it("corta en un almacén, deja el corte en el de la venta y cada sobrante en el almacén elegido", async () => {
    const tienda = await asegurarAlmacen({ nombre: "Andahuaylas", codigo: "AND" });
    const taller = await asegurarAlmacen({ nombre: "Católica", codigo: "CAT" });
    const mo = await crearProduccion({
      ...nueva(),
      donde: { ubicacionOrigen: tienda.ubicacionId, ubicacionDestino: taller.ubicacionId, tipoOperacion: tienda.fabricacionId },
    });
    const creada = odoo.estado().producciones[0];
    expect(creada).toMatchObject({
      picking_type_id: [tienda.fabricacionId, ""],
      location_src_id: [tienda.ubicacionId, ""],
      location_dest_id: [taller.ubicacionId, ""],
    });

    await cerrarProduccion(mo.id, {
      material,
      planchas: 0,
      sobrantes: [
        { nombre: "SOB-00201", largo: 120, ancho: 60, nota: null, ubicacionId: tienda.ubicacionId },
        { nombre: "SOB-00202", largo: 90, ancho: 40, nota: null, ubicacionId: taller.ubicacionId },
      ],
    });
    const e = odoo.estado();
    expect(e.producciones[0].state).toBe("done");
    // Un subproducto por almacén de destino: el previsto (a la tienda) y uno nuevo al taller.
    const subs = e.producciones[0].movimientos.filter((m) => (e.producciones[0].move_byproduct_ids as number[]).includes(m.id));
    expect(subs.map((m) => m.state)).toEqual(["done", "done"]);
    const lugarDe = (nombre: string) => {
      const lote = e.lotes.find((l) => l.name === nombre)!;
      return e.quants.find((q) => (q.lot_id as [number])[0] === lote.id && Number(q.quantity) > 0)?.location_id;
    };
    expect(lugarDe("SOB-00201")).toEqual([tienda.ubicacionId, ""]);
    expect(lugarDe("SOB-00202")).toEqual([taller.ubicacionId, ""]);
    const corte = e.productos.find((p) => p.default_code === "CAM-F7E024")!;
    expect(corte.__stock).toEqual({ [taller.ubicacionId]: 4.8 });
  });

  it("un producto terminado consume del taller y devuelve sus sobrantes", async () => {
    const taller = await asegurarAlmacen({ nombre: "Católica", codigo: "CAT" });
    const donde = { ubicacionOrigen: taller.ubicacionId, ubicacionDestino: taller.ubicacionId, tipoOperacion: taller.fabricacionId };
    const mo = await crearFabricacion({ origen: "App Plexiacril c9 #1", productoId: 12, cantidad: 1, componentes: [{ productoId: 20, cantidad: 0.5 }], donde });
    const lotes = await cerrarFabricacion(mo.id, [{ productoId: 20, cantidad: 1 }], [
      { nombre: "SOB-00301", largo: 100, ancho: 50, nota: null, ubicacionId: taller.ubicacionId, material },
    ]);
    const e = odoo.estado();
    expect(e.producciones[0].state).toBe("done");
    expect(e.lotes).toEqual([expect.objectContaining({ id: lotes.get("SOB-00301"), name: "SOB-00301", cantidad: 1 })]);
    const plancha = e.productos.find((p) => p.id === 20)!;
    expect(plancha.__stock).toMatchObject({ [taller.ubicacionId]: -1 });
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
