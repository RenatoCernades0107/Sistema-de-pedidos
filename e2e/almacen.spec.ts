/**
 * La pantalla del almacén: Logística ingresa una compra y un ajuste (en Odoo,
 * una recepción y un inventario en el almacén elegido); solo Administración
 * cambia precios; se crean planchas y accesorios con el código que sigue en su
 * serie; y el taller lo ve todo sin poder cambiarlo.
 *
 * Odoo es el falso de `e2e/odoo-falso.mts`. Lo que se crea lleva "E2E" y se
 * quita al final (los ingresos se quedan: son un registro, no se borran).
 */

import { expect, test, type Page } from "@playwright/test";
import { entrar, sesionDe } from "./apoyo";

const ODOO = process.env.E2E_ODOO_FALSO ?? "http://127.0.0.1:8069";

type Registro = Record<string, unknown> & { id: number };
interface Estado {
  productos: (Registro & { default_code: string | false; lst_price: number; __stock?: Record<number, number> })[];
  almacenes: (Registro & { code: string; lot_stock_id: [number, string] })[];
  pickings: (Registro & { movimientos: Registro[] })[];
}
const estado = async () => (await (await fetch(`${ODOO}/__estado`)).json()) as Estado;
const ubicacionDe = async (codigo: string) => (await estado()).almacenes.find((a) => a.code === codigo)!.lot_stock_id[0];
const stockEn = async (producto: string, almacen: string) => {
  const p = (await estado()).productos.find((x) => x.default_code === producto)!;
  return p.__stock?.[await ubicacionDe(almacen)] ?? 0;
};

async function limpiar() {
  const supabase = await sesionDe("administracion");
  // El que crea la prueba: la lista de la empresa llega hasta ACC056.
  await supabase.from("accesorios").delete().eq("codigo_odoo", "ACC057");
  const { data: grupos } = await supabase.from("grupos_plancha").select("id").like("detalle", "E2E%");
  for (const g of grupos ?? []) await supabase.from("grupos_plancha").delete().eq("id", g.id);
}

test.describe.configure({ mode: "serial" });
test.skip(!!process.env.E2E_URL, "Contra un despliegue la app habla con el Odoo de la empresa.");

test.beforeAll(async () => {
  await fetch(`${ODOO}/__reiniciar`, { method: "POST" });
  await limpiar();
});

test.afterAll(limpiar);

/** Elige una opción de un Select de Base UI, por la etiqueta del disparador. */
async function elegir(page: Page, dentro: ReturnType<Page["getByRole"]>, etiqueta: string, opcion: string) {
  await dentro.getByRole("combobox", { name: etiqueta }).click();
  await page.getByRole("option", { name: opcion }).click();
}

/** Agrega un producto al ingreso y devuelve su fila. */
async function agregarProducto(page: Page, dialogo: ReturnType<Page["getByRole"]>, codigo: string) {
  await dialogo.getByLabel("Buscar plancha o accesorio").fill(codigo);
  await expect(dialogo.getByRole("option", { name: new RegExp(codigo) }).first()).toHaveAttribute("aria-selected", "true");
  await dialogo.getByLabel("Buscar plancha o accesorio").press("Enter");
  return dialogo.getByRole("list", { name: "Productos del ingreso" }).getByRole("listitem").filter({ hasText: codigo });
}

test("Logística ingresa una compra: en Odoo es una recepción en ese almacén, con proveedor y costo", async ({ page }) => {
  await entrar(page, "logistica");
  await page.goto("/almacen");
  await expect(page.getByRole("heading", { name: "Almacén" })).toBeVisible();
  // Al entrar quien gestiona el stock, los almacenes se crean en Odoo.
  await expect.poll(async () => (await estado()).almacenes.map((a) => a.code).sort()).toEqual(["AND", "CAT", "ESM", "WH"]);

  await page.getByRole("button", { name: "Ingresar stock" }).click();
  const dialogo = page.getByRole("dialog", { name: "Ingresar stock" });
  await elegir(page, dialogo, "Almacén", "Católica (taller)");
  await dialogo.getByLabel("Buscar proveedor").fill("andina");
  await dialogo.getByRole("option", { name: /E2E Corporación Andina SAC/ }).click();
  await dialogo.getByLabel("Guía o factura").fill("F001-E2E");
  const fila = await agregarProducto(page, dialogo, "F7E024");
  await fila.getByLabel("Llegaron").fill("4");
  await fila.getByLabel("Costo c/u (S/)").fill("150");
  await dialogo.getByLabel("Nota").fill("E2E compra");
  await dialogo.getByRole("button", { name: "Registrar compra" }).click();
  await expect(dialogo).toBeHidden();
  await expect(page.getByText(/^ING-\d+ registrado$/)).toBeVisible();

  const recepcion = (await estado()).pickings.at(-1)!;
  expect(recepcion).toMatchObject({ picking_type_code: "incoming", state: "done", partner_id: [2, ""], partner_ref: "F001-E2E" });
  expect(recepcion.movimientos).toEqual([expect.objectContaining({ product_uom_qty: 4, price_unit: 150 })]);
  expect(await stockEn("F7E024", "CAT")).toBe(4);

  // Y en la tabla, en la columna de Católica.
  await page.getByLabel("Buscar plancha").fill("F7E024");
  const enTabla = page.getByRole("row").filter({ hasText: "F7E024" });
  const encabezados = await page.getByRole("row").first().getByRole("columnheader").allTextContents();
  await expect(enTabla.getByRole("cell").nth(encabezados.indexOf("Católica"))).toHaveText("4");
});

test("un ajuste deja lo contado, y el ingreso queda con lo que había antes", async ({ page }) => {
  await entrar(page, "logistica");
  await page.goto("/almacen");
  await page.getByRole("button", { name: "Ingresar stock" }).click();
  const dialogo = page.getByRole("dialog", { name: "Ingresar stock" });
  await dialogo.getByRole("button", { name: "Ajuste de inventario" }).click();
  await elegir(page, dialogo, "Almacén", "Católica (taller)");
  const fila = await agregarProducto(page, dialogo, "F7E024");
  await expect(fila.getByText("Hoy hay 4 en este almacén")).toBeVisible();
  await fila.getByLabel("Contaste").fill("3");
  await dialogo.getByLabel("Nota").fill("E2E conteo");
  await dialogo.getByRole("button", { name: "Registrar ajuste" }).click();
  await expect(dialogo).toBeHidden();
  expect(await stockEn("F7E024", "CAT")).toBe(3);

  await page.getByRole("tab", { name: "Ingresos" }).click();
  // Los ingresos no se borran: el de esta corrida es el más reciente, el primero.
  const ingreso = page
    .getByRole("list", { name: "Ingresos de stock" })
    .getByRole("listitem")
    .filter({ hasText: "E2E conteo" })
    .first();
  await expect(ingreso).toContainText("Ajuste de inventario");
  await expect(ingreso).toContainText("4 → 3");
});

test("solo Administración cambia el precio de venta, y cambia en Odoo", async ({ page, browser }) => {
  await entrar(page, "logistica");
  await page.goto("/almacen");
  await page.getByLabel("Buscar plancha").fill("F7E024");
  await expect(page.getByRole("row").filter({ hasText: "F7E024" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cambiar el precio de F7E024" })).toHaveCount(0);

  const admin = await (await browser.newContext()).newPage();
  await entrar(admin, "administracion");
  await admin.goto("/almacen");
  await admin.getByLabel("Buscar plancha").fill("F7E024");
  await admin.getByRole("button", { name: "Cambiar el precio de F7E024" }).click();
  const dialogo = admin.getByRole("dialog", { name: "Precio de F7E024" });
  await dialogo.getByLabel("Precio de venta (S/)").fill("215.5");
  await dialogo.getByRole("button", { name: "Guardar precio" }).click();
  await expect(dialogo).toBeHidden();
  expect((await estado()).productos.find((p) => p.default_code === "F7E024")!.lst_price).toBe(215.5);
  await expect(admin.getByRole("row").filter({ hasText: "F7E024" })).toContainText("215.50");

  // Como estaba: las demás pruebas cotizan con el precio sembrado.
  await admin.getByRole("button", { name: "Cambiar el precio de F7E024" }).click();
  await dialogo.getByLabel("Precio de venta (S/)").fill("200");
  await dialogo.getByRole("button", { name: "Guardar precio" }).click();
  await expect(dialogo).toBeHidden();
  expect((await estado()).productos.find((p) => p.default_code === "F7E024")!.lst_price).toBe(200);
});

test("se crean una plancha y un accesorio con el código que sigue en su serie", async ({ page }) => {
  await entrar(page, "administracion");
  await page.goto("/almacen");

  await page.getByRole("button", { name: "Nuevo producto" }).click();
  let dialogo = page.getByRole("dialog", { name: "Nuevo producto" });
  await dialogo.getByLabel("Material").fill("Acrílico ECO");
  await dialogo.getByLabel("Espesor (mm)").fill("3");
  await dialogo.getByLabel("Variante").fill("Colores");
  await dialogo.getByLabel("Color o detalle").fill("E2E Rojo");
  await dialogo.getByLabel("Precio de venta (S/)").fill("230");
  await expect(dialogo).toContainText("ACRILICO ECO COLORES E2E ROJO 3MM 1.22X1.83");
  await dialogo.getByRole("button", { name: "Crear en Odoo" }).click();
  await expect(page.getByText("PL0001 creado en Odoo")).toBeVisible();
  expect((await estado()).productos.find((p) => p.default_code === "PL0001")).toMatchObject({ lst_price: 230 });
  await page.getByLabel("Buscar plancha").fill("e2e rojo");
  await expect(page.getByRole("row").filter({ hasText: "PL0001" })).toContainText("Colores e2E Rojo");

  await page.getByRole("button", { name: "Nuevo producto" }).click();
  dialogo = page.getByRole("dialog", { name: "Nuevo producto" });
  await dialogo.getByRole("button", { name: "Accesorio" }).click();
  await elegir(page, dialogo, "Categoría", "Bisagras (ACC)");
  await dialogo.getByLabel("Nombre").fill("E2E bisagra cristal 20mm");
  await dialogo.getByRole("button", { name: "Crear en Odoo" }).click();
  // La lista de la empresa llega hasta ACC056.
  await expect(page.getByText("ACC057 creado en Odoo")).toBeVisible();
  await page.getByRole("tab", { name: "Accesorios" }).click();
  await page.getByLabel("Buscar accesorio").fill("ACC057");
  await expect(page.getByRole("row").filter({ hasText: "ACC057" })).toContainText("E2E BISAGRA CRISTAL 20MM");
});

test("el taller ve el almacén, sin precios y sin poder cambiarlo", async ({ page }) => {
  await entrar(page, "operaciones");
  await page.goto("/almacen");
  await expect(page.getByRole("heading", { name: "Almacén" })).toBeVisible();
  await page.getByLabel("Buscar plancha").fill("F7E024");
  await expect(page.getByRole("row").filter({ hasText: "F7E024" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Precio" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ingresar stock" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Nuevo producto" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Ingresos" })).toHaveCount(0);
});
