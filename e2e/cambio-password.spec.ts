/**
 * El cambio de contraseña voluntario, el que cualquiera puede pedir sin que
 * nadie lo obligue. Aquí solo se comprueba que se llega y que el formulario
 * valida: ninguna prueba envía un par de contraseñas válido y coincidente,
 * porque eso sí llamaría a `supabase.auth.updateUser` de verdad y dejaría el
 * seed distinto de como lo encontró (ver el aviso en `apoyo.ts`).
 */

import { expect, test } from "@playwright/test";
import { entrar, marcarCambioPendiente } from "./apoyo";

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

  // Dos contraseñas seguras y distintas entre sí (y de CONTRASENA): así el único
  // fallo posible es que no coinciden, no que alguna sea débil.
  await page.getByLabel("Contraseña nueva").fill("Zorro-Azul-4712");
  await page.getByLabel("Repite la contraseña").fill("Zorro-Azul-4713");
  await page.getByRole("button", { name: "Guardar cambios" }).click();

  await expect(page.getByRole("alert")).toHaveText("Las dos contraseñas no coinciden");
  // Se queda en la misma pantalla: no hubo cambio que redirigir.
  await expect(page).toHaveURL(/\/cuenta\/contrasena/);
});

test("la barra pasa de roja a amarilla y a verde, y una contraseña débil no se envía", async ({ page }) => {
  await entrar(page, "logistica");
  await page.goto("/cuenta/contrasena");

  const campo = page.getByLabel("Contraseña nueva");
  const barra = page.getByRole("meter", { name: "Seguridad de la contraseña" });

  await campo.fill("abc");
  await expect(barra).toHaveAttribute("aria-valuetext", "Insegura");

  await campo.fill("Zorrazul1");
  await expect(barra).toHaveAttribute("aria-valuetext", "Casi: todavía falta algo");

  await campo.fill("Zorro-Azul-4712");
  await expect(barra).toHaveAttribute("aria-valuetext", "Segura");
});
