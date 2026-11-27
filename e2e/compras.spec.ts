/**
 * Compras y costos de punta a punta: una importación en dólares se registra,
 * se confirma (orden de compra en Odoo), Almacén la recibe, y en "Costos y
 * precios" se costea (sus gastos: flete y DAM); el costo de cada plancha aparece
 * en la tabla y desde ahí se aplica un precio nuevo en Odoo.
 *
 * Odoo es el falso de `e2e/odoo-falso.mts` (el dólar a 3.75). Las compras no se
 * borran: las de prueba llevan "E2E" en la nota y al final quedan anuladas y
 * fuera del historial de costos.
 */

import { expect, test, type Page } from "@playwright/test";
import { entrar, sesionDe } from "./apoyo";

const ODOO = process.env.E2E_ODOO_FALSO ?? "http://127.0.0.1:8069";

type Registro = Record<string, unknown> & { id: number };
interface Estado {
  productos: (Registro & { default_code: string | false; lst_price: number })[];
  compras: (Registro & { origin: string | false; currency_id: [number, string]; lineas: Registro[] })[];
}
const estado = async () => (await (await fetch(`${ODOO}/__estado`)).json()) as Estado;

async function limpiar() {
  const supabase = await sesionDe("administracion");
  const { data } = await supabase.from("compras").select("id").like("nota", "E2E%");
  const ids = (data ?? []).map((c) => c.id);
  if (ids.length === 0) return;
  await supabase.from("costos_historial").delete().in("compra_id", ids);
  await supabase.from("compras").update({ estado: "anulada" }).in("id", ids);
}

test.describe.configure({ mode: "serial" });
test.skip(!!process.env.E2E_URL, "Contra un despliegue la app habla con el Odoo de la empresa.");

test.beforeAll(async () => {
  await fetch(`${ODOO}/__reiniciar`, { method: "POST" });
  await limpiar();
});

test.afterAll(limpiar);

async function elegir(page: Page, dentro: ReturnType<Page["getByRole"]>, etiqueta: string, opcion: string | RegExp) {
  await dentro.getByRole("combobox", { name: etiqueta }).click();
  await page.getByRole("option", { name: opcion }).click();
}

test("una importación se liquida y su costo llega a Costos y precios", async ({ page }) => {
  await entrar(page, "administracion");
  // Al entrar quien gestiona el stock, los almacenes se crean en Odoo.
  await page.goto("/almacen");
  await expect(page.getByRole("heading", { name: "Almacén" })).toBeVisible();

  // 1. La pre-compra: importación FOB en dólares, con el TC que propone Odoo.
  await page.goto("/compras/nueva");
  await page.getByRole("button", { name: "Importación" }).click();
  await expect(page.getByLabel("TC mercadería (S/ por US$)")).toHaveValue("3.75");
  await elegir(page, page.locator("main"), "Almacén", "Católica (taller)");
  await page.getByLabel("Buscar proveedor").fill("andina");
  await page.getByRole("option", { name: /E2E Corporación Andina SAC/ }).click();
  await page.getByRole("button", { name: "Crédito" }).click();
  await page.getByLabel("Días de crédito").fill("90");
  await page.getByLabel("Buscar plancha o accesorio").fill("F9.5E015");
  await page.getByLabel("Buscar plancha o accesorio").press("Enter");
  const item = page.getByRole("list", { name: "Ítems de la compra" }).getByRole("listitem").filter({ hasText: "F9.5E015" });
  await item.getByLabel("Cantidad").fill("10");
  await item.getByLabel("Kilos (del ítem)").fill("300");
  await item.getByLabel("Precio unit. (US$)").fill("40");
  await page.getByLabel("Nota").fill("E2E importación");
  await page.getByRole("button", { name: "Guardar pre-compra" }).click();
  await page.waitForURL(/\/compras\/CMP-\d+$/);
  const codigo = page.url().split("/").at(-1)!;

  // 2. Confirmada: la orden de compra en Odoo, en dólares.
  await page.getByRole("button", { name: "Guardar y confirmar orden de compra" }).click();
  await expect(page.getByText(`${codigo} confirmada`)).toBeVisible();
  const orden = (await estado()).compras.find((c) => c.origin === `App Plexiacril ${codigo}`)!;
  expect(orden).toMatchObject({ state: "purchase", currency_id: [2, expect.anything()] });

  // 3. Almacén la recibe completa.
  await page.goto("/almacen");
  await page.getByRole("button", { name: /Recibir compra/ }).click();
  const dialogo = page.getByRole("dialog", { name: "Recibir compra" });
  await elegir(page, dialogo, "Compra", new RegExp(codigo));
  await dialogo.getByRole("button", { name: "Recibir", exact: true }).click();
  await expect(dialogo).toBeHidden();

  // 4. Costear: en Costos y precios se busca la orden y se cargan sus gastos:
  //    flete (por kilos) e IGV de la DAM (crédito fiscal, no es costo).
  await page.goto("/costos-precios");
  await page.getByRole("button", { name: /Costear/ }).click();
  const buscador = page.getByRole("dialog", { name: "Costear una compra" });
  await buscador.getByLabel("Buscar compra").fill(codigo);
  await buscador.getByRole("link", { name: new RegExp(codigo) }).click();
  await page.waitForURL(new RegExp(`/costos-precios/costear/${codigo}$`));
  await elegir(page, page.locator("main"), "Concepto del gasto", "Transporte marítimo");
  await page.getByRole("button", { name: "Agregar", exact: true }).click();
  const gastos = page.getByRole("list", { name: "Gastos" });
  await gastos.getByRole("listitem").filter({ hasText: "Transporte marítimo" }).getByLabel("Monto").fill("50");
  await page.getByRole("button", { name: "Agregar DAM" }).click();
  await gastos.getByRole("listitem").filter({ hasText: "Imp. General a las Ventas" }).getByLabel("Monto").fill("72");

  // 400 US$ × 3.75 = S/ 1,500 de mercadería + 50 US$ × 3.75 = S/ 187.50 de flete → S/ 168.75 por plancha.
  const liquidacion = page.getByRole("table").filter({ hasText: "Costo c/u" });
  await expect(liquidacion.getByRole("row").filter({ hasText: "F9.5E015" })).toContainText("S/ 168.75");
  await page.getByRole("button", { name: "Cerrar costeo" }).click();
  await expect(page.getByText(`${codigo} costeada`)).toBeVisible();

  // 5. En la tabla: el 1er costo, y un precio nuevo que va a Odoo.
  await page.goto("/costos-precios");
  await page.getByLabel("Filtrar planchas").fill("F9.5E015");
  const fila = page.getByRole("row").filter({ hasText: "F9.5E015" });
  await expect(fila).toContainText("S/ 168.75");
  await expect(fila).toContainText(codigo);
  await fila.getByLabel("Precio nuevo de F9.5E015").fill("300");
  await page.getByRole("button", { name: "Aplicar en Odoo" }).click();
  await expect(page.getByText("1 precio actualizado en Odoo")).toBeVisible();
  expect((await estado()).productos.find((p) => p.default_code === "F9.5E015")!.lst_price).toBe(300);
});

test("Logística gestiona compras pero no ve Costos y precios", async ({ page }) => {
  await entrar(page, "logistica");
  await page.goto("/compras");
  await expect(page.getByRole("heading", { name: "Compras" })).toBeVisible();
  await page.goto("/costos-precios");
  await expect(page).not.toHaveURL(/costos-precios/);
});
