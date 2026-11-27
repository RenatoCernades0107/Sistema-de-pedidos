import { describe, expect, it } from "vitest";
import { codigoVisible, creadaEnRango, esquemaCorreccionCompra, sePuedeCorregir } from "./compras";

describe("codigoVisible", () => {
  it("muestra la orden de Odoo si existe", () => {
    expect(codigoVisible({ codigo: "CMP-00026", odooOrden: "P01722" })).toBe("P01722");
  });
  it("cae al CMP sin orden", () => {
    expect(codigoVisible({ codigo: "CMP-00026", odooOrden: null })).toBe("CMP-00026");
    expect(codigoVisible({ codigo: "CMP-00026", odooOrden: " " })).toBe("CMP-00026");
  });
});

describe("creadaEnRango", () => {
  const t = "2026-11-26T15:00:00Z"; // 26 en Lima
  it("sin límites deja pasar todo", () => {
    expect(creadaEnRango(t, "", "")).toBe(true);
  });
  it("límites inclusivos", () => {
    expect(creadaEnRango(t, "2026-11-26", "2026-11-26")).toBe(true);
    expect(creadaEnRango(t, "2026-11-27", "")).toBe(false);
    expect(creadaEnRango(t, "", "2026-11-25")).toBe(false);
  });
  it("solo desde / solo hasta", () => {
    expect(creadaEnRango(t, "2026-11-01", "")).toBe(true);
    expect(creadaEnRango(t, "", "2026-12-01")).toBe(true);
  });
  it("usa el día de Lima, no el de UTC", () => {
    const tarde = "2026-11-27T03:00:00Z"; // 26 22:00 en Lima
    expect(creadaEnRango(tarde, "", "2026-11-26")).toBe(true);
    expect(creadaEnRango(tarde, "2026-11-27", "")).toBe(false);
  });
});

describe("esquemaCorreccionCompra", () => {
  const base = { compraId: "5c3d4e5f-1a2b-4c3d-8e9f-0a1b2c3d4e5f", incoterm: null, condicionPago: "contado", diasCredito: null, fechaEmbarque: null, kilos: [] };
  const mensajes = (v: object) => esquemaCorreccionCompra.safeParse({ ...base, ...v }).error?.issues.map((i) => i.message).join(" ") ?? "";

  it("acepta una compra nacional y una importación con incoterm", () => {
    expect(esquemaCorreccionCompra.safeParse({ ...base, tipo: "nacional" }).success).toBe(true);
    expect(esquemaCorreccionCompra.safeParse({ ...base, tipo: "importacion", incoterm: "FOB", condicionPago: "adelantado" }).success).toBe(true);
  });

  it.each([
    ["nacional con incoterm", { tipo: "nacional", incoterm: "FOB" }, /no lleva incoterm/],
    ["importación sin incoterm", { tipo: "importacion", condicionPago: "adelantado" }, /FOB o CIF/],
    ["importación al contado", { tipo: "importacion", incoterm: "CIF" }, /Al contado/],
    ["nacional adelantada", { tipo: "nacional", condicionPago: "adelantado" }, /Adelantado/],
    ["crédito sin días", { tipo: "nacional", condicionPago: "credito" }, /días de crédito/],
  ])("rechaza %s", (_n, cambios, mensaje) => {
    expect(mensajes(cambios)).toMatch(mensaje);
  });

  it("valida los kilos por ítem: positivos, sin repetir, o vacíos para quitarlos", () => {
    expect(esquemaCorreccionCompra.safeParse({ ...base, tipo: "nacional", kilos: [{ posicion: 1, kilos: 244.5 }, { posicion: 2, kilos: null }] }).success).toBe(true);
    expect(mensajes({ tipo: "nacional", kilos: [{ posicion: 1, kilos: 0 }] })).toMatch(/mayores que cero/);
    expect(mensajes({ tipo: "nacional", kilos: [{ posicion: 1, kilos: 5 }, { posicion: 1, kilos: 6 }] })).toMatch(/dos veces/);
  });

  it("solo se corrige con la compra confirmada y sin liquidar", () => {
    expect(["confirmada", "recibida_parcial", "recibida"].every((e) => sePuedeCorregir(e as never))).toBe(true);
    expect(["borrador", "liquidada", "anulada"].some((e) => sePuedeCorregir(e as never))).toBe(false);
  });
});
