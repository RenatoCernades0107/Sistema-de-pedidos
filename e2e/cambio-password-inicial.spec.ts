/**
 * La primera vez que se entra hay que cambiar la contraseña.
 *
 * Lo que se comprueba es la puerta, no el cambio en sí: con la marca puesta, el
 * ingreso acaba en `/cambiar-contrasena` y ninguna vista se deja abrir. Cambiar
 * una contraseña de verdad dejaría el seed distinto de como estaba y la corrida
 * siguiente no podría entrar, así que la marca se pone y se quita a mano.
 *
 * Va sobre miguel (Operaciones) porque la marca es igual para los tres roles y él
 * es el que menos ve: si se colara, se colaría también con los otros dos.
 */

import { expect, test } from "@playwright/test";
import { CONTRASENA, USUARIOS, entrar, marcarCambioPendiente } from "./apoyo";

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  await marcarCambioPendiente("operaciones", false);
});

test("con la marca puesta, el ingreso acaba en el cambio de contraseña", async ({ page }) => {
  await marcarCambioPendiente("operaciones", true);

  await page.goto("/login");
  await page.getByLabel("Usuario").fill(USUARIOS.operaciones);
  await page.getByLabel("Contraseña").fill(CONTRASENA);
  await page.getByRole("button", { name: "Entrar" }).click();

  await expect(page).toHaveURL(/\/cambiar-contrasena/);
  await expect(page.getByRole("heading", { name: "Cambia tu contraseña" })).toBeVisible();
});

test("y ninguna vista se deja abrir hasta que cambie", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Usuario").fill(USUARIOS.operaciones);
  await page.getByLabel("Contraseña").fill(CONTRASENA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/cambiar-contrasena/);

  // Escribir la ruta a mano tampoco vale: la guarda está en el servidor.
  await page.goto("/taller");
  await expect(page).toHaveURL(/\/cambiar-contrasena/);

  await page.goto("/");
  await expect(page).toHaveURL(/\/cambiar-contrasena/);
});

test("sin la marca, el ingreso va directo a la vista del rol", async ({ page }) => {
  await marcarCambioPendiente("operaciones", false);

  await entrar(page, "operaciones");
  await expect(page).toHaveURL(/\/taller/);
});
