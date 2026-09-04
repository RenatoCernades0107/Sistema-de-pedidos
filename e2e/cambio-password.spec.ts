/**
 * El cambio de contraseña voluntario, el que cualquiera puede pedir sin que
 * nadie lo obligue. Aquí solo se comprueba que se llega y que el formulario
 * valida: ninguna prueba envía un par de contraseñas válido y coincidente,
 * porque eso sí llamaría a `supabase.auth.updateUser` de verdad y dejaría el
 * seed distinto de como lo encontró (ver el aviso en `apoyo.ts`).
 */

import { expect, test } from "@playwright/test";
import { CONTRASENA, entrar, marcarCambioPendiente } from "./apoyo";

test.beforeAll(async () => {
  await marcarCambioPendiente("logistica", false);
});

test("se llega desde el menú de usuario", async ({ page }) => {
  await entrar(page, "logistica");

  await page.getByRole("button", { name: "Carla" }).click();
  await page.getByRole("menuitem", { name: "Cambiar contraseña" }).click();

  await expect(page).toHaveURL(/\/cuenta\/contrasena/);
  await expect(page.getByRole("heading", { name: "Cambiar contraseña" })).toBeVisible();
});

test("el formulario pide las dos contraseñas", async ({ page }) => {
  await entrar(page, "logistica");
  await page.goto("/cuenta/contrasena");

  await expect(page.getByLabel("Contraseña nueva")).toBeVisible();
  await expect(page.getByLabel("Repite la contraseña")).toBeVisible();
  await expect(page.getByRole("button", { name: "Guardar cambios" })).toBeVisible();
});

test("si las dos contraseñas no coinciden, avisa sin llegar a cambiar nada", async ({ page }) => {
  await entrar(page, "logistica");
  await page.goto("/cuenta/contrasena");

  // A propósito nunca es CONTRASENA: que la nueva coincida con la de siempre
  // dispararía el mismo aviso por otra razón y no probaría lo que hace falta.
  await page.getByLabel("Contraseña nueva").fill(`${CONTRASENA}-nueva-1`);
  await page.getByLabel("Repite la contraseña").fill(`${CONTRASENA}-nueva-2`);
  await page.getByRole("button", { name: "Guardar cambios" }).click();

  await expect(page.getByRole("alert")).toHaveText("Las dos contraseñas no coinciden");
  // Se queda en la misma pantalla: no hubo cambio que redirigir.
  await expect(page).toHaveURL(/\/cuenta\/contrasena/);
});
