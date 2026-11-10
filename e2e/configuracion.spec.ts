/**
 * Configuración: los precios de corte y el catálogo de planchas, que solo
 * Administración puede abrir y cambiar.
 *
 * La base es la real, como en el resto de la carpeta: cada prueba deja la
 * configuración y el catálogo como los encontró.
 */

import { expect, test } from "@playwright/test";
import { entrar, sesionDe } from "./apoyo";

test.describe.configure({ mode: "serial" });

let configPrevia: { valor: unknown } | null = null;

test.beforeAll(async () => {
  const supabase = await sesionDe("administracion");
  const { data } = await supabase.from("configuracion").select("valor").eq("clave", "cortes").maybeSingle();
  configPrevia = data;
});

test.afterAll(async () => {
  const supabase = await sesionDe("administracion");
  if (configPrevia) {
    await supabase.from("configuracion").update({ valor: configPrevia.valor as never }).eq("clave", "cortes");
  } else {
    await supabase.from("configuracion").delete().eq("clave", "cortes");
  }
});

test("Administración cambia el precio del corte manual y queda guardado", async ({ page }) => {
  await entrar(page, "administracion");
  await page.getByRole("link", { name: "Configuración" }).click();
  await expect(page.getByRole("heading", { name: "Configuración" })).toBeVisible();

  const guardar = page.getByRole("button", { name: "Guardar cambios" });
  await expect(guardar).toBeDisabled();

  // Una excepción: a mano también se corta 8 mm.
  const manual = page.locator("section").filter({ hasText: "Corte manual" }).first();
  await manual.getByRole("button", { name: "Agregar espesor" }).click();
  const filas = await manual.getByLabel(/^Espesor, fila \d+ de corte manual$/).count();
  await page.getByLabel(`Espesor, fila ${filas} de corte manual`).fill("8");
  await page.getByLabel(`Precio por pieza, fila ${filas} de corte manual`).fill("9.5");
  await page.getByLabel("Recargo por fracción").fill("25");

  await guardar.click();
  await expect(page.getByText("Configuración de cortes guardada")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Recargo por fracción")).toHaveValue("25");
  await expect(page.getByLabel(`Espesor, fila ${filas} de corte manual`)).toHaveValue("8");
  await expect(page.getByLabel(`Precio por pieza, fila ${filas} de corte manual`)).toHaveValue("9.5");

  const supabase = await sesionDe("administracion");
  const { data } = await supabase.from("configuracion").select("valor").eq("clave", "cortes").single();
  const valor = data!.valor as { cobro: { recargoPct: number }; manual: { precios: { mm: number; precio: number }[] } };
  expect(valor.cobro.recargoPct).toBe(25);
  expect(valor.manual.precios).toContainEqual({ mm: 8, precio: 9.5 });
});

test("un número que no sirve se rechaza diciendo cuál", async ({ page }) => {
  await entrar(page, "administracion");
  await page.goto("/configuracion");

  await page.getByLabel("Velocidad, fila 2 de corte láser").fill("0");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("Corte láser, fila 2: la velocidad no es un valor válido.")).toBeVisible();
});

test("el catálogo se filtra y el piloto de sobrantes se enciende por grupo", async ({ page }) => {
  await entrar(page, "administracion");
  await page.goto("/configuracion");
  await page.getByRole("tab", { name: /Planchas/ }).click();

  await page.getByLabel("Filtrar planchas").fill("eco cristal 3mm");
  const fila = page.getByRole("row").filter({ hasText: "F7E024" });
  await expect(fila).toBeVisible();
  await expect(fila).toContainText("122×183");
  await expect(page.getByRole("row").filter({ hasText: "F7E004" })).toHaveCount(0);

  const sobrantes = page.getByRole("checkbox", { name: "Acrílico ECO · Cristal · 3 mm: registrar sobrantes" });
  await expect(sobrantes).not.toBeChecked();
  await sobrantes.click();
  await expect(sobrantes).toBeChecked();

  const supabase = await sesionDe("administracion");
  const leer = async () =>
    (
      await supabase
        .from("grupos_plancha")
        .select("sobrantes_activo")
        .match({ material: "Acrílico ECO", variante: "Cristal", detalle: "", espesor_mm: 3 })
        .single()
    ).data?.sobrantes_activo;
  await expect.poll(leer).toBe(true);

  // Como estaba.
  await sobrantes.click();
  await expect(sobrantes).not.toBeChecked();
  await expect.poll(leer).toBe(false);
});

for (const rol of ["logistica", "operaciones"] as const) {
  test(`${rol} no ve ni abre la configuración`, async ({ page }) => {
    await entrar(page, rol);
    await expect(page.getByRole("link", { name: "Configuración" })).toHaveCount(0);
    await page.goto("/configuracion");
    await expect(page).toHaveURL(/\/pedidos$/);
  });
}
