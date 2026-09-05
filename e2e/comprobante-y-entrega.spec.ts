/**
 * El comprobante, que es donde el modelo se muerde la cola.
 *
 * `pedidos_comprobante_al_entregar` exige el número para pasar a `entregado`, pero
 * el trigger de escritura por rol no deja escribir esa columna a Operaciones ni a
 * Logística, y sus vistas tampoco la traen. Sin `tiene_comprobante` el taller solo
 * podía enterarse pulsando el botón y comiéndose el error de Postgres.
 *
 * Aquí se comprueba lo que se hizo con eso: el taller sabe que no puede entregar y
 * ve por qué, sin ver el número; Administración registra el comprobante y entrega en
 * el mismo movimiento, y entonces el taller ya lo ve cerrado.
 *
 * Se usa una boleta a propósito: el negocio emite los dos tipos, y una aserción
 * anclada a `F001-` dejaría pasar una boleta filtrada sin que nadie se entere.
 */

import { expect, test } from "@playwright/test";
import { alGuardar, borrarPedido, crearPedidoLocalListo, entrar } from "./apoyo";

test.describe.configure({ mode: "serial" });

/** Cualquier comprobante, de los cuatro tipos. Lo que el taller no debe ver nunca. */
const CUALQUIER_COMPROBANTE = /\b(?:[FBP]|NV)\d{3}-\d{1,8}\b/;

let codigo: string;

test.beforeAll(async () => {
  codigo = await crearPedidoLocalListo("comprobante");
});

test.afterAll(async () => {
  await borrarPedido(codigo);
});

test("Operaciones ve el pedido listo pero no puede entregarlo sin comprobante", async ({ page }) => {
  await entrar(page, "operaciones");
  await page.goto(`/pedidos/${codigo}`);

  // El botón existe —la transición es válida— pero está apagado y explicado.
  const entregar = page.getByRole("button", { name: "Entregado" });
  await expect(entregar).toBeVisible();
  await expect(entregar).toBeDisabled();
  await expect(page.getByText("Falta el número de comprobante")).toBeVisible();

  // Y ningún comprobante se le enseña por ningún lado.
  await expect(page.getByText(CUALQUIER_COMPROBANTE)).toHaveCount(0);
});

test("Administración registra el comprobante y entrega en el mismo movimiento", async ({ page }) => {
  await entrar(page, "administracion");
  await page.goto(`/pedidos/${codigo}`);

  await page.getByRole("button", { name: "Entregado" }).click();
  await page.getByLabel("Número de comprobante").fill("B001-009911");
  await alGuardar(page, () => page.getByRole("button", { name: "Confirmar cambio" }).click());

  await page.reload();
  // Sale dos veces: en el campo y en la línea de auditoría que lo registró.
  await expect(page.getByText("B001-009911").first()).toBeVisible();
  // Y se muestra con su tipo, derivado del prefijo.
  await expect(page.getByText("Boleta B001-009911")).toBeVisible();
  // Estado terminal: ya no quedan transiciones que ofrecer.
  await expect(page.getByText("el pedido está cerrado")).toBeVisible();
});

test("y entonces el taller lo ve entregado, todavía sin el número", async ({ page }) => {
  await entrar(page, "operaciones");
  await page.goto(`/pedidos/${codigo}`);

  await expect(page.getByText("Entregado").first()).toBeVisible();
  await expect(page.getByText(CUALQUIER_COMPROBANTE)).toHaveCount(0);
});
