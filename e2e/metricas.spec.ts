/**
 * El dashboard de `/metricas`: quién entra y que la pantalla responda al selector.
 *
 * Los números no se comprueban aquí: salen de funciones puras de `lib/metricas.ts`
 * sobre los pedidos que haya en la base, y la base es compartida. Lo que sí se
 * comprueba es la puerta —solo Administración— y que el período y la pestaña
 * vivan en la URL, que es lo que hace que una recarga abra lo mismo.
 */

import { expect, test } from "@playwright/test";
import { entrar } from "./apoyo";

test("Administración lo encuentra en el menú y cambia de pestaña y de período", async ({
  page,
}) => {
  await entrar(page, "administracion");

  await page.getByRole("link", { name: "Métricas" }).first().click();
  await expect(page).toHaveURL(/\/metricas$/);
  await expect(page.getByRole("heading", { name: "Métricas" })).toBeVisible();
  await expect(page.getByText("Requiere atención")).toBeVisible();

  await page.getByRole("tab", { name: "Cobranza" }).click();
  await expect(page).toHaveURL(/v=cobranza/);
  await expect(page.getByText("Antigüedad de la deuda")).toBeVisible();

  await page.getByRole("combobox", { name: "Período" }).click();
  await page.getByRole("option", { name: "Este año" }).click();
  await expect(page).toHaveURL(/p=anio/);

  // La recarga abre lo mismo: la pestaña y el período salen de la URL.
  await page.reload();
  await expect(page.getByRole("tab", { name: "Cobranza" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("combobox", { name: "Período" })).toContainText("Este año");
});

for (const [rol, inicio] of [
  ["logistica", "/logistica"],
  ["operaciones", "/taller"],
] as const) {
  test(`${rol} no entra: vuelve a su vista`, async ({ page }) => {
    await entrar(page, rol);
    await expect(page.getByRole("link", { name: "Métricas" })).toHaveCount(0);

    await page.goto("/metricas");
    await expect(page).toHaveURL(new RegExp(`${inicio}$`));
  });
}
