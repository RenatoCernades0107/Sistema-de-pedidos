/**
 * La pantalla de Sobrantes: el taller registra un sobrante medido a mano, que
 * nace como lote en Odoo con su etiqueta; se busca por la medida que se
 * necesita; y "Sincronizar con Odoo" trae lo que solo está allá y da por
 * consumido lo que ya no está.
 *
 * Odoo es el falso de `e2e/odoo-falso.mts`. Los sobrantes de prueba llevan
 * "E2E" en la ubicación; al final se dan de baja (un sobrante no se borra).
 */

import { expect, test, type Page } from "@playwright/test";
import { entrar, sesionDe } from "./apoyo";

const ODOO = process.env.E2E_ODOO_FALSO ?? "http://127.0.0.1:8069";

interface Lote {
  id: number;
  name: string;
  x_largo?: number;
  x_ancho?: number;
  note?: string;
  cantidad: number;
}

const estado = async () => (await (await fetch(`${ODOO}/__estado`)).json()) as { lotes: Lote[]; modo: string | null };
const modo = (m: "caido" | null) => fetch(`${ODOO}/__modo`, { method: "POST", body: JSON.stringify({ modo: m }) });

/** Una llamada al Odoo falso, como si alguien trabajara directo en Odoo. */
async function enOdoo<T>(modelo: string, metodo: string, args: unknown[], kwargs: Record<string, unknown> = {}) {
  const r = await fetch(`${ODOO}/jsonrpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      params: {
        service: "object",
        method: "execute_kw",
        args: ["e2e-odoo-falso", 7, "clave-del-odoo-falso", modelo, metodo, args, kwargs],
      },
    }),
  });
  const json = (await r.json()) as { result: T; error?: unknown };
  if (json.error) throw new Error(JSON.stringify(json.error));
  return json.result;
}

/** Los sobrantes de prueba se dan de baja y sueltan su lote (el Odoo falso vuelve a numerar desde 1). */
async function limpiar() {
  const supabase = await sesionDe("administracion");
  await supabase
    .from("sobrantes")
    .update({ estado: "baja", odoo_lot_id: null })
    .or("ubicacion.like.E2E%,origen.eq.odoo");
}

test.describe.configure({ mode: "serial" });
test.skip(!!process.env.E2E_URL, "Contra un despliegue la app habla con el Odoo de la empresa.");

test.beforeAll(async () => {
  await fetch(`${ODOO}/__reiniciar`, { method: "POST" });
  await limpiar();
});

test.afterAll(async () => {
  await modo(null);
  await limpiar();
});

async function registrar(page: Page, largo: string, ancho: string, ubicacion: string) {
  await page.getByRole("button", { name: "Registrar sobrante" }).click();
  const dialogo = page.getByRole("dialog", { name: "Registrar sobrante" });
  await dialogo.getByLabel("Buscar material").fill("eco cristal 3");
  await expect(dialogo.getByRole("option", { name: /Acrílico ECO.*Cristal.*3 mm/ }).first()).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await dialogo.getByLabel("Buscar material").press("Enter");
  await expect(dialogo.getByTestId("material-sobrante")).toContainText("Acrílico ECO · Cristal · 3 mm");
  await dialogo.getByLabel("Largo (cm)").fill(largo);
  await dialogo.getByLabel("Ancho (cm)").fill(ancho);
  await dialogo.getByLabel("Ubicación").fill(ubicacion);
  await dialogo.getByRole("button", { name: "Registrar" }).click();
  return dialogo;
}

test("el taller registra un sobrante: nace como lote en Odoo y se imprime su etiqueta", async ({ page }) => {
  await entrar(page, "operaciones");
  await page.goto("/sobrantes");
  await expect(page.getByRole("heading", { name: "Sobrantes" })).toBeVisible();

  // Un retazo no entra.
  const dialogo = await registrar(page, "100", "20", "E2E rack 1");
  await expect(dialogo.getByRole("alert")).toContainText("es retazo");

  // Se escribe al revés (ancho primero) y queda con el largo como lado mayor.
  await dialogo.getByLabel("Largo (cm)").fill("45");
  await dialogo.getByLabel("Ancho (cm)").fill("120");
  await dialogo.getByRole("button", { name: "Registrar" }).click();
  await expect(dialogo).toBeHidden();

  const aviso = page.getByText(/^SOB-\d+ registrado$/);
  await expect(aviso).toBeVisible();
  const codigo = (await aviso.textContent())!.replace(" registrado", "");

  const fila = page.getByRole("list", { name: "Sobrantes" }).getByRole("listitem").filter({ hasText: codigo });
  await expect(fila).toContainText("120×45 cm");
  await expect(fila).toContainText("E2E rack 1");
  await expect(fila).toContainText("Disponible");
  await expect(fila).not.toContainText("No está en Odoo");

  expect((await estado()).lotes).toEqual([
    expect.objectContaining({ name: codigo, x_largo: 120, x_ancho: 45, note: "E2E rack 1", cantidad: 1 }),
  ]);

  // La etiqueta, con su QR.
  await fila.getByRole("button", { name: `Etiqueta de ${codigo}` }).click();
  await page.waitForURL(`**/sobrantes/${codigo}/etiqueta`);
  const etiqueta = page.getByRole("article", { name: `Etiqueta de ${codigo}` });
  await expect(etiqueta.getByRole("img", { name: `Código QR de ${codigo}` }).locator("svg")).toBeVisible();
  await expect(etiqueta).toContainText("120×45 cm");
  await expect(etiqueta).toContainText("Acrílico ECO · Cristal · 3 mm");
});

test("se busca por la medida que se necesita, y se mueve de sitio", async ({ page }) => {
  await entrar(page, "operaciones");
  await page.goto("/sobrantes");
  const lista = page.getByRole("list", { name: "Sobrantes" });
  const buscar = page.getByLabel("Buscar sobrante");

  await buscar.fill("cristal 40x100");
  await expect(lista.getByRole("listitem").filter({ hasText: "E2E rack 1" })).toHaveCount(1);
  await buscar.fill("cristal 50x100");
  await expect(page.getByText("Ningún sobrante coincide.")).toBeVisible();

  await buscar.fill("E2E rack 1");
  const fila = lista.getByRole("listitem").filter({ hasText: "E2E rack 1" });
  await fila.getByRole("button", { name: /Cambiar la ubicación/ }).click();
  const dialogo = page.getByRole("dialog");
  await dialogo.getByLabel("Nueva ubicación").fill("E2E rack 3");
  await dialogo.getByRole("button", { name: "Guardar" }).click();
  await buscar.fill("E2E rack 3");
  await expect(lista.getByRole("listitem")).toHaveCount(1);
  expect((await estado()).lotes[0].note).toBe("E2E rack 3");
});

test("si Odoo falla, el sobrante queda registrado y se crea en Odoo al reintentar", async ({ page }) => {
  await entrar(page, "administracion");
  await page.goto("/sobrantes");
  await modo("caido");
  await registrar(page, "91.5", "61", "E2E rack 2");
  await expect(page.getByText(/Quedó registrado, pero no se creó en Odoo/)).toBeVisible();
  await modo(null);

  const fila = page.getByRole("list", { name: "Sobrantes" }).getByRole("listitem").filter({ hasText: "E2E rack 2" });
  await expect(fila).toContainText("No está en Odoo");
  // 91.5×61: un cuarto de plancha de 122×183.
  await expect(fila).toContainText("Estándar");
  await fila.getByRole("button", { name: "Reintentar" }).click();
  await expect(fila).not.toContainText("No está en Odoo");
  expect((await estado()).lotes.map((l) => l.x_largo)).toEqual([120, 91.5]);
});

test("Sincronizar con Odoo trae lo que solo está allá y da por consumido lo que ya no está", async ({ page }) => {
  // En Odoo: alguien registra un sobrante a mano y consume el del rack 2.
  const loteOdoo = `LOTE-E2E-${Date.now()}`;
  const [producto] = await enOdoo<number[]>("product.product", "search", [[["default_code", "=", "SOB-F7E024"]]]);
  const lote = await enOdoo<number>("stock.lot", "create", [
    { name: loteOdoo, product_id: producto, x_largo: 150, x_ancho: 50, note: "E2E desde Odoo" },
  ]);
  const quant = await enOdoo<number>(
    "stock.quant",
    "create",
    [{ product_id: producto, location_id: 8, lot_id: lote, inventory_quantity: 1 }],
    { context: { inventory_mode: true } },
  );
  await enOdoo("stock.quant", "action_apply_inventory", [[quant]]);
  const rack2 = (await estado()).lotes.find((l) => l.x_largo === 91.5)!;
  const [quantRack2] = await enOdoo<number[]>("stock.quant", "search", [[["lot_id", "=", rack2.id]]]);
  await enOdoo("stock.quant", "write", [[quantRack2], { quantity: 0 }]);

  await entrar(page, "logistica");
  await page.goto("/sobrantes");
  await page.getByRole("button", { name: "Sincronizar con Odoo" }).click();
  await expect(page.getByText("1 traídos de Odoo · 1 ya no están en Odoo")).toBeVisible();

  const lista = page.getByRole("list", { name: "Sobrantes" });
  const traido = lista.getByRole("listitem").filter({ hasText: loteOdoo });
  await expect(traido).toContainText("150×50 cm");
  await expect(traido).toContainText("E2E desde Odoo");
  await expect(lista.getByRole("listitem").filter({ hasText: "E2E rack 2" })).toHaveCount(0);

  await page.getByRole("button", { name: /^Todos/ }).click();
  await expect(lista.getByRole("listitem").filter({ hasText: rack2.name })).toContainText("Consumido");
});
