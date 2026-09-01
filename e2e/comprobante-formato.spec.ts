/**
 * El formato del comprobante, sin navegador.
 *
 * El patrón está en tres sitios que tienen que coincidir: el CHECK
 * `pedidos_comprobante_formato`, el esquema del formulario y el de la Server Action.
 * La base rechaza lo malo, pero el mensaje que lee quien teclea sale de Zod, así que
 * se comprueba por aquí.
 *
 * La numeración es la de la SUNAT: `F` factura, `B` boleta, serie de 3 dígitos y
 * correlativo de hasta 8.
 */

import { expect, test } from "@playwright/test";
import { FORMATO_COMPROBANTE, esquemaFormEstado } from "@/lib/esquemas";
import { etiquetaComprobante, tipoComprobante } from "@/lib/dominio";

const VALIDOS = [
  "F001-004512", // la factura de siempre
  "F010-004512", // otra serie
  "B001-004512", // boleta
  "B010-000001",
  "B010-1", // correlativo sin ceros a la izquierda
  "F001-00004512", // correlativo de 8
];

const INVALIDOS = [
  "F001-000045123", // correlativo de 9
  "FF01-004512", // serie con letra
  "F0011-004512", // serie de 4
  "f001-004512", // minúscula
  "X001-004512", // ni factura ni boleta
  "F001-", // sin correlativo
  "F001004512", // sin guion
  "F001-004512 ", // espacio al final
];

test.describe("FORMATO_COMPROBANTE", () => {
  for (const valor of VALIDOS) {
    test(`acepta ${valor}`, () => {
      expect(FORMATO_COMPROBANTE.regex.test(valor)).toBe(true);
    });
  }

  for (const valor of INVALIDOS) {
    test(`rechaza ${valor || "(vacío)"}`, () => {
      expect(FORMATO_COMPROBANTE.regex.test(valor)).toBe(false);
    });
  }
});

test.describe("esquemaFormEstado", () => {
  test("deja pasar el vacío inicial del formulario", () => {
    // Sin esto el diálogo no llegaría a enviarse nunca: el valor por defecto es "".
    expect(esquemaFormEstado.safeParse({ motivo: "", numeroComprobante: "" }).success).toBe(true);
  });

  test("acepta una boleta", () => {
    expect(esquemaFormEstado.safeParse({ numeroComprobante: "B001-000318" }).success).toBe(true);
  });

  test("rechaza una serie con letra y explica el formato", () => {
    const r = esquemaFormEstado.safeParse({ numeroComprobante: "FF01-004512" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toContain("B001-004512");
  });

  test("recorta los espacios antes de validar", () => {
    const r = esquemaFormEstado.safeParse({ numeroComprobante: "  F001-004512  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.numeroComprobante).toBe("F001-004512");
  });
});

test.describe("tipoComprobante", () => {
  test("distingue boleta de factura por el prefijo", () => {
    expect(tipoComprobante("B001-000318")).toBe("boleta");
    expect(tipoComprobante("F001-004512")).toBe("factura");
  });

  test("etiqueta el número con su tipo", () => {
    expect(etiquetaComprobante("B001-000318")).toBe("Boleta B001-000318");
    expect(etiquetaComprobante("F001-004512")).toBe("Factura F001-004512");
  });
});
