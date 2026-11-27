import { describe, expect, it } from "vitest";
import { codigoVisible, creadaEnRango } from "./compras";

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
