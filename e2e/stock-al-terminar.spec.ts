/**
 * Lo que pasa en Odoo cuando el pedido termina o se anula.
 *
 *   - Al pasar a **Listo** se pregunta cuántas planchas se usaron en cada corte y
 *     se descuentan del stock: se valida la entrega de la venta.
 *   - Si Odoo falla, el pedido pasa igual y el detalle ofrece reintentar.
 *   - Al **anular** un pedido que no terminó, su venta se cancela en Odoo y lo
 *     reservado queda libre.
 *
 * Odoo es el falso de `e2e/odoo-falso.mts`. Los pedidos son de clientes `E2E…` y
 * se borran al final.
 */

import { expect, test, type Browser, type Page } from "@playwright/test";
import { borrarCotizacionesDePrueba, entrar } from "./apoyo";

const ODOO = process.env.E2E_ODOO_FALSO ?? "http://127.0.0.1:8069";

interface Movimiento {
  product_id: [number, string];
  quantity: number;
  state: string;
}
interface Orden {
  state: string;
  entregas: { state: string; movimientos: Movimiento[] }[];
}

const estado = async () =>
  (await (await fetch(`${ODOO}/__estado`)).json()) as {
    ordenes: Orden[];
    productos: { id: number; qty_available?: number }[];
  };
const stockDe = async (id: number) => (await estado()).productos.find((p) => p.id === id)?.qty_available;
const modo = (m: "caido" | null) =>
  fetch(`${ODOO}/__modo`, { method: "POST", body: JSON.stringify({ modo: m }) });
const manana = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

test.describe.configure({ mode: "serial" });

test.skip(!!process.env.E2E_URL, "Contra un despliegue la app habla con el Odoo de la empresa.");

test.beforeAll(async () => {
  await fetch(`${ODOO}/__reiniciar`, { method: "POST" });
  await borrarCotizacionesDePrueba();
});

test.afterAll(async () => {
  await modo(null);
  await borrarCotizacionesDePrueba();
});

/**
 * Registra, como Administración, un pedido para el taller con un producto suelto
 * y un corte de 10 piezas de 60×80 en ECO cristal de 3 mm: 3 planchas del
 * F7E024 (2 completas y 1 media). Devuelve el código.
 */
async function registrarPedidoConCorte(page: Page): Promise<string> {
  await entrar(page, "administracion");
  await page.goto("/pedidos/nuevo");

  const cliente = page.getByLabel("Buscar cliente");
  await cliente.fill("jose");
  await expect(page.getByRole("option", { name: /E2E José Pérez Quispe/ })).toHaveAttribute("aria-selected", "true");
  await cliente.press("Enter");

  const producto = page.getByLabel("Buscar producto");
  await producto.fill("ac 003");
  await expect(page.getByRole("option", { name: /ACRILICO F8 CRISTAL 3MM/ }).first()).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await producto.press("Enter");

  await page.getByRole("button", { name: "Corte a medida" }).click();
  await page.getByLabel("Buscar material").fill("eco cristal 3");
  await expect(page.getByRole("option", { name: /Acrílico ECO.*Cristal.*3 mm/ }).first()).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByLabel("Buscar material").press("Enter");
  await page.getByLabel("Ancho de la pieza 1").fill("60");
  await page.getByLabel("Alto de la pieza 1").fill("80");
  await page.getByLabel("Cantidad de la pieza 1").fill("10");
  await expect(page.getByText("Elegida la más barata con stock.")).toBeVisible();
  await page.getByRole("button", { name: "Agregar corte" }).click();

  await page.getByLabel("Fecha prometida").fill(manana());
  await page.getByRole("group", { name: "¿Para dónde va el pedido?" }).getByRole("button", { name: /Taller/ }).click();
  await page.getByRole("button", { name: "Registrar pedido" }).click();
  await page.waitForURL(/\/pedidos\/[A-Z0-9_]+$/);
  return page.url().split("/").pop()!;
}

/** El taller, en su propio navegador: la sesión de Administración sigue abierta en el otro. */
async function comoTaller(browser: Browser, codigo: string) {
  const contexto = await browser.newContext();
  const page = await contexto.newPage();
  await entrar(page, "operaciones");
  await page.goto(`/pedidos/${codigo}`);
  return page;
}

async function mover(page: Page, a: string) {
  await page.getByRole("button", { name: a, exact: true }).click();
}

test("el taller ve el corte sin precios, anota las planchas usadas al pasar a Listo y se descuentan en Odoo", async ({
  page: admin,
  browser,
}) => {
  const codigo = await registrarPedidoConCorte(admin);
  expect((await estado()).ordenes.at(-1)!.state).toBe("sale");
  const antes = await stockDe(20);

  const page = await comoTaller(browser, codigo);

  const lineas = page.getByRole("region", { name: "Productos y cortes" });
  await expect(lineas.getByText("Acrílico ECO · Cristal · 3 mm")).toBeVisible();
  await expect(lineas.getByRole("img", { name: /Plancha 1 de 3/ })).toBeVisible();
  await expect(lineas.getByText(/ACRILICO F8 CRISTAL 3MM/)).toBeVisible();
  // El taller no ve dinero.
  await expect(lineas.getByText(/S\/\s/)).toHaveCount(0);
  await expect(lineas.getByText(/se descuentan del stock en Odoo al pasar a Listo/)).toBeVisible();

  await mover(page, "En proceso");
  await expect(page.getByText(`${codigo} → En proceso`)).toBeVisible();

  // Listo pregunta las planchas: vienen las calculadas, y se usó una más.
  await mover(page, "Listo");
  const dialogo = page.getByRole("dialog", { name: "Pasar a Listo" });
  const planchas = dialogo.getByLabel("Planchas usadas (F7E024)");
  await expect(planchas).toHaveValue("3");
  await planchas.fill("-1");
  await dialogo.getByRole("button", { name: "Pasar a Listo" }).click();
  await expect(dialogo.getByText("No pueden ser menos de cero")).toBeVisible();
  await planchas.fill("4");
  await dialogo.getByRole("button", { name: "Pasar a Listo" }).click();
  await expect(dialogo).toBeHidden();
  await expect(page.getByText(`${codigo} → Listo`)).toBeVisible();

  await expect(lineas.getByText("Stock descontado en Odoo.")).toBeVisible();
  await expect(lineas.getByText("Planchas usadas: 4 (calculadas: 3)")).toBeVisible();
  // Ya descontadas, las planchas no se corrigen desde aquí.
  await expect(lineas.getByRole("button", { name: "Planchas usadas" })).toHaveCount(0);

  const orden = (await estado()).ordenes.at(-1)!;
  expect(orden.entregas.map((e) => e.state)).toEqual(["done"]);
  expect(orden.entregas[0].movimientos.map((m) => [m.product_id[0], m.quantity, m.state])).toEqual([
    [20, 2, "done"],
    [20, 2, "done"],
  ]);
  expect(await stockDe(20)).toBe(antes! - 4);
});

test("si Odoo falla al pasar a Listo, el pedido pasa igual y el stock se descuenta al reintentar", async ({
  page: admin,
  browser,
}) => {
  const codigo = await registrarPedidoConCorte(admin);
  const antes = await stockDe(20);

  // Antes de terminar, el taller ya anotó lo usado; Listo llega con eso puesto.
  const page = await comoTaller(browser, codigo);
  const lineas = page.getByRole("region", { name: "Productos y cortes" });
  await lineas.getByRole("button", { name: "Planchas usadas" }).click();
  const anotar = page.getByRole("dialog", { name: "Planchas usadas" });
  await anotar.getByLabel("Planchas usadas (F7E024)").fill("2.5");
  await anotar.getByRole("button", { name: "Guardar" }).click();
  await expect(anotar).toBeHidden();
  await expect(lineas.getByText("Planchas usadas: 2.5 (calculadas: 3)")).toBeVisible();

  await mover(page, "En proceso");
  await expect(page.getByText(`${codigo} → En proceso`)).toBeVisible();
  await modo("caido");
  await mover(page, "Listo");
  const dialogo = page.getByRole("dialog", { name: "Pasar a Listo" });
  await expect(dialogo.getByLabel("Planchas usadas (F7E024)")).toHaveValue("2.5");
  await dialogo.getByRole("button", { name: "Pasar a Listo" }).click();

  await expect(page.getByText(`${codigo} → Listo`)).toBeVisible();
  await expect(page.getByText(/No se descontó el stock en Odoo: Odoo falso: caído a propósito/).first()).toBeVisible();
  await expect(lineas.getByRole("alert")).toContainText("caído a propósito");
  expect(await stockDe(20)).toBe(antes);

  await modo(null);
  await lineas.getByRole("button", { name: "Reintentar" }).click();
  await expect(lineas.getByText("Stock descontado en Odoo.")).toBeVisible();
  expect(await stockDe(20)).toBe(antes! - 2.5);
});

test("al anular un pedido sin terminar, su venta se cancela en Odoo", async ({ page }) => {
  const codigo = await registrarPedidoConCorte(page);

  await mover(page, "Anulado");
  const dialogo = page.getByRole("dialog");
  await dialogo.getByLabel("Motivo").fill("El cliente desistió del pedido");
  await dialogo.getByRole("button", { name: "Confirmar cambio" }).click();
  await expect(page.getByText(`${codigo} → Anulado`)).toBeVisible();

  const lineas = page.getByRole("region", { name: "Productos y cortes" });
  await expect(lineas.getByText(/Venta cancelada en Odoo/)).toBeVisible();
  const orden = (await estado()).ordenes.at(-1)!;
  expect(orden.state).toBe("cancel");
  expect(orden.entregas[0].state).toBe("cancel");
});
