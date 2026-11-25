/**
 * `scripts/odoo-vincular-compras.mjs`, corrido de verdad contra el Odoo falso:
 * a una compra hecha antes (recepción suelta) le crea su orden de compra y la
 * deja recibida, sin mover stock otra vez.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BASE, CLAVE, USUARIO, crearOdooFalso } from "../../e2e/odoo-falso.mjs";
import { asegurarAlmacen, stockPorAlmacen } from "./almacenes";
import { ejecutar, reiniciarCacheOdoo } from "./rpc";

const correr = promisify(execFile);
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

const vincular = (...extra: string[]) =>
  correr("node", ["scripts/odoo-vincular-compras.mjs", ...extra], { env: { ...process.env, ODOO_URL: odoo.url } }).catch((e) => e as { stdout: string; stderr: string });

/** Una compra como se hacía antes: la recepción sola, ya validada, sin orden de compra. */
async function recepcionSuelta(almacen: Awaited<ReturnType<typeof asegurarAlmacen>>, origen: string, producto: number, cantidad: number) {
  const picking = await ejecutar<number>("stock.picking", "create", [
    { picking_type_id: almacen.recepcionId, partner_id: 2, origin: origen, location_id: 11, location_dest_id: almacen.ubicacionId, partner_ref: "F001-9" },
  ]);
  const mov = await ejecutar<number>("stock.move", "create", [
    { picking_id: picking, product_id: producto, product_uom_qty: cantidad, product_uom: 1, location_id: 11, location_dest_id: almacen.ubicacionId, price_unit: 150, name: "Compra" },
  ]);
  await ejecutar("stock.picking", "action_confirm", [[picking]]);
  await ejecutar("stock.move", "write", [[mov], { quantity: cantidad, picked: true }]);
  await ejecutar("stock.picking", "button_validate", [[picking]], { context: { skip_backorder: true } });
  return picking;
}

describe("odoo:vincular-compras", () => {
  it("sin --aplicar solo lista, y no toca nada", async () => {
    const taller = await asegurarAlmacen({ nombre: "Católica", codigo: "CAT" });
    await recepcionSuelta(taller, "App Plexiacril ING-00001", 20, 4);
    const { stdout } = (await vincular()) as { stdout: string };
    expect(stdout).toMatch(/Sin orden de compra: 1/);
    expect(stdout).toMatch(/No se tocó nada/);
    expect(odoo.estado().compras).toHaveLength(0);
  });

  it("crea la orden de compra, enlaza la recepción que ya estaba y no duplica el stock; repetir no hace nada", async () => {
    const taller = await asegurarAlmacen({ nombre: "Católica", codigo: "CAT" });
    const vieja = await recepcionSuelta(taller, "App Plexiacril ING-00001", 20, 4);
    const ubicaciones = [{ almacenId: "cat", ubicacionId: taller.ubicacionId }];
    const antes = await stockPorAlmacen([20], ubicaciones);

    const { stdout } = (await vincular("--aplicar")) as { stdout: string };
    expect(stdout).toMatch(/✔ App Plexiacril ING-00001 → orden de compra/);

    const { compras, pickings } = odoo.estado();
    expect(compras).toHaveLength(1);
    expect(compras[0]).toMatchObject({ state: "purchase", origin: "App Plexiacril ING-00001", partner_id: [2, expect.anything()], partner_ref: "F001-9" });
    expect(compras[0].lineas).toEqual([expect.objectContaining({ product_qty: 4, price_unit: 150, qty_received: 4 })]);

    // La recepción vieja quedó como la de la orden; la nueva que armó Odoo, cancelada.
    expect(pickings.find((p) => p.id === vieja)).toMatchObject({ state: "done" });
    expect(pickings.find((p) => p.id === vieja)!.movimientos[0]).toMatchObject({ purchase_line_id: [compras[0].lineas[0].id, ""] });
    expect(pickings.filter((p) => p.id !== vieja).map((p) => p.state)).toEqual(["cancel"]);

    expect(await stockPorAlmacen([20], ubicaciones)).toEqual(antes);

    const otra = (await vincular("--aplicar")) as { stdout: string };
    expect(otra.stdout).toMatch(/Sin orden de compra: 0/);
    expect(odoo.estado().compras).toHaveLength(1);
  });

  it("funciona con un usuario que no es administrador (no puede leer ir.model)", async () => {
    const taller = await asegurarAlmacen({ nombre: "Católica", codigo: "CAT" });
    await recepcionSuelta(taller, "App Plexiacril ING-00001", 20, 4);
    odoo.fijarModo("sin-ir-model");
    const { stdout } = (await vincular("--aplicar")) as { stdout: string };
    expect(stdout).toMatch(/✔ App Plexiacril ING-00001/);
  });

  it("avisa si la app Compras no está instalada", async () => {
    const modelos = odoo.estado().modelos;
    modelos.splice(modelos.findIndex((m) => m.model === "purchase.order"), 1);
    const r = (await vincular()) as { stderr: string };
    expect(r.stderr).toMatch(/no tiene instalada la app Compras/);
  });

  it("funciona en un Odoo donde la recepción no tiene partner_ref", async () => {
    const taller = await asegurarAlmacen({ nombre: "Católica", codigo: "CAT" });
    await recepcionSuelta(taller, "App Plexiacril ING-00001", 20, 4);
    odoo.fijarModo("sin-partner-ref");
    const { stdout } = (await vincular("--aplicar")) as { stdout: string };
    expect(stdout).toMatch(/✔ App Plexiacril ING-00001/);
    expect(odoo.estado().compras[0].partner_ref).toBe(false);
  });

  it("--juntar mete varias recepciones en UNA sola orden de compra", async () => {
    const taller = await asegurarAlmacen({ nombre: "Católica", codigo: "CAT" });
    const a = await recepcionSuelta(taller, "App Plexiacril ING-00002", 20, 4);
    const b = await recepcionSuelta(taller, "App Plexiacril ING-00003", 20, 3);
    await recepcionSuelta(taller, "App Plexiacril ING-00004", 21, 2);
    const ubicaciones = [{ almacenId: "cat", ubicacionId: taller.ubicacionId }];
    const antes = await stockPorAlmacen([20, 21], ubicaciones);

    const seco = (await vincular("--juntar", "ING-00002,ING-00003")) as { stdout: string };
    expect(seco.stdout).toMatch(/Se juntarían en una sola orden/);
    expect(odoo.estado().compras).toHaveLength(0);

    const { stdout } = (await vincular("--juntar", "ING-00002,ING-00003", "--aplicar")) as { stdout: string };
    expect(stdout).toMatch(/✔ App Plexiacril ING-00002 \+ ING-00003 → orden de compra/);

    const { compras, pickings } = odoo.estado();
    expect(compras).toHaveLength(1);
    expect(compras[0]).toMatchObject({ origin: "App Plexiacril ING-00002 + ING-00003", state: "purchase" });
    expect(compras[0].lineas.map((l) => [l.product_qty, l.qty_received])).toEqual([[4, 4], [3, 3]]);
    // Las dos recepciones viejas son las de la orden; la nueva de Odoo, cancelada; la tercera sigue sin orden.
    for (const id of [a, b]) {
      expect(pickings.find((p) => p.id === id)!.movimientos[0].purchase_line_id).toBeTruthy();
    }
    expect(pickings.filter((p) => ![a, b].includes(p.id) && p.state === "cancel")).toHaveLength(1);
    expect(await stockPorAlmacen([20, 21], ubicaciones)).toEqual(antes);

    const otra = (await vincular()) as { stdout: string };
    expect(otra.stdout).toMatch(/Sin orden de compra: 1/);
  });

  it("--juntar no junta recepciones de almacenes distintos, ni códigos que no están pendientes", async () => {
    const taller = await asegurarAlmacen({ nombre: "Católica", codigo: "CAT" });
    const tienda = await asegurarAlmacen({ nombre: "Andahuaylas", codigo: "AND" });
    await recepcionSuelta(taller, "App Plexiacril ING-00002", 20, 4);
    await recepcionSuelta(tienda, "App Plexiacril ING-00003", 20, 3);

    const distintos = (await vincular("--juntar", "ING-00002,ING-00003", "--aplicar")) as { stderr: string };
    expect(distintos.stderr).toMatch(/almacenes distintos/);
    expect(odoo.estado().compras).toHaveLength(0);

    const faltante = (await vincular("--juntar", "ING-00002,ING-00099")) as { stderr: string };
    expect(faltante.stderr).toMatch(/ING-00099/);
    const suelto = (await vincular("--juntar", "ING-00002")) as { stderr: string };
    expect(suelto.stderr).toMatch(/al menos dos/);
  });

  it("con --limite 1 vincula una sola", async () => {
    const taller = await asegurarAlmacen({ nombre: "Católica", codigo: "CAT" });
    await recepcionSuelta(taller, "App Plexiacril ING-00001", 20, 4);
    await recepcionSuelta(taller, "App Plexiacril ING-00002", 21, 2);
    const { stdout } = (await vincular("--aplicar", "--limite", "1")) as { stdout: string };
    expect(stdout).toMatch(/Vinculadas: 1\. Con error: 0\. Sin intentar: 1/);
    expect(odoo.estado().compras).toHaveLength(1);
  });

  it("deja solas las recepciones que no son compras de la app", async () => {
    const taller = await asegurarAlmacen({ nombre: "Católica", codigo: "CAT" });
    await recepcionSuelta(taller, "Otro origen", 20, 4);
    const { stdout } = (await vincular("--aplicar")) as { stdout: string };
    expect(stdout).toMatch(/Recepciones de compras de la app: 0/);
    expect(odoo.estado().compras).toHaveLength(0);
  });
});
