/**
 * Registrar un pedido rellenando el formulario, como en mostrador: el cliente y
 * los productos se buscan en Odoo, un corte se calcula, y lo demás —a dónde va,
 * cuándo, cómo se paga— se elige por etiqueta.
 *
 * Odoo es el falso de `e2e/odoo-falso.mts` (ver `playwright.config.ts`). Los
 * pedidos y cotizaciones de prueba son de clientes `E2E…` y se borran al final.
 */

import { expect, test, type Page } from "@playwright/test";
import { borrarCotizacionesDePrueba, entrar, sesionDe } from "./apoyo";

const ODOO = process.env.E2E_ODOO_FALSO ?? "http://127.0.0.1:8069";

interface Orden {
  origin: string;
  state: string;
  amount_total: number;
  lineas: { product_id: [number, string]; product_uom_qty: number; price_unit: number }[];
}

const estado = async () => (await (await fetch(`${ODOO}/__estado`)).json()) as { ordenes: Orden[] };
const manana = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

test.describe.configure({ mode: "serial" });

test.skip(!!process.env.E2E_URL, "Contra un despliegue la app habla con el Odoo de la empresa.");

test.beforeAll(async () => {
  await fetch(`${ODOO}/__reiniciar`, { method: "POST" });
  await borrarCotizacionesDePrueba();
});

test.afterAll(async () => {
  await borrarCotizacionesDePrueba();
});

async function elegirCliente(page: Page, texto: string, nombre: RegExp) {
  const buscador = page.getByLabel("Buscar cliente");
  await buscador.fill(texto);
  await expect(page.getByRole("option", { name: nombre })).toHaveAttribute("aria-selected", "true");
  await buscador.press("Enter");
  await expect(page.getByTestId("cliente-elegido")).toContainText(nombre);
}

test("Administración registra un pedido con un producto y un corte, y Odoo lo reserva", async ({ page }) => {
  await entrar(page, "administracion");
  await page.goto("/pedidos/nuevo");

  await elegirCliente(page, "jose", /E2E José Pérez Quispe/);

  // Un producto de Odoo, por código.
  const producto = page.getByLabel("Buscar producto");
  await producto.fill("ac 003");
  await expect(page.getByRole("option", { name: /ACRILICO F8 CRISTAL 3MM/ }).first()).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await producto.press("Enter");

  // Y un corte: 10 piezas de 60×80.
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

  // Ya no se elige el tipo de pedido: lo dicen las líneas.
  await expect(page.getByRole("group", { name: "Tipo de pedido" })).toHaveCount(0);

  // 120 + 545, sin impuestos: el total con IGV lo pone Odoo al registrar.
  await expect(page.getByTestId("total-pedido")).toHaveText("S/ 665.00");

  // Sin elegir taller o tienda no se registra.
  await page.getByLabel("Fecha prometida").fill(manana());
  await page.getByRole("button", { name: "Registrar pedido" }).click();
  await expect(page.getByText("Elige si el pedido va para el taller o para la tienda")).toBeVisible();

  await page.getByRole("group", { name: "¿Para dónde va el pedido?" }).getByRole("button", { name: /Taller/ }).click();
  await page.getByLabel("Notas generales").fill("Bordes pulidos");
  await page.getByLabel("Abono inicial").fill("100");
  await page.getByRole("button", { name: "Registrar pedido" }).click();

  await page.waitForURL(/\/pedidos\/P\d{4}-\d{3}$/);
  const codigo = page.url().split("/").pop()!;
  // P, año, mes y correlativo del mes: P2611-001.
  expect(codigo).toMatch(/^P\d{4}-\d{3}$/);
  await expect(page.getByRole("heading", { name: "E2E José Pérez Quispe" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Ubicación actual" })).toContainText("En taller");
  // 665 × 1.18 = 784.70, menos el abono.
  await expect(page.getByText("S/ 684.70").first()).toBeVisible();

  // En Odoo: la orden con las planchas del corte, confirmada (eso reserva el stock).
  const orden = (await estado()).ordenes.at(-1)!;
  expect(orden.state).toBe("sale");
  expect(orden.amount_total).toBe(784.7);
  expect(orden.lineas.map((l) => [l.product_id[0], l.product_uom_qty, l.price_unit])).toEqual([
    [10, 1, 120],
    [20, 2, 200],
    [20, 1, 120],
    [31, 1, 25],
  ]);

  // El pedido está enlazado a su cotización, y el detalle sale de las líneas.
  const supabase = await sesionDe("administracion");
  const { data } = await supabase
    .from("pedidos_admin")
    .select("id, tipos_pedido, monto_total, detalle")
    .eq("codigo", codigo)
    .single();
  expect(data).toMatchObject({ tipos_pedido: ["CL", "SP"], monto_total: 784.7 });
  expect(data!.detalle).toContain("Corte láser · Acrílico ECO · Cristal · 3 mm: 10 piezas");
  expect(data!.detalle).toContain("Bordes pulidos");
  const { data: cot } = await supabase.from("cotizaciones").select("pedido_id").eq("pedido_id", data!.id!).single();
  expect(cot?.pedido_id).toBe(data!.id);
});

test("sin cliente ni productos no se registra, y dice qué falta", async ({ page }) => {
  await entrar(page, "administracion");
  await page.goto("/pedidos/nuevo");
  await page.getByRole("group", { name: "¿Para dónde va el pedido?" }).getByRole("button", { name: /Tienda/ }).click();
  await page.getByLabel("Fecha prometida").fill(manana());

  await page.getByRole("button", { name: "Registrar pedido" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Elige el cliente." })).toBeVisible();
  await expect(page.getByLabel("Buscar cliente")).toBeFocused();

  await elegirCliente(page, "jose", /E2E José Pérez Quispe/);
  await page.getByRole("button", { name: "Registrar pedido" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Agrega al menos un producto o un corte." })).toBeVisible();
  await expect(page).toHaveURL(/\/pedidos\/nuevo$/);
});
