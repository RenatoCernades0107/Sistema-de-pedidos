/**
 * El pedido de prueba con corte que usan las pruebas del taller: se registra por
 * el formulario, como en mostrador, contra el Odoo falso.
 */

import { expect, type Page } from "@playwright/test";
import { entrar } from "./apoyo";

const manana = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

/**
 * Registra, como Administración, un pedido para el taller con un producto suelto
 * y un corte de 10 piezas de 60×80 en ECO cristal de 3 mm: 3 planchas del
 * F7E024 (2 completas y 1 media), con indicaciones si se dan. Devuelve el código.
 */
export async function registrarPedidoConCorte(page: Page, indicaciones?: string): Promise<string> {
  // Entra solo si hace falta: quien llama puede venir ya con la sesión de Administración.
  await page.goto("/pedidos/nuevo");
  if (page.url().includes("/login")) {
    await entrar(page, "administracion");
    await page.goto("/pedidos/nuevo");
  }

  const cliente = page.getByLabel("Buscar cliente");
  await cliente.fill("jose");
  await expect(page.getByRole("option", { name: /E2E José Pérez Quispe/ })).toHaveAttribute("aria-selected", "true");
  await cliente.press("Enter");

  const producto = page.getByLabel("Buscar producto");
  await producto.fill("ac 003");
  await expect(page.getByRole("option", { name: /ACRILICO F8 CRISTAL 3MM/ }).first()).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await producto.press("Enter");

  await page.getByRole("button", { name: "Corte a medida" }).click();
  await page.getByLabel("Buscar material").fill("eco cristal 3");
  await expect(page.getByRole("option", { name: /Acrílico ECO.*Cristal.*3 mm/ }).first()).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByLabel("Buscar material").press("Enter");
  await page.getByLabel("Ancho de la pieza 1").fill("60");
  await page.getByLabel("Alto de la pieza 1").fill("80");
  await page.getByLabel("Cantidad de la pieza 1").fill("10");
  await expect(page.getByText("Elegida la más barata con stock.")).toBeVisible();
  await page.getByRole("button", { name: "Agregar corte" }).click();

  await page.getByLabel("Fecha prometida").fill(manana());
  await page.getByRole("group", { name: "¿Para dónde va el pedido?" }).getByRole("button", { name: /Taller/ }).click();
  if (indicaciones) await page.getByLabel("Notas generales").fill(indicaciones);
  await page.getByRole("button", { name: "Registrar pedido" }).click();
  await page.waitForURL(/\/pedidos\/P\d{4}-\d{3}$/);
  return page.url().split("/").pop()!;
}

