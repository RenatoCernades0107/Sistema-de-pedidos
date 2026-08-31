/**
 * Los archivos del pedido: qué deja subir el bucket y qué hace la app con ellos.
 *
 * La primera mitad va directa contra Storage con la sesión de cada rol, sin
 * navegador: lo que se comprueba ahí es el contrato de la base —la RLS y los
 * límites del bucket—, que es lo que sigue en pie aunque la interfaz cambie.
 * La segunda recorre la app como una persona.
 *
 * Todo lo que estas pruebas suben lo borran ellas mismas: el bucket es el de
 * producción y un huérfano ahí no lo ve nadie.
 */

import { expect, test } from "@playwright/test";
import { borrarPedido, crearPedidoDePrueba, entrar, sesionDe } from "./apoyo";

/** Un plano de mentira, pero un PDF de verdad: el bucket mira el tipo. */
const PLANO = "e2e/archivos/plano-e2e.pdf";

/** Un PDF de verdad, del tamaño mínimo que Acrobat acepta abrir. */
const pdf = () => new Blob([Buffer.from("%PDF-1.4\n%%EOF\n")], { type: "application/pdf" });

async function idDe(codigo: string) {
  const supabase = await sesionDe("administracion");
  const { data } = await supabase.from("pedidos").select("id").eq("codigo", codigo).single();
  return data!.id;
}

test.describe("El bucket de adjuntos", () => {
  let codigo: string;
  let pedidoId: string;

  test.beforeAll(async () => {
    codigo = await crearPedidoDePrueba("adjuntos");
    pedidoId = await idDe(codigo);
  });

  test.afterAll(async () => {
    await borrarPedido(codigo);
  });

  test("acepta un PDF de Administración en la carpeta del pedido", async () => {
    const supabase = await sesionDe("administracion");
    const ruta = `pedidos/${pedidoId}/diseno/prueba-admin.pdf`;

    const { error } = await supabase.storage.from("adjuntos").upload(ruta, pdf());
    expect(error).toBeNull();

    await supabase.storage.from("adjuntos").remove([ruta]);
  });

  test("no deja subir a Operaciones", async () => {
    const supabase = await sesionDe("operaciones");
    const ruta = `pedidos/${pedidoId}/diseno/prueba-taller.pdf`;

    const { error } = await supabase.storage.from("adjuntos").upload(ruta, pdf());
    expect(error, "el taller no sube archivos").not.toBeNull();
  });

  /* El tope y la lista de tipos los repite la app para dar un mensaje decente,
     pero quien tiene que cortar de verdad es el bucket: la subida va del navegador
     a Storage sin pasar por el servidor de Next. */
  test("rechaza un tipo que no está en la lista, aunque lo mande Administración", async () => {
    const supabase = await sesionDe("administracion");
    const ruta = `pedidos/${pedidoId}/diseno/prueba.exe`;
    const ejecutable = new Blob([Buffer.from("MZ")], { type: "application/x-msdownload" });

    const { error } = await supabase.storage.from("adjuntos").upload(ruta, ejecutable);
    expect(error, "el bucket solo admite PDF e imágenes").not.toBeNull();

    await supabase.storage.from("adjuntos").remove([ruta]);
  });
});

test.describe("Los archivos en el detalle del pedido", () => {
  let codigo: string;

  test.beforeAll(async () => {
    codigo = await crearPedidoDePrueba("archivos");
  });

  test.afterAll(async () => {
    await borrarPedido(codigo);
  });

  test("Administración sube un archivo, sobrevive a la recarga y se puede borrar", async ({
    page,
  }) => {
    await entrar(page, "administracion");
    await page.goto(`/pedidos/${codigo}`);

    await expect(page.getByText("Sin archivos todavía")).toBeVisible();

    await page.locator('input[type="file"]').setInputFiles(PLANO);

    /* Por el botón y no por el texto: el nombre del archivo sale también en la
       tabla de auditoría, que lo acaba de anotar. */
    const archivo = page.getByRole("button", { name: "Abrir plano-e2e.pdf" });
    await expect(archivo).toBeVisible();

    // La recarga es la prueba: lo optimista se va, lo que quedó en la base no.
    await page.reload();
    await expect(archivo).toBeVisible();

    await page.getByRole("button", { name: "Borrar plano-e2e.pdf" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Borrar" }).click();

    /* Primero que se cierre el diálogo y solo después mirar el archivo, en ese
       orden y no al revés: con el modal abierto el resto de la página sale del
       árbol de accesibilidad, así que `archivo` da cero aunque siga ahí y la
       prueba pasaría sin haber borrado nada. El cierre es además la señal de que
       la acción terminó; recargar antes abortaría el POST a media respuesta. */
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(archivo).toHaveCount(0);

    await page.reload();
    await expect(page.getByText("Sin archivos todavía")).toBeVisible();
  });

  test("Operaciones no tiene por dónde subir", async ({ page }) => {
    await entrar(page, "operaciones");
    await page.goto(`/pedidos/${codigo}`);

    await expect(page.getByText(codigo).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Subir" })).toBeHidden();
  });
});

test.describe("Los archivos al registrar el pedido", () => {
  let codigo: string | null = null;

  test.afterAll(async () => {
    if (codigo) await borrarPedido(codigo);
  });

  /* El pedido todavía no existe cuando se eligen los archivos —no hay uuid, y sin
     uuid no hay carpeta en el bucket—, así que se guardan y se suben en cuanto
     `crear_pedido` devuelve el código. */
  test("los planos elegidos en el alta acaban en el pedido recién creado", async ({ page }) => {
    await entrar(page, "administracion");
    await page.goto("/pedidos/nuevo");

    await page.getByLabel("Nombre del cliente").fill("E2E alta con planos");
    await page.getByLabel("Detalle del pedido").fill("1 Acrílico Alfa 3mm transparente F7");
    await page.getByLabel("Cantidad (unidades)").fill("1");
    await page
      .getByLabel("Fecha prometida")
      .fill(new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
    await page.getByLabel("Monto total").fill("150");

    await page.getByLabel("Elegir archivos de diseño").setInputFiles(PLANO);
    await expect(page.getByText("plano-e2e.pdf")).toBeVisible();

    await page.getByRole("button", { name: "Registrar pedido" }).click();

    await page.waitForURL(/\/pedidos\/[A-Z0-9_]+$/);
    codigo = page.url().split("/").pop()!;

    await expect(page.getByRole("button", { name: "Abrir plano-e2e.pdf" })).toBeVisible();
  });
});
