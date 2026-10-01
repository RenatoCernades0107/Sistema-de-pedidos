/**
 * El comprobante es opcional para entregar, pero solo Administración lo escribe y lo
 * ve: el trigger de escritura por rol no deja tocar esa columna a Operaciones ni a
 * Logística, y sus vistas tampoco la traen.
 *
 * Aquí se comprueba: el taller puede entregar sin comprobante y sin ver ningún
 * número; Administración lo anota al entregar, y entonces el taller ya lo ve cerrado.
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

test("Operaciones puede entregar el pedido listo aunque no tenga comprobante", async ({ page }) => {
  await entrar(page, "operaciones");
  await page.goto(`/pedidos/${codigo}`);

  // El comprobante ya no bloquea: el botón está activo y sin aviso.
  const entregar = page.getByRole("button", { name: "Entregado" });
  await expect(entregar).toBeEnabled();
  await expect(page.getByText("Falta el número de comprobante")).toHaveCount(0);

  // Y ningún comprobante se le enseña por ningún lado.
  await expect(page.getByText(CUALQUIER_COMPROBANTE)).toHaveCount(0);
});

test("Administración anota el comprobante opcional y entrega en el mismo movimiento", async ({ page }) => {
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
