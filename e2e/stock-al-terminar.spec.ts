/**
 * Lo que pasa en Odoo cuando el pedido termina o se anula.
 *
 *   - Al pasar a **Listo** se pregunta cuántas planchas se usaron en cada corte y
 *     se descuentan del stock: se valida la entrega de la venta.
 *   - Si Odoo falla, el pedido pasa igual y el detalle ofrece reintentar.
 *   - Al **anular** un pedido que no terminó, su venta se cancela en Odoo y lo
 *     reservado queda libre.
 *
 * Es el camino sin sobrantes (el de las cotizaciones de antes de encenderlos
 * para todos): mientras corren estas pruebas, el ECO cristal de 3 mm los tiene
 * apagados, y al final se vuelven a encender.
 *
 * Odoo es el falso de `e2e/odoo-falso.mts`. Los pedidos son de clientes `E2E…` y
 * se borran al final.
 */

import { expect, test, type Browser, type Page } from "@playwright/test";
import { borrarCotizacionesDePrueba, entrar, abrirCorte, sesionDe, verMateriales } from "./apoyo";
import { registrarPedidoConCorte } from "./pedido-con-corte";

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

test.describe.configure({ mode: "serial" });

test.skip(!!process.env.E2E_URL, "Contra un despliegue la app habla con el Odoo de la empresa.");

/** Los sobrantes del material de las pruebas: apagados mientras corren, encendidos al final. */
async function sobrantes(encendidos: boolean) {
  const supabase = await sesionDe("administracion");
  const { data: formato } = await supabase.from("formatos_plancha").select("grupo_id").eq("codigo_odoo", "F7E024").single();
  const { error } = await supabase.from("grupos_plancha").update({ sobrantes_activo: encendidos }).eq("id", formato!.grupo_id);
  if (error) throw new Error(error.message);
}

test.beforeAll(async () => {
  await fetch(`${ODOO}/__reiniciar`, { method: "POST" });
  await borrarCotizacionesDePrueba();
  await sobrantes(false);
});

test.afterAll(async () => {
  await modo(null);
  await sobrantes(true);
  await borrarCotizacionesDePrueba();
});

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

  // El producto de Odoo está en la lista de ítems; el corte se abre para ver su plano.
  await expect(page.getByRole("tab", { name: /ACRILICO F8 CRISTAL 3MM/ })).toBeVisible();
  const lineas = await abrirCorte(page);
  await expect(lineas.getByText("Acrílico ECO · Cristal · 3 mm").first()).toBeVisible();
  await expect(lineas.getByRole("img", { name: /Plancha 1 de 3/ })).toBeVisible();
  // En pantalla ancha los planos van de a dos: la tercera plancha está en la página siguiente.
  await expect(lineas.getByText("Planchas 1–2 de 3")).toBeVisible();
  await expect(lineas.getByRole("img", { name: /Plancha 3 de 3/ })).toHaveCount(0);
  await lineas.getByRole("button", { name: "Siguiente" }).click();
  await expect(lineas.getByText("Plancha 3 de 3", { exact: true })).toBeVisible();
  await expect(lineas.getByRole("img", { name: /Plancha 3 de 3/ })).toBeVisible();
  // El taller no ve dinero.
  await expect(lineas.getByText(/S\/\s/)).toHaveCount(0);
  const materiales = await verMateriales(page);
  await expect(materiales.getByText(/se descuentan del stock en Odoo al pasar a Listo/)).toBeVisible();

  await mover(page, "En proceso");
  await expect(page.getByText(`${codigo} → En proceso`)).toBeVisible();

  // Listo lleva a los materiales: vienen las calculadas, y se usó una más.
  await mover(page, "Listo");
  await expect(materiales.getByText("Para pasar a Listo, revisa lo que de verdad se usó.")).toBeVisible();
  const planchas = materiales.getByLabel("Planchas usadas (F7E024)");
  await expect(planchas).toHaveValue("3");
  await planchas.fill("-1");
  await materiales.getByRole("button", { name: "Confirmar y pasar a Listo" }).click();
  await expect(materiales.getByRole("alert")).toContainText("No pueden ser menos de cero");
  await planchas.fill("4");
  await materiales.getByRole("button", { name: "Confirmar y pasar a Listo" }).click();
  await expect(page.getByText(`${codigo} → Listo`)).toBeVisible();

  await expect(materiales.getByText("Stock descontado en Odoo.")).toBeVisible();
  await expect(materiales.getByRole("row", { name: /F7E024.*3 planchas.*4 planchas/ })).toBeVisible();
  // Ya descontadas, las planchas no se corrigen desde aquí.
  await expect(materiales.getByLabel("Planchas usadas (F7E024)")).toHaveCount(0);

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
  const materiales = await verMateriales(page);
  await materiales.getByLabel("Planchas usadas (F7E024)").fill("2.5");
  await materiales.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Materiales usados guardados")).toBeVisible();
  await page.reload();
  await expect((await verMateriales(page)).getByLabel("Planchas usadas (F7E024)")).toHaveValue("2.5");

  await mover(page, "En proceso");
  await expect(page.getByText(`${codigo} → En proceso`)).toBeVisible();
  await modo("caido");
  await mover(page, "Listo");
  await expect(materiales.getByLabel("Planchas usadas (F7E024)")).toHaveValue("2.5");
  await materiales.getByRole("button", { name: "Confirmar y pasar a Listo" }).click();

  await expect(page.getByText(`${codigo} → Listo`)).toBeVisible();
  await expect(page.getByText(/No se descontó el stock en Odoo: Odoo falso: caído a propósito/).first()).toBeVisible();
  await expect(materiales.getByRole("alert")).toContainText("caído a propósito");
  expect(await stockDe(20)).toBe(antes);

  await modo(null);
  await materiales.getByRole("button", { name: "Reintentar" }).click();
  await expect(materiales.getByText("Stock descontado en Odoo.")).toBeVisible();
  expect(await stockDe(20)).toBe(antes! - 2.5);
});

test("al anular un pedido sin terminar, su venta se cancela en Odoo", async ({ page }) => {
  const codigo = await registrarPedidoConCorte(page);

  await mover(page, "Anulado");
  const dialogo = page.getByRole("dialog");
  await dialogo.getByLabel("Motivo").fill("El cliente desistió del pedido");
  await dialogo.getByRole("button", { name: "Confirmar cambio" }).click();
  await expect(page.getByText(`${codigo} → Anulado`)).toBeVisible();

  const materiales = await verMateriales(page);
  await expect(materiales.getByText(/Venta cancelada en Odoo/)).toBeVisible();
  const orden = (await estado()).ordenes.at(-1)!;
  expect(orden.state).toBe("cancel");
  expect(orden.entregas[0].state).toBe("cancel");
});
