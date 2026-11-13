import { describe, expect, it } from "vitest";
import {
  acomodar,
  acomodarEnFormato,
  aPlanchasMotor,
  formatosDeGrupo,
  piezasQueNoEntran,
  problemaDeEspesor,
} from "./acomodo";
import type { PiezaCad } from "./tipos";

const pieza = (id: string, ancho: number, alto: number, cantidad = 1, espesor = 3): PiezaCad => ({
  id,
  nombre: id,
  cantidad,
  espesor_mm: espesor,
  ancho_mm: ancho,
  alto_mm: alto,
  area_mm2: ancho * alto,
  perimetro_mm: 2 * (ancho + alto),
});

const F1 = { id: "f1", anchoMm: 1000, altoMm: 500 };

describe("formatosDeGrupo", () => {
  it("pasa de cm a mm y deja fuera los inactivos", () => {
    const f = formatosDeGrupo({
      formatos: [
        { id: "a", codigo: "A", anchoCm: 122, largoCm: 183, skuCompartido: false, porVerificar: false, nota: null, activo: true },
        { id: "b", codigo: "B", anchoCm: 100, largoCm: 100, skuCompartido: false, porVerificar: false, nota: null, activo: false },
      ],
    });
    expect(f).toEqual([{ id: "a", anchoMm: 1220, altoMm: 1830 }]);
  });
});

describe("piezasQueNoEntran", () => {
  it("solo considera girar si el grupo es rotable", () => {
    const larga = pieza("larga", 400, 900);
    expect(piezasQueNoEntran([larga], [F1], { rotable: true })).toEqual([]);
    expect(piezasQueNoEntran([larga], [F1], { rotable: false })).toEqual([larga]);
  });
});

describe("acomodarEnFormato", () => {
  it("coloca cada copia una vez, sin solaparse y dentro de la plancha", () => {
    const r = acomodarEnFormato([pieza("a", 300, 200, 4), pieza("b", 450, 450)], F1, {
      rotable: true,
      kerfMm: 2,
    });
    const todas = r.planchas.flatMap((p) => p.piezas);
    expect(todas.map((c) => `${c.id}${c.indice}`).sort()).toEqual(["a1", "a2", "a3", "a4", "b1"]);
    expect(r.noCaben).toEqual([]);
    for (const p of r.planchas) {
      for (const c of p.piezas) {
        expect(c.xMm + c.anchoMm).toBeLessThanOrEqual(p.anchoMm + 1e-6);
        expect(c.yMm + c.altoMm).toBeLessThanOrEqual(p.altoMm + 1e-6);
      }
      for (let i = 0; i < p.piezas.length; i++)
        for (let j = i + 1; j < p.piezas.length; j++) {
          const a = p.piezas[i];
          const b = p.piezas[j];
          const separadas =
            a.xMm + a.anchoMm <= b.xMm || b.xMm + b.anchoMm <= a.xMm || a.yMm + a.altoMm <= b.yMm || b.yMm + b.altoMm <= a.yMm;
          expect(separadas).toBe(true);
        }
    }
    const area = 4 * 300 * 200 + 450 * 450;
    expect(r.areaPiezasMm2).toBeCloseTo(area);
    expect(r.mermaPct).toBeCloseTo((1 - area / r.areaPlanchasMm2) * 100);
  });

  it("dice qué copias no caben", () => {
    const r = acomodarEnFormato([pieza("x", 400, 900, 2)], F1, { rotable: false });
    expect(r.noCaben).toEqual([
      { id: "x", indice: 1 },
      { id: "x", indice: 2 },
    ]);
  });

  it("gira la pieza si hace falta y lo marca", () => {
    const r = acomodarEnFormato([pieza("larga", 400, 900)], F1, { rotable: true });
    const c = r.planchas[0].piezas[0];
    expect(c.rotada).toBe(true);
    expect([c.anchoMm, c.altoMm]).toEqual([900, 400]);
  });
});

describe("acomodar", () => {
  it("prefiere el formato que gasta menos plancha", () => {
    const chico = { id: "chico", anchoMm: 500, altoMm: 500 };
    const r = acomodar([pieza("a", 200, 200)], [F1, chico], { rotable: true });
    expect(r?.formatoId).toBe("chico");
    expect(acomodar([pieza("a", 1, 1)], [], { rotable: true })).toBeNull();
  });
});

describe("aPlanchasMotor", () => {
  it("pasa a origen abajo a la izquierda", () => {
    const r = acomodarEnFormato([pieza("a", 300, 200)], F1, { rotable: false });
    const [p] = aPlanchasMotor(r);
    const c = r.planchas[0].piezas[0];
    expect(p.piezas[0]).toEqual({ id: "a", indice: 1, x_mm: c.xMm, y_mm: 500 - c.yMm - 200, rotada: false });
  });
});

describe("problemaDeEspesor", () => {
  it("avisa si el parámetro o las piezas no son del espesor de la plancha", () => {
    expect(problemaDeEspesor({ espesor: 3 }, [pieza("a", 1, 1)], { espesorMm: 3 })).toBeNull();
    expect(problemaDeEspesor({ espesor: 5 }, [], { espesorMm: 3 })).toMatch(/5 mm/);
    expect(problemaDeEspesor({}, [pieza("a", 1, 1, 1, 8)], { espesorMm: 3 })).toMatch(/8 mm/);
  });
});
