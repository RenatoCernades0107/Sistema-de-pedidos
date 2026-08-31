/**
 * Las reglas de archivo, sin navegador.
 *
 * Viven en `lib/adjuntos.ts` porque las corren los dos lados: el formulario para
 * avisar antes de subir nada, y la Server Action porque un POST a mano no pasa por
 * el formulario. Una sola definición, comprobada aquí.
 */

import { expect, test } from "@playwright/test";
import { MAX_BYTES, nombreSeguro, rutaAdjunto, validarArchivo } from "@/lib/adjuntos";

const archivo = (nombre: string, type: string, size: number) => ({ name: nombre, type, size });

test.describe("validarArchivo", () => {
  test("acepta un PDF dentro del tope", () => {
    expect(validarArchivo(archivo("plano.pdf", "application/pdf", 1_000_000))).toBeNull();
  });

  test("acepta una foto de celular", () => {
    expect(validarArchivo(archivo("entrega.jpg", "image/jpeg", 3_000_000))).toBeNull();
  });

  test("rechaza un tipo que no está en la lista", () => {
    expect(validarArchivo(archivo("virus.exe", "application/x-msdownload", 1000)))
      .toContain("PDF");
  });

  test("rechaza un archivo más grande que el tope", () => {
    expect(validarArchivo(archivo("plano.pdf", "application/pdf", MAX_BYTES + 1)))
      .toContain("10 MB");
  });

  test("rechaza un archivo vacío", () => {
    expect(validarArchivo(archivo("plano.pdf", "application/pdf", 0))).toContain("vacío");
  });
});

test.describe("rutaAdjunto", () => {
  /* La política `adjuntos_storage_lectura` mira `(storage.foldername(name))[3]`
     para esconderle la factura al taller. Si el tipo deja de ser el tercer
     segmento, Operaciones ve todo y nada falla a gritos. */
  test("deja el tipo en el tercer segmento, que es el que lee la RLS", () => {
    const ruta = rutaAdjunto("11111111-2222-3333-4444-555555555555", "factura", "f001.pdf");
    expect(ruta.split("/").slice(0, 3)).toEqual([
      "pedidos",
      "11111111-2222-3333-4444-555555555555",
      "factura",
    ]);
  });

  test("dos archivos del mismo nombre no chocan en el bucket", () => {
    const uno = rutaAdjunto("abc", "diseno", "plano.pdf");
    const otro = rutaAdjunto("abc", "diseno", "plano.pdf");
    expect(uno).not.toEqual(otro);
  });

  test("conserva la extensión para que el navegador sepa qué abrir", () => {
    expect(rutaAdjunto("abc", "diseno", "plano.pdf")).toMatch(/\.pdf$/);
  });
});

test.describe("nombreSeguro", () => {
  test("no deja escapar de la carpeta del pedido", () => {
    const nombre = nombreSeguro("../../otro-pedido/factura.pdf");
    expect(nombre).not.toContain("/");
    expect(nombre).not.toContain("..");
  });

  test("cambia acentos y espacios por caracteres que el bucket admite", () => {
    expect(nombreSeguro("diseño final (v2).pdf")).toBe("diseno-final-v2.pdf");
  });
});
