/**
 * La factura, que es donde el modelo se muerde la cola.
 *
 * `pedidos_numero_factura_check` exige el número para pasar a `entregado`, pero el
 * trigger de escritura por rol no deja escribir esa columna a Operaciones ni a
 * Logística, y sus vistas tampoco la traen. Sin `tiene_factura` el taller solo
 * podía enterarse pulsando el botón y comiéndose el error de Postgres.
 *
 * Aquí se comprueba lo que se hizo con eso: el taller sabe que no puede entregar y
 * ve por qué, sin ver el número; Administración factura y entrega en el mismo
 * movimiento, y entonces el taller ya lo ve cerrado.
 */

import { expect, test } from "@playwright/test";
import { alGuardar, borrarPedido, crearPedidoLocalListo, entrar } from "./apoyo";

test.describe.configure({ mode: "serial" });

let codigo: string;

test.beforeAll(async () => {
  codigo = await crearPedidoLocalListo("factura");
});

test.afterAll(async () => {
  await borrarPedido(codigo);
});

test("Operaciones ve el pedido listo pero no puede entregarlo sin factura", async ({ page }) => {
  await entrar(page, "operaciones");
  await page.goto(`/pedidos/${codigo}`);

  // El botón existe —la transición es válida— pero está apagado y explicado.
  const entregar = page.getByRole("button", { name: "Entregado" });
  await expect(entregar).toBeVisible();
  await expect(entregar).toBeDisabled();
  await expect(page.getByText("Falta el número de factura")).toBeVisible();

  // Y el número no se le enseña por ningún lado.
  await expect(page.getByText("F001-")).toHaveCount(0);
});

test("Administración factura y entrega en el mismo movimiento", async ({ page }) => {
  await entrar(page, "administracion");
  await page.goto(`/pedidos/${codigo}`);

  await page.getByRole("button", { name: "Entregado" }).click();
  await page.getByLabel("Número de factura").fill("F001-009911");
  await alGuardar(page, () => page.getByRole("button", { name: "Confirmar cambio" }).click());

  await page.reload();
  // Sale dos veces: en el campo y en la línea de auditoría que lo registró.
  await expect(page.getByText("F001-009911").first()).toBeVisible();
  // Estado terminal: ya no quedan transiciones que ofrecer.
  await expect(page.getByText("el pedido está cerrado")).toBeVisible();
});

test("y entonces el taller lo ve entregado, todavía sin el número", async ({ page }) => {
  await entrar(page, "operaciones");
  await page.goto(`/pedidos/${codigo}`);

  await expect(page.getByText("Entregado").first()).toBeVisible();
  await expect(page.getByText("F001-009911")).toHaveCount(0);
});
