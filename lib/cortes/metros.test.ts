import { describe, expect, it } from "vitest";
import { calcularCorte } from "./calcular";
import { CONFIG_CORTES_DEFECTO } from "./config";
import { cortesManuales, largoTotal, type PlanchaParaCortes } from "./metros";
import type { Panel } from "./optimizador";

/** Una plancha de 122×183 armada a mano: [x, y, ancho, alto] por pieza. */
const plancha = (piezas: [number, number, number, number][], cobro = { factor: 1, ancho: 122, alto: 183 }) =>
  ({
    ancho: 122,
    alto: 183,
    cobro,
    paneles: piezas.map(([x, y, w, h], i): Panel => ({
      x1: x,
      y1: y,
      x2: x + w,
      y2: y + h,
      libre: false,
      piezaId: `f1#${i + 1}`,
    })),
  }) satisfies PlanchaParaCortes;

const grilla = (cols: number, filas: number, w: number, h: number) => {
  const salida: [number, number, number, number][] = [];
  for (let f = 0; f < filas; f++) for (let c = 0; c < cols; c++) salida.push([c * w, f * h, w, h]);
  return salida;
};

describe("los cortes de cutter del ejemplo 6", () => {
  it("plancha 1: cuatro de 61×91.5, tres cortes y 3.05 m", () => {
    const c = cortesManuales(plancha(grilla(2, 2, 61, 91.5)));
    expect(c).toHaveLength(3);
    expect(largoTotal(c)).toBeCloseTo(305);
  });

  it("plancha 3: veinticuatro de 30.5, 23 cortes y 11.59 m", () => {
    const c = cortesManuales(plancha(grilla(4, 6, 30.5, 30.5)));
    expect(c).toHaveLength(23);
    expect(largoTotal(c)).toBeCloseTo(1159);
  });

  it("plancha 4: dos mitades, un corte de 1.22 m", () => {
    const c = cortesManuales(plancha(grilla(1, 2, 122, 91.5)));
    expect(c).toEqual([{ n: 1, x1: 0, y1: 91.5, x2: 122, y2: 91.5, largo: 122 }]);
  });

  it("plancha 5: ocho cortes y 5.91 m, el primero de lado a lado", () => {
    const c = cortesManuales(
      plancha([
        [0, 0, 61, 61],
        [61, 0, 61, 61],
        [0, 61, 40, 61],
        [40, 61, 40, 61],
        [0, 122, 40, 61],
        [40, 122, 40, 61],
        [80, 61, 42, 70],
        [80, 131, 42, 30],
      ]),
    );
    expect(c).toHaveLength(8);
    expect(largoTotal(c)).toBeCloseTo(591);
    expect(c[0]).toMatchObject({ x1: 0, y1: 61, x2: 122, y2: 61 });
    // El sobrante de 42×22 de abajo también se corta.
    expect(c.some((x) => x.y1 === 161 && x.y2 === 161 && x.largo === 42)).toBe(true);
  });

  it("plancha 8: el corte que suelta el sobrante va de canto a canto (3.55 m, no 3.03)", () => {
    const c = cortesManuales(
      plancha([
        [0, 0, 61, 61],
        [61, 0, 61, 61],
        [0, 61, 50, 70],
      ]),
    );
    expect(c).toHaveLength(4);
    expect(largoTotal(c)).toBeCloseTo(355);
  });

  it("los números van en orden, desde 1", () => {
    const c = cortesManuales(plancha(grilla(3, 3, 40, 61)));
    expect(c.map((x) => x.n)).toEqual(c.map((_, i) => i + 1));
  });
});

describe("casos de borde", () => {
  it("una pieza que ocupa toda la plancha no lleva cortes", () => {
    expect(cortesManuales(plancha([[0, 0, 122, 183]]))).toEqual([]);
  });

  it("una fracción empieza separando lo que se cobra", () => {
    const c = cortesManuales(plancha([[0, 0, 61, 91.5]], { factor: 0.25, ancho: 61, alto: 91.5 }));
    expect(c[0]).toMatchObject({ x1: 61, y1: 0, x2: 61, y2: 183, largo: 183 });
    expect(c[1]).toMatchObject({
      x1: 0,
      y1: 91.5,
      x2: 61,
      y2: 91.5,
      largo: 61,
    });
    expect(c).toHaveLength(2);
  });

  it("el hueco del kerf entre dos piezas es un solo corte", () => {
    const c = cortesManuales(
      plancha([
        [0, 0, 60.8, 183],
        [61.2, 0, 60.8, 183],
      ]),
      { kerf: 0.4 },
    );
    expect(c).toHaveLength(1);
  });

  it("muchas piezas no se cuelgan y salen enteras", () => {
    const c = cortesManuales(plancha(grilla(12, 18, 10, 10)));
    // 216 piezas de 10×10 en una grilla de 120×180, con dos franjas de sobrante.
    expect(c.length).toBeGreaterThanOrEqual(215);
    // Al menos las líneas interiores de la grilla y los dos recortes.
    expect(largoTotal(c)).toBeGreaterThanOrEqual(11 * 180 + 17 * 120 + 183 + 120 - 1e-6);
  });

  it("el cálculo del corte manual cobra los metros", () => {
    const r = calcularCorte(
      {
        piezas: [{ ancho: 61, alto: 91.5, cantidad: 4 }],
        espesorMm: 3,
        modalidad: "manual",
        rotable: true,
      },
      { codigo: "X", ancho: 122, alto: 183, precio: 100 },
      {
        ...CONFIG_CORTES_DEFECTO,
        cobro: { ...CONFIG_CORTES_DEFECTO.cobro, redondearAlSol: false },
      },
    );
    expect(r.metrosManual).toBeCloseTo(3.05);
    // 3.05 m × S/ 4
    expect(r.servicio).toBeCloseTo(12.2);
  });
});
