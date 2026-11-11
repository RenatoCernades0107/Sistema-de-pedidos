/**
 * El piloto de sobrantes: con el material encendido en Configuración, el corte
 * se vende como "Corte a medida" en m² y se fabrica en Odoo. Al pasar a Listo,
 * el taller confirma los sobrantes que guardó, y nacen como lotes con su
 * etiqueta.
 *
 * Odoo es el falso de `e2e/odoo-falso.mts`. El piloto se enciende para el ECO
 * cristal de 3 mm solo mientras duran estas pruebas.
 */

import { expect, test, type Browser } from "@playwright/test";
import { borrarCotizacionesDePrueba, entrar, sesionDe } from "./apoyo";
import { registrarPedidoConCorte } from "./pedido-con-corte";

const ODOO = process.env.E2E_ODOO_FALSO ?? "http://127.0.0.1:8069";

type Registro = Record<string, unknown> & { id: number };
interface Estado {
  productos: Registro[];
  ordenes: (Registro & { lineas: Registro[]; entregas: (Registro & { movimientos: Registro[] })[] })[];
  producciones: (Registro & { movimientos: Registro[]; lineas: Registro[] })[];
  lotes: (Registro & { cantidad: number })[];
}
const estado = async () => (await (await fetch(`${ODOO}/__estado`)).json()) as Estado;
const stockDe = async (codigo: string) =>
  (await estado()).productos.find((p) => p.default_code === codigo)?.qty_available as number | undefined;

async function piloto(encendido: boolean) {
  const supabase = await sesionDe("administracion");
  const { data: formato } = await supabase.from("formatos_plancha").select("grupo_id").eq("codigo_odoo", "F7E024").single();
  const { error } = await supabase.from("grupos_plancha").update({ sobrantes_activo: encendido }).eq("id", formato!.grupo_id);
  if (error) throw new Error(error.message);
}

async function limpiarSobrantes() {
  const supabase = await sesionDe("administracion");
  await supabase.from("sobrantes").update({ estado: "baja", odoo_lot_id: null }).eq("origen", "corte");
}

async function comoTaller(browser: Browser, codigo: string) {
  const page = await (await browser.newContext()).newPage();
  await entrar(page, "operaciones");
  await page.goto(`/pedidos/${codigo}`);
  return page;
}

test.describe.configure({ mode: "serial" });
test.skip(!!process.env.E2E_URL, "Contra un despliegue la app habla con el Odoo de la empresa.");

test.beforeAll(async () => {
  await fetch(`${ODOO}/__reiniciar`, { method: "POST" });
  await borrarCotizacionesDePrueba();
  await limpiarSobrantes();
  await piloto(true);
});

test.afterAll(async () => {
  await piloto(false);
  await limpiarSobrantes();
  await borrarCotizacionesDePrueba();
});

test("el corte se vende en m² y se fabrica: al terminar, los sobrantes vuelven al almacén como lotes", async ({
  page: admin,
  browser,
}) => {
  const codigo = await registrarPedidoConCorte(admin);

  // La venta: el corte a medida en m², por el mismo total que sin piloto.
  const orden = (await estado()).ordenes.at(-1)!;
  expect(orden.state).toBe("sale");
  expect(orden.amount_total).toBe(784.7);
  const corte = orden.lineas.find((l) => (l.product_id as [number, string])[1].startsWith("[CAM-F7E024]"))!;
  expect(corte).toMatchObject({ product_uom_qty: 4.8, price_unit: 108.33 });

  // La orden de fabricación, confirmada: consume 3 planchas y prevé un sobrante.
  const [mo] = (await estado()).producciones;
  expect(mo.state).toBe("confirmed");
  expect(mo.movimientos.map((m) => m.product_uom_qty)).toEqual([3, 1, 4.8]);
  const planchasAntes = await stockDe("F7E024");

  const page = await comoTaller(browser, codigo);
  const lineas = page.getByRole("region", { name: "Productos y cortes" });
  await expect(lineas.getByText(`${mo.name} · abierta en Odoo`)).toBeVisible();

  await page.getByRole("button", { name: "En proceso", exact: true }).click();
  await expect(page.getByText(`${codigo} → En proceso`)).toBeVisible();
  await page.getByRole("button", { name: "Listo", exact: true }).click();

  // Propuesto: la media plancha que no se cobró. Se mide de verdad y se agrega otro.
  const dialogo = page.getByRole("dialog", { name: "Pasar a Listo" });
  const primero = dialogo.getByRole("group", { name: "Sobrante 1" });
  await expect(primero.getByLabel("Largo")).toHaveValue("183");
  await expect(primero.getByLabel("Ancho")).toHaveValue("61");
  await primero.getByLabel("Ancho").fill("60");
  await primero.getByLabel("Ubicación").fill("E2E rack 9");
  await dialogo.getByRole("button", { name: "Agregar sobrante" }).click();
  const segundo = dialogo.getByRole("group", { name: "Sobrante 2" });
  await segundo.getByLabel("Largo").fill("40");
  await segundo.getByLabel("Ancho").fill("20");
  await dialogo.getByRole("button", { name: "Pasar a Listo" }).click();
  await expect(dialogo.getByRole("alert")).toContainText("40×20 es retazo");
  await segundo.getByLabel("Ancho").fill("35");
  await dialogo.getByRole("button", { name: "Pasar a Listo" }).click();
  await expect(dialogo).toBeHidden();
  await expect(page.getByText(`${codigo} → Listo`)).toBeVisible();

  await expect(lineas.getByText("Stock descontado en Odoo.")).toBeVisible();
  await expect(lineas.getByText(`${mo.name} · cerrada en Odoo`)).toBeVisible();
  const guardados = lineas.getByRole("list", { name: "Sobrantes guardados" }).getByRole("listitem");
  await expect(guardados).toHaveCount(2);
  await expect(guardados.first()).toContainText("183×60 cm");
  await expect(guardados.first()).toContainText("E2E rack 9");
  await expect(guardados.nth(1)).toContainText("40×35 cm");

  // En Odoo: la orden cerrada, las planchas consumidas, dos lotes con su medida y el corte entregado.
  const e = await estado();
  expect(e.producciones[0].state).toBe("done");
  expect(await stockDe("F7E024")).toBe(planchasAntes! - 3);
  expect(e.lotes.map((l) => [l.x_largo, l.x_ancho, l.cantidad])).toEqual([
    [183, 60, 1],
    [40, 35, 1],
  ]);
  expect(await stockDe("CAM-F7E024")).toBe(0);
  expect(e.ordenes.at(-1)!.entregas[0].state).toBe("done");

  // Y la etiqueta del sobrante, desde el pedido.
  const primerCodigo = (await guardados.first().locator(".font-mono").textContent())!;
  await guardados.first().getByRole("button", { name: `Etiqueta de ${primerCodigo}` }).click();
  await page.waitForURL(`**/sobrantes/${primerCodigo}/etiqueta`);
  await expect(page.getByRole("article", { name: `Etiqueta de ${primerCodigo}` })).toContainText("183×60 cm");
});

test("al anular un pedido con piloto, su orden de fabricación se cancela", async ({ page }) => {
  const codigo = await registrarPedidoConCorte(page);
  await page.getByRole("button", { name: "Anulado", exact: true }).click();
  const dialogo = page.getByRole("dialog");
  await dialogo.getByLabel("Motivo").fill("El cliente desistió del pedido");
  await dialogo.getByRole("button", { name: "Confirmar cambio" }).click();
  await expect(page.getByText(`${codigo} → Anulado`)).toBeVisible();

  const e = await estado();
  expect(e.producciones.at(-1)!.state).toBe("cancel");
  expect(e.ordenes.at(-1)!.state).toBe("cancel");
});

test("si Odoo falla al cerrar la producción, Sincronizar no duplica el sobrante y Reintentar lo cierra una vez", async ({
  page: admin,
  browser,
}) => {
  const codigo = await registrarPedidoConCorte(admin);
  const page = await comoTaller(browser, codigo);
  await page.getByRole("button", { name: "En proceso", exact: true }).click();
  await expect(page.getByText(`${codigo} → En proceso`)).toBeVisible();

  await fetch(`${ODOO}/__modo`, { method: "POST", body: JSON.stringify({ modo: "caido" }) });
  await page.getByRole("button", { name: "Listo", exact: true }).click();
  const dialogo = page.getByRole("dialog", { name: "Pasar a Listo" });
  await dialogo.getByRole("group", { name: "Sobrante 1" }).getByLabel("Ubicación").fill("E2E rack 8");
  await dialogo.getByRole("button", { name: "Pasar a Listo" }).click();
  await expect(page.getByText(`${codigo} → Listo`)).toBeVisible();
  await expect(page.getByText(/No se descontó el stock en Odoo: No se cerró la orden de fabricación/).first()).toBeVisible();
  await fetch(`${ODOO}/__modo`, { method: "POST", body: JSON.stringify({ modo: null }) });

  const lineas = page.getByRole("region", { name: "Productos y cortes" });
  await expect(lineas.getByText("Falta crearlo en Odoo")).toBeVisible();
  const lotesAntes = (await estado()).lotes.length;

  // Sincronizar desde la pantalla de Sobrantes no lo crea por su cuenta.
  await page.goto("/sobrantes");
  await page.getByRole("button", { name: "Sincronizar con Odoo" }).click();
  await expect(page.getByText("Sobrantes al día con Odoo")).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Sobrantes" }).getByRole("listitem").filter({ hasText: "E2E rack 8" }),
  ).toContainText(`Entra a Odoo al cerrar la producción de ${codigo}`);
  expect((await estado()).lotes.length).toBe(lotesAntes);

  // Reintentar desde el pedido cierra la orden, y el sobrante entra una sola vez.
  await page.goto(`/pedidos/${codigo}`);
  await lineas.getByRole("button", { name: "Reintentar" }).click();
  await expect(lineas.getByText("Stock descontado en Odoo.")).toBeVisible();
  const nuevos = (await estado()).lotes.slice(lotesAntes);
  expect(nuevos.map((l) => [l.x_largo, l.x_ancho, l.cantidad])).toEqual([[183, 61, 1]]);
});
