/**
 * Productos terminados: el tercer tipo de ítem de un pedido.
 *
 *   - En el pedido se **diseñan** con la vista de /disenos: se elige el modelo
 *     del catálogo (los que tienen 3D) y su medida, el material y la cantidad.
 *     Queda un diseño enlazado a la línea, y la línea se vende como el producto
 *     del catálogo. El material se estima y de ahí sale un precio sugerido, que
 *     quien cotiza puede cambiar. Si se pide, lo estimado se reserva en Odoo con
 *     una orden de fabricación.
 *   - Al pasar a **Listo** se anota lo que de verdad se usó, y eso —no lo
 *     estimado— es lo que se descuenta del stock. Sin reserva, no hay orden en
 *     Odoo hasta que el pedido termina.
 *   - En cotizaciones sigue el editor de siempre (la última prueba).
 *
 * Odoo es el falso de `e2e/odoo-falso.mts` y el motor CAD, el de
 * `e2e/cad-falso.mts`. Los pedidos son de clientes `E2E…` y se borran al final.
 */

import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { borrarCotizacionesDePrueba, entrar, sesionDe } from "./apoyo";

const ODOO = process.env.E2E_ODOO_FALSO ?? "http://127.0.0.1:8069";
/**
 * La plancha con que se estima el Acrílico ECO cristal de 3 mm: de sus formatos,
 * el más barato por metro cuadrado (150×300, 4.5 m²).
 */
const CODIGO_PLANCHA = "F15E004";
/**
 * Dos cajas de 30×20×20 son 12 piezas: no caben en ¼ de 122×183 y sí en ¼ de
 * 122×244, que sale más barato que media de la chica.
 */
const CODIGO_PLANCHA_CORTE = "F9.5E015";

interface Movimiento {
  product_id: [number, string];
  product_uom_qty: number;
  quantity: number;
  state: string;
  raw_material_production_id?: [number, string];
}
interface Estado {
  productos: { id: number; default_code: string | false; qty_available?: number }[];
  ordenes: {
    state: string;
    lineas: { product_id: [number, string]; product_uom_qty: number; price_unit: number; name: string }[];
    entregas: { state: string; movimientos: Movimiento[] }[];
  }[];
  producciones: { state: string; product_id: [number, string]; product_qty: number; movimientos: Movimiento[] }[];
}

const estado = async () => (await (await fetch(`${ODOO}/__estado`)).json()) as Estado;
const stockDe = async (id: number) => (await estado()).productos.find((p) => p.id === id)?.qty_available;
const idDe = async (codigo: string) => (await estado()).productos.find((p) => p.default_code === codigo)!.id;
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

async function comoTaller(browser: Browser, codigo: string) {
  const contexto = await browser.newContext();
  const page = await contexto.newPage();
  await entrar(page, "operaciones");
  await page.goto(`/pedidos/${codigo}`);
  return page;
}

async function nuevoPedido(page: Page) {
  await page.goto("/pedidos/nuevo");
  if (page.url().includes("/login")) {
    await entrar(page, "administracion");
    await page.goto("/pedidos/nuevo");
  }
  const cliente = page.getByLabel("Buscar cliente");
  await cliente.fill("jose");
  await expect(page.getByRole("option", { name: /E2E José Pérez Quispe/ })).toHaveAttribute("aria-selected", "true");
  await cliente.press("Enter");
}

async function elegirMaterial(dialogo: ReturnType<Page["getByRole"]>) {
  await dialogo.getByLabel("Buscar material").fill("eco cristal 3");
  await expect(dialogo.getByRole("option", { name: /Acrílico ECO.*Cristal.*3 mm/ }).first()).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await dialogo.getByLabel("Buscar material").press("Enter");
  await expect(dialogo.getByTestId("material-elegido")).toContainText("Acrílico ECO · Cristal · 3 mm");
}

/** "Producto terminado" en el pedido: la vista de /disenos a pantalla completa, con un diseño nuevo. */
async function abrirDisenador(page: Page) {
  await page.getByRole("button", { name: "Producto terminado" }).click();
  const editor = page.getByRole("dialog", { name: "Producto terminado" });
  await expect(editor.getByRole("tab", { name: "Modelo" })).toHaveAttribute("aria-selected", "true");
  return editor;
}

/** En la pestaña Modelo: el tipo, el producto del catálogo y, si se pide, su medida estándar. */
async function elegirModelo(editor: Locator, tipo: string, producto: RegExp, medida?: string) {
  await editor.getByRole("tab", { name: "Modelo" }).click();
  await editor.getByRole("group", { name: "Tipo" }).getByRole("button", { name: tipo, exact: true }).click();
  await editor.getByRole("list", { name: "Modelos" }).getByRole("button", { name: producto }).click();
  if (medida) await editor.getByRole("button", { name: medida }).click();
  await expect(editor.getByText(/Generando/)).toHaveCount(0);
}

/** En la pestaña Planchas: Acrílico ECO cristal de 3 mm. */
async function elegirMaterialDiseno(editor: Locator) {
  await editor.getByRole("tab", { name: /^Planchas/ }).click();
  const elegir = async (campo: string, opcion: string | RegExp) => {
    await editor.getByRole("combobox", { name: campo }).click();
    await editor.page().getByRole("option", { name: opcion, exact: true }).click();
  };
  await elegir("Material", "Acrílico ECO");
  await elegir("Color", "Cristal");
  await elegir("Espesor", "3 mm");
  await expect(editor.getByRole("combobox", { name: "Espesor" })).toHaveText(/3 mm/);
  await expect(editor.getByText(/Generando/)).toHaveCount(0);
}

async function registrar(page: Page) {
  await page.getByLabel("Fecha prometida").fill(manana());
  await page.getByRole("group", { name: "Área que lo atiende" }).getByRole("button", { name: /Taller/ }).click();
  await page.getByRole("button", { name: "Registrar pedido" }).click();
  await page.waitForURL(/\/pedidos\/P\d{4}-\d{3}$/);
  return page.url().split("/").pop()!;
}

test("un producto del catálogo se diseña, reserva lo estimado y descuenta lo que de verdad se usó", async ({
  page: admin,
  browser,
}) => {
  await nuevoPedido(admin);

  const editor = await abrirDisenador(admin);
  await elegirModelo(editor, "Caja", /Caja con tapa removible/, "30 × 20 × 20 cm");
  await expect(editor.getByText("300 × 200 × 200 mm", { exact: false })).toBeVisible();
  await elegirMaterialDiseno(editor);

  // El despiece del motor, en su pestaña; la del modelo marca la medida estándar.
  await editor.getByRole("tab", { name: /^Piezas/ }).click();
  await expect(editor.getByRole("cell", { name: "Laterales" })).toBeVisible();

  await editor.getByRole("textbox", { name: /^Cantidad/ }).fill("2");
  await editor.getByLabel("Reservar este material en Odoo al confirmar el pedido").check();
  await expect(editor.getByText(/Se reserva 0\.25 plancha/)).toBeVisible();
  await editor.getByLabel(/^Precio unitario/).fill("150");
  await expect(editor.getByTestId("subtotal-terminado")).toHaveText(/300\.00/);
  await editor.getByRole("button", { name: "Agregar al pedido" }).click();
  await expect(editor).toBeHidden();

  const linea = admin.getByRole("listitem", { name: /Línea 1: Caja con tapa removible/ });
  await expect(linea.getByText(/30 × 20 × 20 cm · Acrílico ECO · Cristal · 3 mm/)).toBeVisible();
  await expect(linea.getByText(/se reserva/)).toBeVisible();

  const PLANCHA = await idDe(CODIGO_PLANCHA_CORTE);
  const antes = await stockDe(PLANCHA);
  const codigo = await registrar(admin);
  expect(codigo).toMatch(/^P\d{4}-\d{3}$/);

  // En Odoo: la venta lleva el producto del catálogo, y la orden de fabricación reserva lo estimado.
  let odoo = await estado();
  const caja = odoo.productos.find((p) => p.default_code === "CAJ-001");
  expect(caja).toBeTruthy();
  const venta = odoo.ordenes.at(-1)!;
  expect(venta.state).toBe("sale");
  expect(venta.lineas.map((l) => [l.product_id[0], l.product_uom_qty, l.price_unit])).toEqual([[caja!.id, 2, 150]]);
  expect(venta.lineas[0].name).toContain("Medidas: 30 × 20 × 20 cm");
  let orden = odoo.producciones.at(-1)!;
  expect([orden.state, orden.product_id[0], orden.product_qty]).toEqual(["confirmed", caja!.id, 2]);
  expect(
    orden.movimientos.filter((m) => m.raw_material_production_id).map((m) => [m.product_id[0], m.product_uom_qty]),
  ).toEqual([[PLANCHA, 0.25]]);

  // El taller ve la ficha, sin dinero.
  const page = await comoTaller(browser, codigo);
  const lineas = page.getByRole("region", { name: "Productos y cortes" });
  await expect(lineas.getByText("Caja con tapa removible")).toBeVisible();
  await expect(lineas.getByText("Material estimado")).toBeVisible();
  await expect(lineas.getByText("Cortes y acomodo en la plancha")).toBeVisible();
  await expect(lineas.getByText(/S\/\s/)).toHaveCount(0);

  // Y sus piezas entran a la hoja de corte.
  await page.goto(`/pedidos/${encodeURIComponent(codigo)}/hoja-de-corte`);
  await expect(page.getByRole("heading", { name: /Producto terminado · \[CAJ-001\] Caja con tapa removible/ })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Laterales" }).first()).toBeVisible();
  await page.goBack();

  await page.getByRole("button", { name: "En proceso", exact: true }).click();
  await expect(page.getByText(`${codigo} → En proceso`)).toBeVisible();

  // Listo pregunta qué se usó: llega lo estimado, y se usó una plancha entera y algo más.
  await page.getByRole("button", { name: "Listo", exact: true }).click();
  const dialogo = page.getByRole("dialog", { name: "Pasar a Listo: materiales usados" });
  const plancha = dialogo.getByLabel(/^Cantidad usada de /);
  await expect(plancha).toHaveValue("0.25");
  await plancha.fill("1");

  const buscador = dialogo.getByLabel(/Agregar material usado/);
  await buscador.fill("ac 003");
  const opcion = dialogo.getByRole("option", { name: /ACRILICO F8 CRISTAL 3MM/ }).first();
  await expect(opcion).toHaveAttribute("aria-selected", "true");
  // Quien no cotiza no ve precios, tampoco en el buscador.
  await expect(opcion).not.toContainText("S/");
  await buscador.press("Enter");
  await expect(dialogo.getByLabel(/^Cantidad usada de /)).toHaveCount(2);

  await dialogo.getByRole("button", { name: "Pasar a Listo" }).click();
  await expect(dialogo).toBeHidden();
  await expect(page.getByText(`${codigo} → Listo`)).toBeVisible();
  await expect(lineas.getByText("Stock descontado en Odoo.")).toBeVisible();
  await expect(lineas.getByText("Material usado")).toBeVisible();
  await expect(lineas.getByRole("button", { name: "Materiales usados" })).toHaveCount(0);

  // La orden se cerró con lo real, y la entrega sacó las dos cajas.
  odoo = await estado();
  orden = odoo.producciones.at(-1)!;
  expect(orden.state).toBe("done");
  const consumido = orden.movimientos.filter((m) => m.raw_material_production_id);
  expect(consumido.map((m) => [m.quantity, m.state])).toEqual([
    [1, "done"],
    [1, "done"],
  ]);
  expect(await stockDe(PLANCHA)).toBe(antes! - 1);
  const entrega = odoo.ordenes.at(-1)!.entregas;
  expect(entrega.map((e) => e.state)).toEqual(["done"]);
  expect(entrega[0].movimientos.map((m) => [m.product_id[0], m.quantity])).toEqual([[caja!.id, 2]]);
  expect(await stockDe(caja!.id)).toBe(0);

  await page.context().close();
});

test("sin reserva no toca el stock hasta que el pedido termina, y la línea se reabre con su diseño", async ({
  page: admin,
  browser,
}) => {
  const ordenesAntes = (await estado()).producciones.length;
  await nuevoPedido(admin);

  const editor = await abrirDisenador(admin);
  // Sin modelo todavía no se puede agregar.
  await expect(editor.getByRole("button", { name: "Agregar al pedido" })).toBeDisabled();
  await elegirModelo(editor, "Caja", /Caja tipo cubo/);
  await elegirMaterialDiseno(editor);
  await editor.getByLabel(/^Precio unitario/).fill("480");
  await editor.getByRole("button", { name: "Agregar al pedido" }).click();
  await expect(editor).toBeHidden();

  // Se reabre con lo que tenía: el mismo diseño, la cantidad y el precio.
  const nombre = (await admin.getByRole("listitem", { name: /Línea 1:/ }).getAttribute("aria-label"))!.replace(/^Línea 1:\s*/, "");
  await admin.getByRole("button", { name: `Editar ${nombre}` }).click();
  const otraVez = admin.getByRole("dialog", { name: "Editar producto terminado" });
  await expect(otraVez.getByLabel(/^Precio unitario/)).toHaveValue("480");
  await otraVez.getByRole("textbox", { name: /^Cantidad/ }).fill("3");
  await otraVez.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(otraVez).toBeHidden();
  await expect(admin.getByRole("listitem", { name: /Línea 1:/ }).getByText(/^3 × S\/\s*480\.00/)).toBeVisible();

  const PLANCHA = await idDe(CODIGO_PLANCHA);
  const antes = await stockDe(PLANCHA);
  const codigo = await registrar(admin);

  let odoo = await estado();
  expect(odoo.ordenes.at(-1)!.lineas.map((l) => [l.product_uom_qty, l.price_unit])).toEqual([[3, 480]]);
  // Sin reserva no hay orden de fabricación todavía.
  expect(odoo.producciones).toHaveLength(ordenesAntes);
  expect(await stockDe(PLANCHA)).toBe(antes);

  const page = await comoTaller(browser, codigo);
  const lineas = page.getByRole("region", { name: "Productos y cortes" });
  await page.getByRole("button", { name: "En proceso", exact: true }).click();
  await expect(page.getByText(`${codigo} → En proceso`)).toBeVisible();

  // Sin corregir nada, se descuenta lo estimado.
  await page.getByRole("button", { name: "Listo", exact: true }).click();
  const dialogo = page.getByRole("dialog", { name: "Pasar a Listo: materiales usados" });
  const usado = Number(await dialogo.getByLabel(/^Cantidad usada de /).first().inputValue());
  expect(usado).toBeGreaterThan(0);
  await dialogo.getByRole("button", { name: "Pasar a Listo" }).click();
  await expect(dialogo).toBeHidden();
  await expect(lineas.getByText("Stock descontado en Odoo.")).toBeVisible();

  odoo = await estado();
  expect(odoo.producciones).toHaveLength(ordenesAntes + 1);
  expect(odoo.producciones.at(-1)!.state).toBe("done");

  await page.context().close();
});

test("anular un pedido con material reservado cancela su orden de fabricación", async ({ page: admin }) => {
  await nuevoPedido(admin);
  const editor = await abrirDisenador(admin);
  await elegirModelo(editor, "Caja", /Caja tipo cubo/);
  await elegirMaterialDiseno(editor);
  await editor.getByLabel("Reservar este material en Odoo al confirmar el pedido").check();
  await editor.getByRole("button", { name: "Agregar al pedido" }).click();
  await expect(editor).toBeHidden();

  const PLANCHA = await idDe(CODIGO_PLANCHA);
  const antes = await stockDe(PLANCHA);
  const codigo = await registrar(admin);
  expect((await estado()).producciones.at(-1)!.state).toBe("confirmed");

  await admin.getByRole("button", { name: "Anulado", exact: true }).click();
  const dialogo = admin.getByRole("dialog", { name: /Pasar a Anulado/ });
  await dialogo.getByLabel("Motivo").fill("El cliente canceló el pedido");
  await dialogo.getByRole("button", { name: "Confirmar cambio" }).click();
  await expect(admin.getByText(`${codigo} → Anulado`)).toBeVisible();
  await expect(admin.getByText("Venta cancelada en Odoo: lo reservado quedó libre.")).toBeVisible();

  const odoo = await estado();
  expect(odoo.producciones.at(-1)!.state).toBe("cancel");
  expect(odoo.ordenes.at(-1)!.state).toBe("cancel");
  expect(await stockDe(PLANCHA)).toBe(antes);
});

test("Administración pone el factor y los extras, y el precio sugerido los usa", async ({ page }) => {
  await page.goto("/configuracion");
  if (page.url().includes("/login")) {
    await entrar(page, "administracion");
    await page.goto("/configuracion");
  }
  await page.getByRole("tab", { name: /Productos terminados/ }).click();

  const factor = page.getByRole("group", { name: "Factor de fabricación por tipo" }).getByLabel("Caja");
  const extra = page.getByLabel("Extra de Grabado láser");
  const guardarExtra = page.getByRole("listitem").filter({ hasText: "Grabado láser" }).getByRole("button", { name: "Guardar" });

  try {
    await factor.fill("2");
    await page.getByRole("button", { name: "Guardar ajustes" }).click();
    await expect(page.getByText("Ajustes guardados")).toBeVisible();
    await extra.fill("10");
    await guardarExtra.click();
    await expect(guardarExtra).toBeDisabled();

    // Un producto del catálogo se edita: cambia cómo se estima su material.
    await page.getByLabel("Filtrar productos terminados").fill("CAJ-002");
    await page.getByRole("button", { name: "Editar CAJ-002" }).click();
    const editor = page.getByRole("dialog", { name: "Editar CAJ-002" });
    await expect(editor.getByRole("button", { name: "Caja cerrada (6 caras)" })).toHaveAttribute("aria-pressed", "true");
    await editor.getByRole("button", { name: "Caja abierta (5 caras)" }).click();
    await editor.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByText("CAJ-002 guardado")).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "CAJ-002" }).getByText(/Caja abierta \(5 caras\)/)).toBeVisible();
    // Sus medidas y opciones siguen ahí: guardar no las borra.
    await expect(page.getByRole("listitem").filter({ hasText: "CAJ-002" }).getByText(/3 medidas/)).toBeVisible();

    // Al cotizar: las piezas de una caja caben en ¼ de 122×183 (S/ 200) = S/ 50; × 2 + 10 = S/ 110.
    await page.goto("/cotizaciones/nueva");
    await page.getByRole("button", { name: "Producto terminado" }).click();
    const terminado = page.getByRole("dialog", { name: "Producto terminado" });
    await terminado.getByRole("group", { name: "Tipo" }).getByRole("button", { name: "Caja", exact: true }).click();
    await terminado.getByRole("button", { name: /CAJ-001\s*Caja con tapa removible/ }).click();
    await terminado.getByRole("button", { name: "30 × 20 × 20 cm" }).click();
    await elegirMaterial(terminado);
    const sinExtra = Number((await terminado.getByTestId("precio-sugerido").innerText()).replace(/[^\d.]/g, ""));
    await terminado.getByRole("button", { name: /Grabado láser \(\+S\/\s*10\.00\)/ }).click();
    await expect(terminado.getByTestId("precio-sugerido")).toHaveText(new RegExp((sinExtra + 10).toFixed(2).replace(".", "\.")));
    await terminado.getByRole("button", { name: "Cancelar" }).click();
  } finally {
    // El catálogo es de todos: se deja como estaba.
    const supabase = await sesionDe("administracion");
    await supabase.from("pt_tipos").update({ factor_fabricacion: 1 }).eq("codigo", "CAJ");
    await supabase.from("pt_opciones").update({ extra: 0 }).eq("clase", "personalizacion").eq("nombre", "Grabado láser");
    await supabase.from("pt_productos").update({ geometria: "caja_cerrada" }).eq("codigo", "CAJ-002");
  }
});
