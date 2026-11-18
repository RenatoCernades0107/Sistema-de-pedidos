/**
 * Bajas, conteo físico y kárdex.
 *
 *   - Logística reporta una plancha rota: Odoo no cambia hasta que
 *     Administración cierra el caso con su razón (entonces es un desecho).
 *   - Logística cuenta a ciegas y envía: cada diferencia queda como un caso;
 *     Administración descarta uno (apareció) y aplica el otro.
 *   - El kárdex muestra cada movimiento con su saldo.
 *
 * Odoo es el falso de `e2e/odoo-falso.mts`. Los casos y conteos se quedan (son un
 * registro); el sobrante de prueba se da de baja al final.
 */

import { expect, test, type Page } from "@playwright/test";
import { entrar, sesionDe } from "./apoyo";
import { ODOO, contar, elegir, estado, stockEn } from "./odoo-apoyo";

const sobrantesDePrueba: string[] = [];

async function limpiar() {
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
});

test.afterAll(limpiar);

async function comoAdmin(page: Page) {
  const admin = await (await page.context().browser()!.newContext()).newPage();
  await entrar(admin, "administracion");
  return admin;
}

/** Cierra un caso desde la pestaña Casos. */
async function cerrar(admin: Page, codigo: string, decision: "Aplicar en Odoo" | "Descartar", razon: string) {
  await admin.goto("/almacen?vista=casos");
  await admin.getByRole("button", { name: `Cerrar ${codigo}` }).click();
  const dialogo = admin.getByRole("dialog", { name: `Cerrar ${codigo}` });
  await dialogo.getByRole("button", { name: decision }).click();
  await dialogo.getByRole("button", { name: "Cerrar caso" }).click();
  await expect(dialogo.getByRole("alert")).toContainText("razón");
  await dialogo.getByLabel("Razón").fill(razon);
  await dialogo.getByRole("button", { name: "Cerrar caso" }).click();
  await expect(dialogo).toBeHidden();
  await expect(admin.getByRole("listitem", { name: codigo })).toContainText(razon);
}

test("una baja reportada no toca Odoo hasta que Administración la cierra con su razón", async ({ page }) => {
  await entrar(page, "logistica");
  await page.goto("/almacen");
  await expect.poll(async () => (await estado()).almacenes.map((a) => a.code).sort()).toEqual(["AND", "CAT", "ESM", "WH"]);
  await contar("F7E024", "CAT", 5);
  await page.reload();

  await page.getByRole("button", { name: "Reportar baja" }).click();
  const dialogo = page.getByRole("dialog", { name: "Reportar baja" });
  await elegir(page, dialogo, "Almacén", "Católica (taller)");
  await dialogo.getByLabel("Buscar plancha o accesorio").fill("F7E024");
  await expect(dialogo.getByRole("option", { name: /F7E024/ }).first()).toHaveAttribute("aria-selected", "true");
  await dialogo.getByLabel("Buscar plancha o accesorio").press("Enter");
  await expect(dialogo).toContainText("En ese almacén hay 5");
  await dialogo.getByLabel("Cantidad").fill("1");
  await dialogo.getByRole("button", { name: "Rotura" }).click();
  await dialogo.getByLabel("Qué pasó").fill("E2E se rajó al descargar");
  // Logística no aplica: solo reporta.
  await expect(dialogo.getByRole("checkbox", { name: "Aplicar ya en Odoo" })).toHaveCount(0);
  await dialogo.getByRole("button", { name: "Reportar baja" }).click();
  await expect(dialogo).toBeHidden();
  const aviso = page.getByText(/^CAS-\d+ reportado$/);
  await expect(aviso).toBeVisible();
  const caso = (await aviso.textContent())!.split(" ")[0];
  expect(await stockEn("F7E024", "CAT")).toBe(5);

  // Logística ve el caso, pero no lo cierra.
  await page.goto("/almacen?vista=casos");
  await expect(page.getByRole("listitem", { name: caso })).toContainText("Pendiente");
  await expect(page.getByRole("button", { name: `Cerrar ${caso}` })).toHaveCount(0);

  // Administración recibe el aviso y lo cierra aplicándolo: un desecho en Odoo.
  const supabase = await sesionDe("administracion");
  const { data: avisos } = await supabase.from("notificaciones").select("cuerpo").eq("tipo", "caso_stock").like("cuerpo", `%${caso}%`);
  expect(avisos?.length).toBeGreaterThan(0);
  const admin = await comoAdmin(page);
  await cerrar(admin, caso, "Aplicar en Odoo", "Se rompió al descargar del camión");
  await expect(admin.getByRole("listitem", { name: caso })).toContainText("Aplicado en Odoo");
  expect(await stockEn("F7E024", "CAT")).toBe(4);
});

test("un conteo ciego deja cada diferencia como un caso; uno se descarta y otro se aplica", async ({ page }) => {
  await entrar(page, "logistica");

  // Un sobrante en Católica, para contarlo.
  await page.goto("/almacen?vista=sobrantes");
  await page.getByRole("button", { name: "Registrar sobrante" }).click();
  const registro = page.getByRole("dialog", { name: "Registrar sobrante" });
  await registro.getByLabel("Buscar material").fill("eco cristal 3");
  await expect(registro.getByRole("option", { name: /Acrílico ECO.*Cristal.*3 mm/ }).first()).toHaveAttribute("aria-selected", "true");
  await registro.getByLabel("Buscar material").press("Enter");
  await expect(registro.getByLabel("Largo (cm)")).toBeFocused();
  await registro.getByLabel("Largo (cm)").fill("90");
  await registro.getByLabel("Ancho (cm)").fill("60");
  await elegir(page, registro, "Almacén", "Católica (taller)");
  await registro.getByLabel("Ubicación").fill("E2E rack conteo");
  await registro.getByRole("button", { name: "Registrar" }).click();
  const registrado = page.getByText(/^SOB-\d+ registrado$/);
  await expect(registrado).toBeVisible();
  const sobrante = (await registrado.textContent())!.replace(" registrado", "");
  sobrantesDePrueba.push(sobrante);

  // El conteo: planchas de ECO y los sobrantes de Católica.
  await page.goto("/almacen?vista=conteos");
  await page.getByRole("button", { name: "Nuevo conteo" }).click();
  const nuevo = page.getByRole("dialog", { name: "Nuevo conteo" });
  await elegir(page, nuevo, "Almacén", "Católica (taller)");
  await elegir(page, nuevo, "Material a contar", "Acrílico ECO");
  await nuevo.getByRole("checkbox", { name: "Sobrantes" }).click();
  await nuevo.getByRole("button", { name: "Empezar a contar" }).click();
  await page.waitForURL(/conteo=CNT-\d+/);
  const conteo = decodeURIComponent(page.url().split("conteo=")[1]);

  // Ciego: la lista no dice cuánto hay.
  await expect(page.getByText("En ese almacén hay")).toHaveCount(0);
  await page.getByLabel("Contaste F7E024").fill("3");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Conteo guardado")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Contaste F7E024")).toHaveValue("3");

  await page.getByRole("listitem", { name: sobrante }).getByRole("button", { name: "No está" }).click();
  await page.getByRole("button", { name: "Enviar a revisión" }).click();
  // Quedan planchas sin contar: lo advierte antes de enviar.
  await expect(page.getByText(/^Quedan \d+ sin contar/)).toBeVisible();
  await page.getByRole("button", { name: "Enviar igual" }).click();
  await expect(page.getByText(`${conteo} enviado`)).toBeVisible();
  await expect(page.getByText(/^2 diferencias, \d+ coinciden/)).toBeVisible();
  expect(await stockEn("F7E024", "CAT")).toBe(4);

  // Administración: el sobrante apareció (se descarta); la plancha falta de verdad (se aplica).
  const supabase = await sesionDe("administracion");
  const { data: casos } = await supabase
    .from("casos_stock")
    .select("codigo, codigo_producto, cantidad, esperado, contado, conteos_stock!inner(codigo)")
    .eq("conteos_stock.codigo", conteo)
    .order("codigo");
  expect(casos?.map((c) => [c.codigo_producto, Number(c.cantidad)])).toEqual([
    ["F7E024", -1],
    [sobrante, -1],
  ]);
  const admin = await comoAdmin(page);
  const deSobrante = casos!.find((c) => c.codigo_producto === sobrante)!.codigo;
  const dePlancha = casos!.find((c) => c.codigo_producto === "F7E024")!.codigo;
  await cerrar(admin, deSobrante, "Descartar", "Apareció en el rack 3");
  await expect(admin.getByRole("listitem", { name: dePlancha })).toContainText("contado 3, el sistema decía 4");
  await cerrar(admin, dePlancha, "Aplicar en Odoo", "Faltante confirmado: se usó sin anotar");
  expect(await stockEn("F7E024", "CAT")).toBe(3);
  const { data: s } = await supabase.from("sobrantes").select("estado").eq("codigo", sobrante).single();
  expect(s!.estado).toBe("disponible");
});

test("el kárdex muestra cada movimiento con su saldo, y el taller también lo ve", async ({ page }) => {
  await entrar(page, "operaciones");
  await page.goto("/almacen");
  await page.getByLabel("Buscar plancha").fill("F7E024");
  await page.getByRole("button", { name: "Kárdex de F7E024" }).click();
  const kardex = page.getByRole("table", { name: "Kárdex de F7E024" });
  await expect(kardex).toBeVisible();
  const filas = kardex.getByRole("row");
  // Del más nuevo al más viejo: el ajuste del conteo, la baja y el inventario inicial.
  await expect(filas.nth(1)).toContainText(/Caso CAS-\d+|Ajuste de conteo CAS-\d+/);
  await expect(filas.nth(1)).toContainText("−1");
  await expect(filas.nth(1).getByRole("cell").last()).toHaveText("3");
  await expect(filas.nth(2)).toContainText(/Baja CAS-\d+/);
  await expect(filas.nth(2).getByRole("cell").last()).toHaveText("4");
  await expect(filas.nth(3)).toContainText("Ajuste en Odoo");
  await expect(filas.nth(3).getByRole("cell").last()).toHaveText("5");
});
