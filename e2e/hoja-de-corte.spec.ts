/**
 * La hoja de corte: lo que el taller imprime y se lleva a la mesa. Sin precios
 * para nadie, con cada plancha dibujada y sin el menú de la app al imprimir.
 *
 * Odoo es el falso de `e2e/odoo-falso.mts`; el pedido es de un cliente `E2E…` y
 * se borra al final.
 */

import { expect, test } from "@playwright/test";
import { borrarCotizacionesDePrueba, entrar } from "./apoyo";
import { registrarPedidoConCorte } from "./pedido-con-corte";

const ODOO = process.env.E2E_ODOO_FALSO ?? "http://127.0.0.1:8069";

test.describe.configure({ mode: "serial" });

test.skip(!!process.env.E2E_URL, "Contra un despliegue la app habla con el Odoo de la empresa.");

let codigo = "";

test.beforeAll(async ({ browser }) => {
  await fetch(`${ODOO}/__reiniciar`, { method: "POST" });
  await borrarCotizacionesDePrueba();
  const page = await browser.newPage();
  codigo = await registrarPedidoConCorte(page, "Bordes pulidos, entregar en caja");
  await page.close();
});

test.afterAll(async () => {
  await borrarCotizacionesDePrueba();
});

test("el taller abre la hoja desde el pedido: piezas, planchas, indicaciones y nada de precios", async ({ page }) => {
  await entrar(page, "operaciones");
  await page.goto(`/pedidos/${codigo}`);
  await page.getByRole("button", { name: "Hoja de corte" }).click();
  await page.waitForURL(`**/pedidos/${codigo}/hoja-de-corte`);

  const hoja = page.getByRole("article");
  await expect(hoja.getByRole("heading", { name: codigo })).toBeVisible();
  await expect(hoja.getByText("E2E José Pérez Quispe")).toBeVisible();
  // Las indicaciones, sin la lista de productos que el detalle lleva delante.
  await expect(hoja.getByText("Bordes pulidos, entregar en caja")).toBeVisible();
  await expect(hoja.getByText(/^Indicaciones:.*\[AC-003\]/)).toHaveCount(0);

  await expect(hoja.getByRole("heading", { name: "Corte láser · Acrílico ECO · Cristal · 3 mm" })).toBeVisible();
  const piezas = hoja.getByRole("table", { name: "Piezas del corte" });
  await expect(piezas.getByRole("row")).toHaveCount(2);
  await expect(piezas).toContainText("60 × 80 cm");

  await expect(hoja.getByRole("img", { name: /^Plancha \d de 3/ })).toHaveCount(3);
  await expect(hoja.getByText("Plancha nueva F7E024 (122×183)")).toHaveCount(3);
  await expect(hoja.getByText(/cortar primero media plancha \(61×183\): el resto vuelve al almacén/)).toBeVisible();
  await expect(hoja.getByText("Planchas usadas:")).toBeVisible();

  // Lo demás que lleva el pedido.
  await expect(hoja.getByText("ACRILICO F8 CRISTAL 3MM")).toBeVisible();
  await expect(hoja.getByText(/S\/\s/)).toHaveCount(0);
});

test("Administración tampoco ve precios en la hoja, y al imprimir solo sale la hoja", async ({ page }) => {
  await entrar(page, "administracion");
  await page.goto(`/pedidos/${codigo}/hoja-de-corte`);
  const hoja = page.getByRole("article");
  await expect(hoja.getByRole("img", { name: /^Plancha 1 de 3/ })).toBeVisible();
  await expect(hoja.getByText(/S\/\s/)).toHaveCount(0);

  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("navigation", { name: "Menú principal" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Imprimir" })).toBeHidden();
  await expect(hoja.getByRole("img", { name: /^Plancha 1 de 3/ })).toBeVisible();
});
