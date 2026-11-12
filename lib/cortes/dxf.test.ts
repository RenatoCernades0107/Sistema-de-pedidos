import { describe, expect, it } from "vitest";
import { calcularCorte, type FormatoCorte } from "./calcular";
import { CONFIG_CORTES_DEFECTO } from "./config";
import { compensacion, exportarDxf, lineasDePlancha, nombreArchivoDxf, type PlanchaParaDxf } from "./dxf";
import type { Panel } from "./optimizador";

const entera = { factor: 1, ancho: 100, alto: 100 };
const pieza = (id: string, x1: number, y1: number, x2: number, y2: number): Panel => ({
  x1,
  y1,
  x2,
  y2,
  libre: false,
  piezaId: id,
});

/** Las LINE del DXF, en mm y por capa. */
function lineasDxf(dxf: string) {
  const t = dxf.split("\r\n");
  const salida: { capa: string; color: number; x1: number; y1: number; x2: number; y2: number }[] = [];
  let enEntidades = false;
  for (let i = 0; i + 1 < t.length; i += 2) {
    const [codigo, valor] = [t[i].trim(), t[i + 1]];
    if (codigo === "2" && valor === "ENTITIES") enEntidades = true;
    if (!enEntidades || codigo !== "0" || valor !== "LINE") continue;
    const campos = new Map<string, string>();
    for (let j = i + 2; j + 1 < t.length && t[j].trim() !== "0"; j += 2) campos.set(t[j].trim(), t[j + 1]);
    salida.push({
      capa: campos.get("8")!,
      color: Number(campos.get("62")),
      x1: Number(campos.get("10")),
      y1: Number(campos.get("20")),
      x2: Number(campos.get("11")),
      y2: Number(campos.get("21")),
    });
  }
  return salida;
}

const largo = (l: { x1: number; y1: number; x2: number; y2: number }) => Math.hypot(l.x2 - l.x1, l.y2 - l.y1);
const capa = (dxf: string, nombre: string) => lineasDxf(dxf).filter((l) => l.capa === nombre);

describe("el DXF para RDWorks", () => {
  it("va en milímetros, en R12, con una capa y un color por cosa", () => {
    const dxf = exportarDxf([{ ancho: 100, alto: 100, paneles: [], cobro: entera }]);
    expect(dxf).toMatch(/\$INSUNITS\r\n 70\r\n4\r\n/);
    expect(dxf).toMatch(/\$ACADVER\r\n  1\r\nAC1009\r\n/);
    for (const c of ["CORTE", "GRABADO", "PRIMER_CORTE", "PLANCHA"]) expect(dxf).toContain(`\r\n${c}\r\n`);
    expect(dxf.trimEnd().endsWith("EOF")).toBe(true);
  });

  it("una pieza de 10×20 cm se corta con 600 mm de línea, en rojo", () => {
    const dxf = exportarDxf([{ ancho: 100, alto: 100, paneles: [pieza("f1#1", 5, 5, 15, 25)], cobro: entera }]);
    const corte = capa(dxf, "CORTE");
    expect(corte).toHaveLength(4);
    expect(corte.every((l) => l.color === 1)).toBe(true);
    expect(corte.reduce((s, l) => s + largo(l), 0)).toBeCloseTo(600, 6);
  });

  it("la plancha va de referencia en su capa: 100×100 cm son 1000×1000 mm", () => {
    const dxf = exportarDxf([{ ancho: 100, alto: 50, paneles: [], cobro: entera }]);
    const borde = capa(dxf, "PLANCHA");
    expect(borde.reduce((s, l) => s + largo(l), 0)).toBeCloseTo(2 * (1000 + 500), 6);
  });

  it("la y va hacia arriba: lo que está arriba en el plano sigue arriba", () => {
    const dxf = exportarDxf([{ ancho: 100, alto: 100, paneles: [pieza("f1#1", 10, 0, 20, 10)], cobro: entera }]);
    // La pieza toca el canto de arriba (y = 0 en el plano): su borde de abajo queda a 900 mm.
    const ys = capa(dxf, "CORTE").flatMap((l) => [l.y1, l.y2]);
    expect(Math.min(...ys)).toBe(900);
    expect(Math.max(...ys)).toBe(1000);
  });

  it("un borde que comparten dos piezas se corta una sola vez", () => {
    const p: PlanchaParaDxf = {
      ancho: 100,
      alto: 100,
      paneles: [pieza("f1#1", 10, 10, 30, 20), pieza("f1#2", 30, 10, 50, 20)],
      cobro: entera,
    };
    const corte = capa(exportarDxf([p]), "CORTE");
    const enMedio = corte.filter((l) => l.x1 === 300 && l.x2 === 300);
    expect(enMedio).toHaveLength(1);
    // Los de arriba y abajo se juntan en una sola línea de 400 mm cada uno.
    expect(corte.filter((l) => l.y1 === l.y2).map(largo)).toEqual([400, 400]);
    expect(corte.reduce((s, l) => s + largo(l), 0)).toBeCloseTo(2 * 400 + 3 * 100, 6);
  });

  it("lo que cae sobre el canto de la plancha no se corta", () => {
    const p: PlanchaParaDxf = { ancho: 100, alto: 100, paneles: [pieza("f1#1", 0, 0, 50, 100)], cobro: entera };
    const corte = capa(exportarDxf([p]), "CORTE");
    expect(corte).toHaveLength(1);
    expect(corte[0]).toMatchObject({ x1: 500, x2: 500 });
    expect([corte[0].y1, corte[0].y2].sort((a, b) => a - b)).toEqual([0, 1000]);
  });

  it("con varias planchas, cada una va a la derecha de la anterior, separadas 50 mm", () => {
    const p: PlanchaParaDxf = { ancho: 100, alto: 100, paneles: [], cobro: entera };
    const borde = capa(exportarDxf([p, p]), "PLANCHA");
    const xs = borde.flatMap((l) => [l.x1, l.x2]);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(2050);
    expect(xs).toContain(1050);
  });

  it("con media plancha cobrada, el primer corte separa lo que vuelve al almacén", () => {
    const p: PlanchaParaDxf = {
      ancho: 100,
      alto: 200,
      paneles: [
        pieza("f1#1", 0, 0, 100, 100),
        { x1: 0, y1: 100, x2: 100, y2: 200, libre: true, sobrante: true },
      ],
      cobro: { factor: 0.5, ancho: 100, alto: 100 },
    };
    const dxf = exportarDxf([p]);
    const primero = capa(dxf, "PRIMER_CORTE");
    expect(primero).toHaveLength(1);
    expect(primero[0]).toMatchObject({ x1: 0, x2: 1000, y1: 1000, y2: 1000, color: 5 });
    // La pieza termina justo en esa línea: no se corta dos veces.
    expect(capa(dxf, "CORTE")).toHaveLength(0);
  });

  it("graba el número de la fila con trazos dentro de la pieza", () => {
    const dxf = exportarDxf([{ ancho: 100, alto: 100, paneles: [pieza("f8#1", 10, 10, 30, 30)], cobro: entera }]);
    const grabado = capa(dxf, "GRABADO");
    expect(grabado).toHaveLength(7); // el 8 lleva los siete segmentos
    for (const l of grabado) {
      for (const [x, y] of [
        [l.x1, l.y1],
        [l.x2, l.y2],
      ]) {
        expect(x).toBeGreaterThan(100);
        expect(x).toBeLessThan(300);
        expect(y).toBeGreaterThan(700);
        expect(y).toBeLessThan(900);
      }
    }
  });

  it("en una pieza donde el número no se leería, no se graba", () => {
    const dxf = exportarDxf([{ ancho: 100, alto: 100, paneles: [pieza("f1#1", 10, 10, 10.5, 10.5)], cobro: entera }]);
    expect(capa(dxf, "GRABADO")).toHaveLength(0);
  });
});

describe("la compensación del kerf", () => {
  it("corre el contorno medio kerf hacia afuera: la pieza sale a su medida", () => {
    const p: PlanchaParaDxf = { ancho: 100, alto: 100, paneles: [pieza("f1#1", 10, 10, 20, 20)], cobro: entera };
    const corte = capa(exportarDxf([p], { kerfCm: 0.02 }), "CORTE");
    const xs = corte.flatMap((l) => [l.x1, l.x2]);
    expect(Math.min(...xs)).toBeCloseTo(99.9, 6);
    expect(Math.max(...xs)).toBeCloseTo(200.1, 6);
  });

  it("dos piezas separadas por un kerf comparten la línea del medio", () => {
    const p: PlanchaParaDxf = {
      ancho: 100,
      alto: 100,
      paneles: [pieza("f1#1", 10, 10, 20, 20), pieza("f1#2", 20.02, 10, 30.02, 20)],
      cobro: entera,
    };
    const corte = capa(exportarDxf([p], { kerfCm: 0.02 }), "CORTE");
    expect(corte.filter((l) => l.x1 === l.x2 && Math.abs(l.x1 - 200.1) < 1e-6)).toHaveLength(1);
  });

  it("nunca pisa a la vecina: con piezas pegadas, no compensa", () => {
    const cajas = [
      { x1: 0, y1: 0, x2: 100, y2: 100 },
      { x1: 100, y1: 0, x2: 200, y2: 100 },
    ];
    expect(compensacion(cajas, 2000)).toBe(0);
    expect(compensacion([cajas[0], { ...cajas[1], x1: 110, x2: 210 }], 2000)).toBe(5);
    expect(compensacion([cajas[0]], 2000)).toBe(1000);
  });
});

describe("un corte calculado de verdad", () => {
  const F7: FormatoCorte = { codigo: "F7E024", ancho: 122, alto: 183, precio: 200 };
  const calculo = calcularCorte(
    { piezas: [{ ancho: 60, alto: 80, cantidad: 10 }], espesorMm: 3, modalidad: "laser", rotable: true },
    F7,
    CONFIG_CORTES_DEFECTO,
  );

  it("cada pieza queda encerrada por líneas de corte y lleva su número", () => {
    const dxf = exportarDxf(calculo.planchas);
    expect(capa(dxf, "GRABADO").length).toBeGreaterThan(0);
    expect(capa(dxf, "PLANCHA")).toHaveLength(4 * calculo.planchas.length);
    // Ninguna línea de corte sale de su plancha.
    let ox = 0;
    const tramos = calculo.planchas.map((p) => {
      const t = [ox, ox + p.ancho * 10];
      ox += p.ancho * 10 + 50;
      return t;
    });
    for (const l of capa(dxf, "CORTE")) {
      expect(tramos.some(([a, b]) => l.x1 >= a && l.x2 <= b)).toBe(true);
    }
  });

  it("las líneas son las mismas que se prueban aparte", () => {
    const total = calculo.planchas.reduce((s, p) => s + lineasDePlancha(p).length, 0);
    expect(lineasDxf(exportarDxf(calculo.planchas))).toHaveLength(total);
  });
});

describe("el nombre del archivo", () => {
  it("solo letras, números y guiones", () => {
    expect(nombreArchivoDxf(["P-0012", "Acrílico ECO", "Cristal", "3 mm"])).toBe("p-0012-acrilico-eco-cristal-3-mm.dxf");
    expect(nombreArchivoDxf([null, ""])).toBe("corte.dxf");
  });
});
