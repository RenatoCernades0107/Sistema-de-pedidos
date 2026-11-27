import { describe, expect, it } from "vitest";
import { CONFIG_COSTOS_POR_DEFECTO } from "./costeo";
import { serieDeCostos, serieDeMargen, serieDePlancha, type FilaGrafico, type SeriesHistoricas } from "./costos-grafico";

const config = { ...CONFIG_COSTOS_POR_DEFECTO, mesesPromedio: 1 };
const hoy = "2026-11-27";
const a: FilaGrafico = { productoId: 1, codigo: "A", precio: 236, kgPorPlancha: 10, areaM2: 2 };
const b: FilaGrafico = { productoId: 2, codigo: "B", precio: null, kgPorPlancha: null, areaM2: 3 };
const s: SeriesHistoricas = {
  costos: {
    1: [
      { fecha: "2026-08-10", costo: 100 },
      { fecha: "2026-10-05", costo: 120 },
    ],
    2: [{ fecha: "2026-09-01", costo: 300 }],
  },
  precios: { 1: [{ fecha: "2026-08-15", precio: 177 }] },
};
// La tasa de octubre sale de septiembre: 10%.
const meses = [{ mes: "2026-09", gastos: 1000, base: 10_000 }];

describe("serieDePlancha", () => {
  it("escalonada: cada costo y precio vale hasta el siguiente; el precio va sin IGV", () => {
    const f = serieDePlancha(a, s, meses, config, hoy);
    expect(f.map((x) => x.fecha)).toEqual(["2026-08-10", "2026-08-15", "2026-10-05", hoy]);
    expect(f[0]).toEqual({ fecha: "2026-08-10", primer: 100, segundo: 100, precio: null });
    expect(f[1]).toEqual({ fecha: "2026-08-15", primer: 100, segundo: 100, precio: 150 });
    // En octubre el 2do costo suma el 10% de los gastos de operar.
    expect(f[2]).toEqual({ fecha: "2026-10-05", primer: 120, segundo: 132, precio: 150 });
    // Hoy, el precio de Odoo.
    expect(f[3]).toMatchObject({ precio: 200, segundo: 132 });
  });
});

describe("serieDeCostos", () => {
  it("por kg o por m²; sin kilos, la plancha no tiene valor por kg", () => {
    const kg = serieDeCostos([a, b], s, "kg", hoy);
    expect(kg.find((x) => x.fecha === "2026-10-05")).toEqual({ fecha: "2026-10-05", A: 12, B: null });
    const m2 = serieDeCostos([a, b], s, "m2", hoy);
    expect(m2.find((x) => x.fecha === "2026-10-05")).toEqual({ fecha: "2026-10-05", A: 60, B: 100 });
  });
});

describe("serieDeMargen", () => {
  it("precio sin IGV contra el 2do costo, solo donde se conocen los dos", () => {
    const m = serieDeMargen([a, b], s, meses, config, hoy);
    expect(m[0]).toEqual({ fecha: "2026-08-15", A: 33.3, B: null });
    expect(m.find((x) => x.fecha === hoy)).toEqual({ fecha: hoy, A: 34, B: null });
  });
});
