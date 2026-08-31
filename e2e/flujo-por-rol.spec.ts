/**
 * El recorrido de un pedido por los tres roles, contra la base real.
 *
 * Lo que se comprueba aquí no es que la pantalla pinte bien: es que la escritura
 * llegó a Postgres. De ahí que después de cada cambio venga un `reload()` — hasta
 * la Fase 3 todo esto se veía igual de bien y se perdía al recargar.
 *
 * Las pruebas van en serie y comparten un pedido: es el mismo que pasa de mano en
 * mano, como en el taller, y al final el historial tiene que contar el recorrido
 * entero con el nombre de quién hizo cada cosa.
 */

import { expect, test } from "@playwright/test";
import { alGuardar, borrarPedido, crearPedidoDePrueba, entrar, sesionDe } from "./apoyo";

test.describe.configure({ mode: "serial" });

let codigo: string;

test.beforeAll(async () => {
  codigo = await crearPedidoDePrueba("flujo por rol");
});

test.afterAll(async () => {
  await borrarPedido(codigo);
});

test("Administración lo ve donde toca y le registra un abono", async ({ page }) => {
  await entrar(page, "administracion");

  await page.goto("/admin");
  await expect(page.getByText(codigo).first()).toBeVisible();

  // Va a provincia: sale en Logística.
  await page.goto("/logistica");
  await expect(page.getByText(codigo).first()).toBeVisible();

  // Y no en Tienda, que filtra por entrega o ubicación en tienda.
  await page.goto("/tienda");
  await expect(page.getByText(codigo)).toHaveCount(0);

  await page.goto(`/pedidos/${codigo}`);
  await page.getByRole("button", { name: "Registrar abono" }).click();
  await page.getByLabel("Monto").fill("120");
  await alGuardar(page, () =>
    page.getByRole("button", { name: "Registrar", exact: true }).click(),
  );

  // El saldo lo calcula Postgres: 300 − 120.
  await page.reload();
  await expect(page.getByText("S/ 180.00").first()).toBeVisible();
});

test("Operaciones mueve el estado, ve al cliente y no ve el dinero", async ({ page }) => {
  await entrar(page, "operaciones");

  await page.goto("/taller");
  await expect(page.getByText(codigo).first()).toBeVisible();

  await page.goto(`/pedidos/${codigo}`);
  // El taller atiende llamadas por el pedido: sabe de quién es, no cuánto cuesta.
  await expect(page.getByRole("heading", { name: "E2E flujo por rol" })).toBeVisible();
  await expect(page.getByText("S/ 180.00")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Editar" })).toHaveCount(0);

  await alGuardar(page, () => page.getByRole("button", { name: "En proceso" }).click());

  // La prueba de la Fase 4: sobrevive a la recarga.
  await page.reload();
  await expect(page.getByText("En proceso").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Listo" })).toBeEnabled();

  await alGuardar(page, () => page.getByRole("button", { name: "Listo" }).click());
  await page.reload();

  /* Un pedido a provincia se entrega desde Logística, pero además hace falta la
     factura, que solo escribe Administración: el botón tiene que estar visible y
     apagado, no fallar al pulsarlo. */
  await expect(page.getByText("Falta el número de factura")).toHaveCount(0);
});

test("Logística lo pone en tránsito y lo manda a la agencia", async ({ page }) => {
  await entrar(page, "logistica");

  await page.goto("/logistica");
  await expect(page.getByText(codigo).first()).toBeVisible();

  await page.goto(`/pedidos/${codigo}`);
  await alGuardar(page, () => page.getByRole("button", { name: "En tránsito" }).click());
  await page.reload();
  await expect(page.getByText("En tránsito").first()).toBeVisible();

  // Logística sí mueve la caja: cambia la ubicación.
  // Por su nombre y no por su posición: el detalle tiene varios desplegables y
  // el orden cambia en cuanto la pantalla gana un panel.
  await page.getByRole("combobox", { name: "Ubicación actual" }).click();
  await alGuardar(page, () => page.getByRole("option", { name: "En agencia" }).click());
  await page.reload();
  await expect(page.getByText("En agencia").first()).toBeVisible();
});

test("el historial guarda quién movió cada estado", async () => {
  const supabase = await sesionDe("administracion");

  const { data: pedido } = await supabase
    .from("pedidos")
    .select("id")
    .eq("codigo", codigo)
    .single();

  const { data: historial } = await supabase
    .from("historial_pedido")
    .select("estado, rol, usuario")
    .eq("pedido_id", pedido!.id)
    .order("creado_en");

  const recorrido = (historial ?? []).map((h) => h.estado);
  expect(recorrido).toEqual(["registrado", "en_proceso", "listo", "en_transito"]);

  // Cada paso queda firmado con el rol que lo tenía en ese momento.
  expect(historial?.map((h) => h.rol)).toEqual([
    "administracion",
    "operaciones",
    "operaciones",
    "logistica",
  ]);
  expect(historial?.every((h) => h.usuario)).toBe(true);
});
