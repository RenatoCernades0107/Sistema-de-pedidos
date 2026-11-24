import { describe, expect, it } from "vitest";
import type { CalculoCorte } from "./calcular";
import { conPrecioFinal, precioMinimoCorte } from "./precio";
import { CONFIG_CORTES_DEFECTO, leerConfigCortes } from "./config";

const calculo = {
  material: 100,
  servicio: 20,
  total: 120,
  desglose: [
    { etiqueta: "Plancha", monto: 100 },
    { etiqueta: "Corte láser", monto: 20 },
    { etiqueta: "Total", monto: 120, esTotal: true },
  ],
} as unknown as CalculoCorte;

describe("precioMinimoCorte", () => {
  it("resta el porcentaje y redondea al céntimo hacia arriba", () => {
    expect(precioMinimoCorte(120, 5)).toBe(114);
    expect(precioMinimoCorte(33.33, 5)).toBe(31.67);
    expect(precioMinimoCorte(120, 0)).toBe(120);
  });
});

describe("conPrecioFinal", () => {
  it("sin cambio devuelve el mismo cálculo", () => {
    expect(conPrecioFinal(calculo, 120)).toBe(calculo);
  });
  it("sube el precio: el servicio absorbe y el desglose lo explica", () => {
    const c = conPrecioFinal(calculo, 150);
    expect(c.total).toBe(150);
    expect(c.material + c.servicio).toBe(150);
    expect(c.desglose.map((l) => [l.etiqueta, l.monto])).toEqual([
      ["Plancha", 100],
      ["Corte láser", 20],
      ["Ajuste de precio", 30],
      ["Total", 150],
    ]);
  });
  it("baja el precio con ajuste negativo", () => {
    const c = conPrecioFinal(calculo, 114);
    expect(c.desglose.at(-2)).toEqual({ etiqueta: "Ajuste de precio", monto: -6 });
    expect(c.material + c.servicio).toBe(114);
  });
});

describe("descuentoMaxPct en la config", () => {
  it("una config guardada sin el campo cae a 5", () => {
    const cobro: Record<string, unknown> = { ...CONFIG_CORTES_DEFECTO.cobro };
    delete cobro.descuentoMaxPct;
    expect(leerConfigCortes({ cobro }).cobro.descuentoMaxPct).toBe(5);
  });
  it("lee el valor guardado", () => {
    const cobro = { ...CONFIG_CORTES_DEFECTO.cobro, descuentoMaxPct: 10 };
    expect(leerConfigCortes({ cobro }).cobro.descuentoMaxPct).toBe(10);
  });
});
