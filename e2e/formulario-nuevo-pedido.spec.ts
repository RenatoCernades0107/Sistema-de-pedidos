/**
 * Registrar un pedido rellenando el formulario, no llamando a `crear_pedido`.
 *
 * El resto de la carpeta crea sus pedidos por RPC porque hasta la Fase 6 las
 * etiquetas del formulario no señalaban a ningún campo: no había forma de
 * encontrarlos salvo por la estructura del DOM. Ahora cada `Campo` enlaza su
 * etiqueta con su control, así que este recorrido se escribe por nombre — y si
 * alguien vuelve a soltar una etiqueta, esta prueba se cae antes que un lector
 * de pantalla.
 */

import { expect, test } from "@playwright/test";
import { borrarPedido, entrar } from "./apoyo";

const CLIENTE = "E2E formulario";

let codigo: string | null = null;

test.afterAll(async () => {
  if (codigo) await borrarPedido(codigo);
});

test("Administración registra un pedido local buscando los campos por su etiqueta", async ({
  page,
}) => {
  await entrar(page, "administracion");
  await page.goto("/pedidos/nuevo");

  await page.getByLabel("Nombre del cliente").fill(CLIENTE);
  await page.getByLabel("Teléfono del cliente").fill("987654321");

  // Un `<textarea>` también tiene que responder a su etiqueta.
  await page
    .getByLabel("Detalle del pedido")
    .fill("2 Acrílico Alfa 3mm transparente F7");

  // Los tipos de pedido son una botonera, no un `<select>`: se nombran como
  // grupo y cada opción es un botón con `aria-pressed`.
  const tipos = page.getByRole("group", { name: "Tipo de pedido" });
  await expect(tipos.getByRole("button", { name: "Corte láser" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.getByLabel("Cantidad (unidades)").fill("2");

  // La ubicación se elige al registrar: por defecto el taller, aquí la tienda.
  const donde = page.getByRole("group", { name: "¿Dónde está el pedido ahora?" });
  await expect(donde.getByRole("button", { name: "En taller" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await donde.getByRole("button", { name: "En tienda" }).click();

  const manana = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel("Fecha prometida").fill(manana);

  await page.getByLabel("Monto total").fill("150");
  await page.getByLabel("Abono inicial").fill("50");

  await page.getByRole("button", { name: "Registrar pedido" }).click();

  // El código lo pone Postgres; la app navega al detalle en cuanto contesta.
  await page.waitForURL(/\/pedidos\/[A-Z0-9_]+$/);
  codigo = page.url().split("/").pop()!;

  await expect(page.getByRole("heading", { name: CLIENTE })).toBeVisible();
  // 150 − 50: el saldo se calcula en la base, no se envía.
  await expect(page.getByText("S/ 100.00").first()).toBeVisible();
  // La ubicación elegida llegó a Postgres: el pedido nace en tienda, no en taller.
  await expect(page.getByRole("combobox", { name: "Ubicación actual" })).toContainText("En tienda");
});
