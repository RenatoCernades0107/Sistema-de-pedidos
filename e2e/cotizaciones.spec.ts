/**
 * Cotizaciones: registrar con el buscador, crear en Odoo, reintentar, pasar a
 * pedido y permisos.
 *
 * Odoo aquí es el falso de `e2e/odoo-falso.mts`, que Playwright levanta en el
 * puerto 8069 y al que apunta el `next dev` que arranca (ver
 * `playwright.config.ts`). Supabase sí es la base real, como en el resto de la
 * carpeta: las cotizaciones de prueba son de clientes `E2E…` y se borran al
 * terminar.
 *
 * Antes de nada se comprueba que la app de verdad habla con el Odoo falso. Si
 * hubiera un `next dev` ya abierto con el Odoo de la empresa, Playwright lo
 * reutilizaría, y estas pruebas crearían cotizaciones reales: en ese caso se
 * detienen sin crear nada.
 */

import { expect, test, type Page } from "@playwright/test";
import { borrarCotizacionesDePrueba, entrar, sesionDe } from "./apoyo";

const ODOO = process.env.E2E_ODOO_FALSO ?? "http://127.0.0.1:8069";

interface Orden {
  id: number;
  name: string;
  origin: string;
  state: string;
  partner_id: [number, string];
  lineas: { product_id: [number, string]; product_uom_qty: number; price_unit: number; name: string }[];
}

interface EstadoOdoo {
  partners: { id: number; name: string; vat: string | false }[];
  ordenes: Orden[];
  llamadas: { modelo: string; metodo: string }[];
}

async function odoo<T = unknown>(ruta: string, cuerpo?: unknown): Promise<T> {
  const res = await fetch(`${ODOO}${ruta}`, {
    method: cuerpo === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  return (await res.json()) as T;
}

const estado = () => odoo<EstadoOdoo>("/__estado");
const modo = (m: "caido" | "perder-respuesta" | null) => odoo("/__modo", { modo: m });

/** Elige un cliente escribiendo en el buscador y dando Enter, como en mostrador. */
async function elegirCliente(page: Page, texto: string, nombre: RegExp) {
  const buscador = page.getByLabel("Buscar cliente");
  await buscador.fill(texto);
  await expect(page.getByRole("option", { name: nombre })).toHaveAttribute("aria-selected", "true");
  await buscador.press("Enter");
  await expect(page.getByTestId("cliente-elegido")).toContainText(nombre);
}

async function agregarProducto(page: Page, texto: string, nombre: string) {
  const buscador = page.getByLabel("Buscar producto");
  await buscador.fill(texto);
  await expect(page.getByRole("option", { name: new RegExp(nombre) }).first()).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await buscador.press("Enter");
  await expect(page.getByLabel(`Cantidad de ${nombre}`)).toBeFocused();
}

const idDeLaUrl = (page: Page) => page.url().split("/").at(-1)!;

test.describe.configure({ mode: "serial" });

test.skip(
  !!process.env.E2E_URL,
  "Contra un despliegue la app habla con el Odoo de la empresa: estas pruebas solo corren en local.",
);

test.beforeAll(async ({ browser }) => {
  await odoo("/__reiniciar", {});
  await borrarCotizacionesDePrueba();

  // La guarda: un producto que solo existe en el Odoo falso tiene que aparecer,
  // y la consulta tiene que haber llegado al falso.
  const page = await browser.newPage();
  await entrar(page, "administracion");
  await page.goto("/cotizaciones/nueva");
  await page.getByLabel("Buscar producto").fill("E2E-ZZ9");
  await expect(
    page.getByRole("option", { name: /E2E PRODUCTO SOLO EN EL ODOO FALSO/ }),
    "La app no está hablando con el Odoo falso. Cierra el `next dev` que esté abierto y deja que Playwright lo levante.",
  ).toBeVisible();
  const { llamadas } = await estado();
  expect(llamadas.some((l) => l.modelo === "product.product")).toBe(true);
  await page.close();
});

test.afterAll(async () => {
  await modo(null);
  await borrarCotizacionesDePrueba();
});

test("Administración registra una cotización solo con el teclado y queda en Odoo", async ({ page }) => {
  await entrar(page, "administracion");
  await page.goto("/cotizaciones/nueva");

  // Tienda es el canal por defecto.
  const canal = page.getByRole("group", { name: "Canal" });
  await expect(canal.getByRole("button", { name: "Tienda" })).toHaveAttribute("aria-pressed", "true");

  // El buscador de cliente ya tiene el foco; "jose" sin tilde encuentra a "José".
  await expect(page.getByLabel("Buscar cliente")).toBeFocused();
  await elegirCliente(page, "jose", /E2E José Pérez Quispe/);

  // Elegido el cliente, el foco pasa a productos. Por código, con espacio en vez de guion.
  await expect(page.getByLabel("Buscar producto")).toBeFocused();
  await agregarProducto(page, "ac 003", "ACRILICO F8 CRISTAL 3MM");
  const cantidad = page.getByLabel("Cantidad de ACRILICO F8 CRISTAL 3MM");
  await cantidad.fill("3");
  await cantidad.press("Enter");
  await expect(page.getByLabel("Buscar producto")).toBeFocused();

  // Por nombre, con un error de tipeo.
  await agregarProducto(page, "acrlico bronce", "ACRILICO BRONCE 3MM");
  await page.getByLabel("Precio unitario de ACRILICO BRONCE 3MM").fill("150.50");

  // 3 × 120 + 1 × 150.50
  await expect(page.getByText("S/ 510.50")).toBeVisible();

  await page.keyboard.press("Control+Enter");
  await expect(page).toHaveURL(/\/cotizaciones\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("referencia-cotizacion")).toHaveText(/^S\d{5}$/);
  await expect(page.getByText("En Odoo", { exact: true })).toBeVisible();

  const id = idDeLaUrl(page);
  const orden = (await estado()).ordenes.at(-1)!;
  expect(orden.origin).toBe(`App Plexiacril ${id}`);
  expect(orden.partner_id[0]).toBe(1);
  expect(orden.lineas.map((l) => [l.product_id[0], l.product_uom_qty, l.price_unit])).toEqual([
    [10, 3, 120],
    [12, 1, 150.5],
  ]);

  const supabase = await sesionDe("administracion");
  const { data } = await supabase
    .from("cotizaciones")
    .select("canal, sincronizacion, odoo_order_id, odoo_order_name, odoo_partner_id, cotizacion_productos(odoo_product_id, cantidad, precio_unitario, producto_codigo)")
    .eq("id", id)
    .single();
  expect(data).toMatchObject({
    canal: "tienda",
    sincronizacion: "sincronizada",
    odoo_order_id: orden.id,
    odoo_order_name: orden.name,
    odoo_partner_id: 1,
  });
  expect(
    data!.cotizacion_productos
      .map((l) => [l.odoo_product_id, Number(l.cantidad), Number(l.precio_unitario), l.producto_codigo])
      .sort(),
  ).toEqual([
    [10, 3, 120, "AC-003"],
    [12, 1, 150.5, "AC-103"],
  ]);
});

test("el canal WhatsApp queda guardado", async ({ page }) => {
  await entrar(page, "administracion");
  await page.goto("/cotizaciones/nueva");

  await page.getByRole("group", { name: "Canal" }).getByRole("button", { name: "WhatsApp" }).click();
  // Un RUC exacto también se elige con Enter.
  await elegirCliente(page, "20123456786", /E2E Corporación Andina SAC/);
  await agregarProducto(page, "PVC-010", "PVC ESPUMADO BLANCO 10MM");
  await page.getByRole("button", { name: "Crear cotización" }).click();

  await expect(page.getByTestId("referencia-cotizacion")).toHaveText(/^S\d{5}$/);
  const supabase = await sesionDe("administracion");
  const { data } = await supabase.from("cotizaciones").select("canal").eq("id", idDeLaUrl(page)).single();
  expect(data?.canal).toBe("whatsapp");
});

test("el código de barras con Enter inmediato agrega el producto", async ({ page }) => {
  await entrar(page, "administracion");
  await page.goto("/cotizaciones/nueva");

  // Como un lector: escribe todo y da Enter sin esperar la lista.
  const buscador = page.getByLabel("Buscar producto");
  await buscador.fill("7750000000031");
  await buscador.press("Enter");
  await expect(page.getByLabel("Cantidad de ACRILICO F8 CRISTAL 3MM")).toBeFocused();

  // Otra vez: no duplica la línea, suma uno.
  await buscador.fill("7750000000031");
  await buscador.press("Enter");
  await expect(page.getByLabel("Cantidad de ACRILICO F8 CRISTAL 3MM")).toHaveValue("2");
  await expect(page.getByRole("listitem", { name: /Línea \d/ })).toHaveCount(1);
});

test("un cliente que no está se crea en Odoo desde el buscador, sin duplicar", async ({ page }) => {
  await entrar(page, "administracion");
  await page.goto("/cotizaciones/nueva");

  // Un RUC que no existe: la única opción es crearlo, y el RUC va prellenado.
  const buscador = page.getByLabel("Buscar cliente");
  await buscador.fill("20512345671");
  const crear = page.getByRole("option", { name: /Crear cliente «20512345671»/ });
  await expect(crear).toHaveAttribute("aria-selected", "true");
  await buscador.press("Enter");

  const dialogo = page.getByRole("dialog", { name: "Nuevo cliente" });
  await expect(dialogo.getByLabel("RUC o DNI")).toHaveValue("20512345671");
  await dialogo.getByLabel("Nombre o razón social").fill("E2E Nueva Empresa SAC");
  await dialogo.getByRole("button", { name: "Crear cliente" }).click();

  await expect(page.getByTestId("cliente-elegido")).toContainText("E2E Nueva Empresa SAC");
  expect((await estado()).partners.find((p) => p.vat === "20512345671")?.name).toBe("E2E Nueva Empresa SAC");

  // Con un RUC que ya existe no se crea otro: se elige el que había.
  await page.getByRole("button", { name: "Cambiar" }).click();
  const total = (await estado()).partners.length;
  await page.getByLabel("Buscar cliente").fill("E2E Otra Andina");
  await page.getByRole("option", { name: /Crear cliente «E2E Otra Andina»/ }).click();
  await dialogo.getByLabel("RUC o DNI").fill("20123456786");
  await dialogo.getByRole("button", { name: "Crear cliente" }).click();

  await expect(page.getByText("Ese cliente ya estaba en Odoo")).toBeVisible();
  await expect(page.getByTestId("cliente-elegido")).toContainText("E2E Corporación Andina SAC");
  expect((await estado()).partners).toHaveLength(total);
});

test("si Odoo falla, se guarda igual y Reintentar la crea una sola vez", async ({ page }) => {
  await entrar(page, "administracion");
  await page.goto("/cotizaciones/nueva");
  await elegirCliente(page, "nunez", /E2E Ñuñez Talleres EIRL/);
  await agregarProducto(page, "ac-005", "ACRILICO F8 CRISTAL 5MM");

  // Odoo crea la orden pero la respuesta no llega: el peor caso para duplicar.
  await modo("perder-respuesta");
  await page.getByRole("button", { name: "Crear cotización" }).click();

  await expect(page).toHaveURL(/\/cotizaciones\/[0-9a-f-]{36}$/);
  const alerta = page.getByRole("alert").filter({ hasText: "No se creó en Odoo" });
  await expect(alerta).toContainText("la respuesta se perdió");
  await expect(page.getByTestId("referencia-cotizacion")).toHaveText(/^Borrador /);

  await modo(null);
  await alerta.getByRole("button", { name: "Reintentar" }).click();
  await expect(page.getByTestId("referencia-cotizacion")).toHaveText(/^S\d{5}$/);
  await expect(alerta).toHaveCount(0);

  const id = idDeLaUrl(page);
  const ordenes = (await estado()).ordenes.filter((o) => o.origin === `App Plexiacril ${id}`);
  expect(ordenes).toHaveLength(1);
  await expect(page.getByTestId("referencia-cotizacion")).toHaveText(ordenes[0].name);
});

/** Crea una cotización de un producto para el cliente indicado y devuelve su id. */
async function cotizar(page: Page, cliente: string, nombre: RegExp) {
  await page.goto("/cotizaciones/nueva");
  await elegirCliente(page, cliente, nombre);
  await agregarProducto(page, "ac 003", "ACRILICO F8 CRISTAL 3MM");
  await page.getByLabel("Cantidad de ACRILICO F8 CRISTAL 3MM").fill("2");
  await page.getByRole("button", { name: "Crear cotización" }).click();
  await expect(page.getByTestId("referencia-cotizacion")).toHaveText(/^S\d{5}$/);
  return idDeLaUrl(page);
}

const manana = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

test("una cotización pasa a pedido: se elige taller o tienda y se confirma en Odoo", async ({ page }) => {
  await entrar(page, "administracion");
  const id = await cotizar(page, "jose", /E2E José Pérez Quispe/);
  const referencia = (await page.getByTestId("referencia-cotizacion").textContent())!;

  // Un `Button` con `render={<Link/>}` se anuncia como botón, no como enlace.
  await page.getByRole("button", { name: "Crear pedido" }).click();
  await expect(page).toHaveURL(`/pedidos/nuevo?cotizacion=${id}`);
  await expect(page.getByText(`Desde la cotización ${referencia}`)).toBeVisible();

  // Lo cotizado llega llenado: cliente, teléfono, total de Odoo y el detalle.
  await expect(page.getByLabel("Nombre del cliente")).toHaveValue("E2E José Pérez Quispe");
  await expect(page.getByLabel("Teléfono del cliente")).toHaveValue("987 654 321");
  await expect(page.getByLabel("Monto total")).toHaveValue("283.2"); // 2 × 120 + 18 %
  await expect(page.getByLabel("Detalle del pedido")).toHaveValue("2 × [AC-003] ACRILICO F8 CRISTAL 3MM");

  // Taller o tienda no viene elegido: sin elegirlo no se registra.
  const destino = page.getByRole("group", { name: "¿Para dónde va el pedido?" });
  await expect(destino.getByRole("button", { name: /Taller/ })).toHaveAttribute("aria-pressed", "false");
  await expect(destino.getByRole("button", { name: /Tienda/ })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("group", { name: "¿Dónde está el pedido ahora?" })).toHaveCount(0);

  await page.getByLabel("Fecha prometida").fill(manana());
  await page.getByRole("button", { name: "Registrar pedido" }).click();
  await expect(page.getByText("Elige si el pedido va para el taller o para la tienda")).toBeVisible();
  await expect(page).toHaveURL(/\/pedidos\/nuevo/);

  await destino.getByRole("button", { name: /Tienda/ }).click();
  await page.getByRole("button", { name: "Registrar pedido" }).click();

  await page.waitForURL(/\/pedidos\/[A-Z0-9_]+$/);
  const codigo = page.url().split("/").pop()!;
  await expect(page.getByRole("heading", { name: "E2E José Pérez Quispe" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Ubicación actual" })).toContainText("En tienda");

  // En Odoo pasó de cotización a pedido de venta.
  const orden = (await estado()).ordenes.find((o) => o.origin === `App Plexiacril ${id}`)!;
  expect(orden.state).toBe("sale");

  // La cotización apunta al pedido, y ya no ofrece crear otro.
  await page.goto(`/cotizaciones/${id}`);
  await expect(page.getByRole("button", { name: `Ver pedido ${codigo}` })).toBeVisible();
  await expect(page.getByRole("button", { name: "Crear pedido" })).toHaveCount(0);
  await expect(page.getByText("Confirmada en Odoo como pedido de venta.")).toBeVisible();

  // Volver al formulario por la URL lleva al pedido que ya existe.
  await page.goto(`/pedidos/nuevo?cotizacion=${id}`);
  await expect(page).toHaveURL(new RegExp(`/pedidos/${codigo}$`));
});

test("si Odoo no confirma, el pedido se registra igual y se confirma después", async ({ page }) => {
  await entrar(page, "administracion");
  const id = await cotizar(page, "nunez", /E2E Ñuñez Talleres EIRL/);

  await page.goto(`/pedidos/nuevo?cotizacion=${id}`);
  await page
    .getByRole("group", { name: "¿Para dónde va el pedido?" })
    .getByRole("button", { name: /Taller/ })
    .click();
  await page.getByLabel("Fecha prometida").fill(manana());

  await modo("caido");
  await page.getByRole("button", { name: "Registrar pedido" }).click();
  await page.waitForURL(/\/pedidos\/[A-Z0-9_]+$/);
  await expect(page.getByText("Odoo no confirmó la cotización")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Ubicación actual" })).toContainText("En taller");
  await modo(null);

  await page.goto(`/cotizaciones/${id}`);
  const alerta = page.getByRole("alert").filter({ hasText: "No se confirmó en Odoo" });
  await expect(alerta).toContainText("caído a propósito");
  await alerta.getByRole("button", { name: "Confirmar en Odoo" }).click();
  await expect(page.getByText("Confirmada en Odoo como pedido de venta.")).toBeVisible();

  const orden = (await estado()).ordenes.find((o) => o.origin === `App Plexiacril ${id}`)!;
  expect(orden.state).toBe("sale");
});

test("la lista filtra, y el formulario sugiere lo usado", async ({ page }) => {
  await entrar(page, "administracion");
  await page.goto("/cotizaciones");

  await expect(page.getByRole("link", { name: /^S\d{5}$/ }).first()).toBeVisible();
  await page.getByRole("group", { name: "Canal" }).getByRole("button", { name: "WhatsApp" }).click();
  const tabla = page.locator("table");
  await expect(tabla.getByText("E2E Corporación Andina SAC")).toBeVisible();
  await expect(tabla.getByText("E2E José Pérez Quispe")).toHaveCount(0);

  await page.getByRole("group", { name: "Canal" }).getByRole("button", { name: "Todas" }).click();
  await page.getByLabel("Filtrar cotizaciones").fill("bronce");
  await expect(tabla.getByText("E2E José Pérez Quispe")).toBeVisible();
  await expect(tabla.getByText("E2E Corporación Andina SAC")).toHaveCount(0);

  // Al enfocar los buscadores vacíos: los clientes de hace poco y lo más cotizado.
  await page.goto("/cotizaciones/nueva");
  await page.getByLabel("Buscar cliente").focus();
  await expect(page.getByText("Cotizados hace poco")).toBeVisible();
  await expect(page.getByRole("option", { name: /E2E Ñuñez Talleres EIRL/ })).toBeVisible();

  await page.getByLabel("Buscar producto").focus();
  await expect(page.getByText("Los más cotizados")).toBeVisible();
  await expect(page.getByRole("option", { name: /ACRILICO F8 CRISTAL 3MM/ })).toBeVisible();
});

for (const [rol, vista] of [
  ["logistica", "/pedidos"],
  ["operaciones", "/pedidos"],
] as const) {
  test(`${rol} no ve ni puede usar las cotizaciones`, async ({ page }) => {
    await entrar(page, rol);
    await expect(page.getByRole("link", { name: "Cotizaciones" })).toHaveCount(0);

    await page.goto("/cotizaciones");
    await expect(page).toHaveURL(new RegExp(`${vista}$`));
    await page.goto("/cotizaciones/nueva");
    await expect(page).toHaveURL(new RegExp(`${vista}$`));

    // El buscador tampoco contesta: no se puede leer Odoo por la puerta de atrás.
    const r = await page.request.get("/api/cotizaciones/buscar/clientes?q=andina");
    expect(r.status()).toBe(401);
  });
}
