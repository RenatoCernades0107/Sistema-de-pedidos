/**
 * Mover stock entre almacenes, y los avisos de "mover stock".
 *
 *   - Logística envía planchas de Católica a Andahuaylas: salen del origen al
 *     enviarlas y entran al destino cuando el taller (o quien sea) las recibe.
 *   - Un pedido con un corte láser (se corta en el taller), sin planchas
 *     suficientes en el taller, genera el aviso (para Administración y Logística) con el origen sugerido;
 *     se transfiere desde "Por mover", se recibe y el aviso se resuelve.
 *
 * Odoo es el falso de `e2e/odoo-falso.mts`; su stock empieza en el almacén
 * anterior (WH), fuera de los almacenes de la app.
 */

import { expect, test, type Browser, type Page } from "@playwright/test";
import { borrarCotizacionesDePrueba, entrar, sesionDe } from "./apoyo";
import { registrarPedidoConCorte } from "./pedido-con-corte";

const ODOO = process.env.E2E_ODOO_FALSO ?? "http://127.0.0.1:8069";
// Las credenciales del Odoo falso (`e2e/odoo-falso.mts`, que no se puede importar desde aquí).
const BASE = "e2e-odoo-falso";
const USUARIO = "e2e@plexiacril.test";
const CLAVE = "clave-del-odoo-falso";

type Registro = Record<string, unknown> & { id: number };
interface Estado {
  productos: (Registro & { default_code: string | false; __stock?: Record<number, number> })[];
  almacenes: (Registro & { code: string; lot_stock_id: [number, string] })[];
  pickings: (Registro & { origin: string | false; state: string })[];
}
const estado = async () => (await (await fetch(`${ODOO}/__estado`)).json()) as Estado;
const ubicacionDe = async (codigo: string) => (await estado()).almacenes.find((a) => a.code === codigo)!.lot_stock_id[0];
const stockEn = async (producto: string, almacen: string) => {
  const p = (await estado()).productos.find((x) => x.default_code === producto)!;
  return p.__stock?.[await ubicacionDe(almacen)] ?? 0;
};

async function rpc(modelo: string, metodo: string, args: unknown[], kwargs: Record<string, unknown> = {}) {
  const llamar = async (params: unknown) => {
    const r = await fetch(`${ODOO}/jsonrpc`, {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "call", params }),
    });
    const j = (await r.json()) as { result?: unknown; error?: { data: { message: string } } };
    if (j.error) throw new Error(j.error.data.message);
    return j.result;
  };
  const uid = await llamar({ service: "common", method: "authenticate", args: [BASE, USUARIO, CLAVE, {}] });
  return llamar({ service: "object", method: "execute_kw", args: [BASE, uid, CLAVE, modelo, metodo, args, kwargs] });
}

/** Pone `cantidad` de un producto en un almacén del Odoo falso, como un conteo. */
async function contar(codigo: string, almacen: string, cantidad: number) {
  const producto = (await estado()).productos.find((p) => p.default_code === codigo)!;
  const contexto = { context: { inventory_mode: true } };
  const quant = await rpc(
    "stock.quant",
    "create",
    [{ product_id: producto.id, location_id: await ubicacionDe(almacen), inventory_quantity: cantidad }],
    contexto,
  );
  await rpc("stock.quant", "action_apply_inventory", [[quant]], contexto);
}

/** Los sobrantes que crea la prueba (al llegar a otro almacén pierden su ubicación "E2E…"). */
const sobrantesDePrueba: string[] = [];

/** Los pedidos y sobrantes de prueba. Las transferencias se quedan: son un registro, como los ingresos. */
async function limpiar() {
  await borrarCotizacionesDePrueba();
  const supabase = await sesionDe("administracion");
  await supabase
    .from("sobrantes")
    .update({ estado: "baja", odoo_lot_id: null, reserva_pedido_id: null, reserva_posicion: null })
    .in("codigo", sobrantesDePrueba);
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

async function comoTaller(browser: Browser) {
  const page = await (await browser.newContext()).newPage();
  await entrar(page, "operaciones");
  return page;
}

/** Recibe la transferencia más reciente de ese código, desde Movimientos. */
async function recibir(page: Page, codigo: string) {
  await page.goto("/almacen?vista=movimientos");
  await page.getByRole("button", { name: `Recibir ${codigo}` }).click();
  await expect(page.getByText(`${codigo} recibida`)).toBeVisible();
}

test("Logística envía planchas: salen del origen al enviar y entran al destino cuando el taller las recibe", async ({
  page,
  browser,
}) => {
  await entrar(page, "logistica");
  await page.goto("/almacen");
  // Al entrar quien gestiona el stock, los almacenes se crean en Odoo.
  await expect.poll(async () => (await estado()).almacenes.map((a) => a.code).sort()).toEqual(["AND", "CAT", "ESM", "WH"]);
  await contar("F7E024", "CAT", 5);
  await page.reload();

  await page.getByRole("button", { name: "Transferir" }).click();
  const dialogo = page.getByRole("dialog", { name: "Transferir stock" });
  await elegir(page, dialogo, "Sale de", "Católica (taller)");
  await elegir(page, dialogo, "Va a", "Andahuaylas (tienda)");
  await dialogo.getByLabel("Buscar plancha o accesorio").fill("F7E024");
  await expect(dialogo.getByRole("option", { name: /F7E024/ }).first()).toHaveAttribute("aria-selected", "true");
  await dialogo.getByLabel("Buscar plancha o accesorio").press("Enter");
  const fila = dialogo.getByRole("list", { name: "Productos de la transferencia" }).getByRole("listitem");
  await expect(fila).toContainText("En el origen hay 5");
  // No se envía más de lo que hay.
  await fila.getByLabel("Envías").fill("9");
  await dialogo.getByRole("button", { name: "Enviar" }).click();
  await expect(dialogo.getByRole("alert")).toContainText("hay 5");
  await fila.getByLabel("Envías").fill("2");
  await dialogo.getByLabel("Nota").fill("E2E envío");
  await dialogo.getByRole("button", { name: "Enviar" }).click();
  await expect(dialogo).toBeHidden();
  const aviso = page.getByText(/^TRF-\d+ enviada$/);
  await expect(aviso).toBeVisible();
  const codigo = (await aviso.textContent())!.split(" ")[0];

  // Salió del taller y todavía no llega a la tienda: está en tránsito.
  expect(await stockEn("F7E024", "CAT")).toBe(3);
  expect(await stockEn("F7E024", "AND")).toBe(0);
  expect((await estado()).pickings.find((p) => p.origin === `App Plexiacril ${codigo} envío`)).toMatchObject({ state: "done" });
  await page.getByLabel("Buscar plancha").fill("F7E024");
  await expect(page.getByRole("row").filter({ hasText: "F7E024" })).toContainText("+2 en camino");

  // El taller la ve en Movimientos y la recibe.
  const taller = await comoTaller(browser);
  await recibir(taller, codigo);
  expect(await stockEn("F7E024", "AND")).toBe(2);
  await expect(
    taller.getByRole("list", { name: "Transferencias" }).getByRole("listitem").filter({ hasText: codigo }),
  ).toContainText("Recibida");
});

test("a un pedido le faltan planchas en el taller: avisa, se transfieren desde Por mover y el aviso se resuelve", async ({
  page: admin,
  browser,
}) => {
  // El corte láser se hace en el taller y abre 3 planchas del F7E024; el taller tiene 1 y la tienda 2.
  await contar("F7E024", "CAT", 1);
  const codigo = await registrarPedidoConCorte(admin);
  const supabase = await sesionDe("administracion");
  const { data: pedido } = await supabase.from("pedidos").select("id").eq("codigo", codigo).single();

  // El aviso, para Administración y Logística.
  const { data: avisos } = await supabase
    .from("notificaciones")
    .select("titulo, cuerpo")
    .eq("pedido_id", pedido!.id)
    .eq("tipo", "mover_stock");
  expect(avisos?.length).toBeGreaterThan(0);
  expect(avisos![0].titulo).toBe(`Mover stock para ${codigo}`);
  expect(avisos![0].cuerpo).toContain("F7E024 ×2 en Católica");

  // En el pedido, lo que falta y de dónde traerlo.
  await admin.goto(`/pedidos/${codigo}`);
  const enPedido = admin.getByRole("region", { name: "Falta material" });
  await expect(enPedido).toContainText("faltan 2 en Católica para cortar");
  await expect(enPedido).toContainText("traer de Andahuaylas");

  // Logística lo mueve desde Por mover: la transferencia viene armada.
  const logistica = await (await browser.newContext()).newPage();
  await entrar(logistica, "logistica");
  await logistica.goto("/almacen?vista=mover");
  const grupo = logistica.getByRole("listitem", { name: `Pedido ${codigo}` });
  await grupo.getByRole("button", { name: /Transferir de Andahuaylas/ }).click();
  const dialogo = logistica.getByRole("dialog", { name: "Transferir stock" });
  await expect(dialogo.getByLabel("Nota")).toHaveValue(`Para el pedido ${codigo}`);
  await expect(dialogo.getByLabel("Envías")).toHaveValue("2");
  await dialogo.getByLabel("Nota").fill(`E2E para ${codigo}`);
  await dialogo.getByRole("button", { name: "Enviar" }).click();
  await expect(dialogo).toBeHidden();
  const enviada = logistica.getByText(/^TRF-\d+ enviada$/);
  await expect(enviada).toBeVisible();
  const trf = (await enviada.textContent())!.split(" ")[0];
  await expect(grupo).toContainText(`En camino · ${trf}`);

  // El taller la recibe y el pedido ya no tiene avisos.
  const taller = await comoTaller(browser);
  await recibir(taller, trf);
  await admin.reload();
  await expect(admin.getByRole("region", { name: "Falta material" })).toHaveCount(0);
  await logistica.goto("/almacen?vista=mover");
  await expect(logistica.getByRole("listitem", { name: `Pedido ${codigo}` })).toHaveCount(0);
});

test("un sobrante va a otro almacén como su lote: en camino no se usa, y al recibirlo queda allá", async ({ page, browser }) => {
  await entrar(page, "logistica");
  await page.goto("/almacen?vista=sobrantes");
  await page.getByRole("button", { name: "Registrar sobrante" }).click();
  const registro = page.getByRole("dialog", { name: "Registrar sobrante" });
  await registro.getByLabel("Buscar material").fill("eco cristal 3");
  await expect(registro.getByRole("option", { name: /Acrílico ECO.*Cristal.*3 mm/ }).first()).toHaveAttribute("aria-selected", "true");
  await registro.getByLabel("Buscar material").press("Enter");
  await expect(registro.getByLabel("Largo (cm)")).toBeFocused();
  await registro.getByLabel("Largo (cm)").fill("110");
  await registro.getByLabel("Ancho (cm)").fill("70");
  await elegir(page, registro, "Almacén", "Católica (taller)");
  await registro.getByLabel("Ubicación").fill("E2E rack trf");
  await registro.getByRole("button", { name: "Registrar" }).click();
  const registrado = page.getByText(/^SOB-\d+ registrado$/);
  await expect(registrado).toBeVisible();
  const sobrante = (await registrado.textContent())!.replace(" registrado", "");
  sobrantesDePrueba.push(sobrante);

  const fila = page.getByRole("list", { name: "Sobrantes" }).getByRole("listitem").filter({ hasText: sobrante });
  await fila.getByRole("button", { name: `Llevar ${sobrante} a otro almacén` }).click();
  const dialogo = page.getByRole("dialog", { name: "Transferir stock" });
  await expect(dialogo.getByRole("checkbox", { name: `Mover ${sobrante}` })).toBeChecked();
  await elegir(page, dialogo, "Va a", "Andahuaylas (tienda)");
  await dialogo.getByRole("button", { name: "Enviar" }).click();
  await expect(dialogo).toBeHidden();
  const enviada = page.getByText(/^TRF-\d+ enviada$/);
  await expect(enviada).toBeVisible();
  const trf = (await enviada.textContent())!.split(" ")[0];
  await expect(fila).toContainText("En camino");

  const supabase = await sesionDe("administracion");
  const { data: enCamino } = await supabase.from("sobrantes").select("estado, odoo_lot_id").eq("codigo", sobrante).single();
  expect(enCamino!.estado).toBe("en_transito");

  const taller = await comoTaller(browser);
  await recibir(taller, trf);
  const { data: llegado } = await supabase
    .from("sobrantes")
    .select("estado, almacenes(codigo)")
    .eq("codigo", sobrante)
    .single();
  expect(llegado).toMatchObject({ estado: "disponible", almacenes: { codigo: "AND" } });
  // En Odoo, el lote está en la ubicación de Andahuaylas.
  const e = (await (await fetch(`${ODOO}/__estado`)).json()) as {
    quants: { lot_id: [number, string] | false; location_id: [number, string]; quantity: number }[];
  };
  const quant = e.quants.find((q) => q.lot_id && q.lot_id[0] === enCamino!.odoo_lot_id && q.quantity > 0);
  expect(quant?.location_id[0]).toBe(await ubicacionDe("AND"));
});
