import { describe, expect, it } from "vitest";
import { tiposDeLineas } from "./dominio";
import { FORMATO_CODIGO } from "./esquemas";

describe("tiposDeLineas", () => {
  it("un corte láser es CL y uno manual CM", () => {
    expect(tiposDeLineas([{ corte: { modalidad: "laser" } }])).toEqual(["CL"]);
    expect(tiposDeLineas([{ corte: { modalidad: "manual" } }])).toEqual(["CM"]);
  });

  it("un producto terminado es PT y un producto de Odoo tal cual, SP", () => {
    expect(tiposDeLineas([{ terminado: {} }])).toEqual(["PT"]);
    expect(tiposDeLineas([{}])).toEqual(["SP"]);
  });

  it("combina sin repetir y siempre en el mismo orden", () => {
    expect(
      tiposDeLineas([{ terminado: {} }, {}, { corte: { modalidad: "laser" } }, { corte: { modalidad: "laser" } }]),
    ).toEqual(["CL", "SP", "PT"]);
  });
});

describe("FORMATO_CODIGO", () => {
  it("acepta el código nuevo y el de los pedidos anteriores", () => {
    expect(FORMATO_CODIGO.test("P2611-001")).toBe(true);
    expect(FORMATO_CODIGO.test("P2611-999")).toBe(true);
    expect(FORMATO_CODIGO.test("LCL_2026_H4TP")).toBe(true);
    expect(FORMATO_CODIGO.test("PMX_2026_H4TP")).toBe(true);
  });

  it("rechaza lo que no es un código", () => {
    expect(FORMATO_CODIGO.test("P2611-1000")).toBe(false);
    expect(FORMATO_CODIGO.test("P2611-01")).toBe(false);
    expect(FORMATO_CODIGO.test("p2611-001")).toBe(false);
  });
});
