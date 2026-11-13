import { describe, expect, it } from "vitest";
import { CONFIG_CORTES_DEFECTO } from "@/lib/cortes/config";
import { tiempoLaser, tiempoLaserPorPerimetro } from "@/lib/cortes/laser";
import { acomodar, formatosDeGrupo } from "./acomodo";
import { costoDiseno } from "./costo";
import type { PiezaCad } from "./tipos";

const config = CONFIG_CORTES_DEFECTO;

const pieza = (
  id: string,
  ancho: number,
  alto: number,
  cantidad = 1,
  perimetro = 2 * (ancho + alto),
): PiezaCad => ({
  id,
  nombre: id,
  cantidad,
  espesor_mm: 3,
  ancho_mm: ancho,
  alto_mm: alto,
  area_mm2: ancho * alto,
  perimetro_mm: perimetro,
});

const grupo = {
  espesorMm: 3,
  rotable: true,
  formatos: [
    {
      id: "f",
      codigo: "F20E001",
      anchoCm: 305,
      largoCm: 205,
      skuCompartido: false,
      porVerificar: false,
      nota: null,
      activo: true,
    },
  ],
};

describe("tiempoLaserPorPerimetro", () => {
  it("con el perímetro de un rectángulo da lo mismo que tiempoLaser", () => {
    const a = tiempoLaser(
      [{ ancho: 10, alto: 5, cantidad: 3 }],
      3,
      config.laser,
    );
    const b = tiempoLaserPorPerimetro(
      [{ perimetroMm: 300, cantidad: 3 }],
      3,
      config.laser,
    );
    expect(b.segundos).toBeCloseTo(a.segundos, 9);
    expect(b.costo).toBeCloseTo(a.costo, 9);
  });

  it("un círculo de Ø100 tarda menos que su caja de 100×100", () => {
    const circulo = tiempoLaserPorPerimetro(
      [{ perimetroMm: Math.PI * 100, cantidad: 1 }],
      3,
      config.laser,
    );
    const caja = tiempoLaserPorPerimetro(
      [{ perimetroMm: 400, cantidad: 1 }],
      3,
      config.laser,
    );
    expect(circulo.segundos).toBeLessThan(caja.segundos);
  });
});

describe("costoDiseno", () => {
  it("caja 200×150×100 en 3 mm: material de un cuarto y láser por perímetro", () => {
    const piezas = [
      pieza("base", 200, 150, 2),
      pieza("frente", 200, 100, 2),
      pieza("lado", 150, 100, 2),
    ];
    const acomodo = acomodar(piezas, formatosDeGrupo(grupo), { rotable: true });
    const c = costoDiseno({
      piezas,
      grupo,
      acomodo,
      precios: { F20E001: 480 },
      config,
    })!;

    // Todo entra en 1/4 de 305×205: 480 / 4 × 1.20.
    expect(c.material).toBe(144);
    expect(c.planchas).toBe(0.25);
    // 2×700 + 2×600 + 2×500 = 3600 mm a 18 mm/s, más 6 × (0.1 + 2.5) s.
    const segundos = 3600 / 18 + 6 * 2.6;
    expect(c.minutosLaser).toBeCloseTo(segundos / 60, 9);
    const servicio = (segundos / 60) * 0.8 * 1.18;
    expect(c.total).toBe(Math.ceil(144 + servicio));
    expect(c.servicio).toBeCloseTo(c.total - 144, 9);
    expect(c.problema).toBeNull();
  });

  it("sin precio en Odoo lo dice", () => {
    const piezas = [pieza("a", 100, 100)];
    const acomodo = acomodar(piezas, formatosDeGrupo(grupo), { rotable: true });
    const c = costoDiseno({
      piezas,
      grupo,
      acomodo,
      precios: new Map(),
      config,
    })!;
    expect(c.material).toBe(0);
    expect(c.problema).toMatch(/no tiene precio/);
  });

  it("sin acomodo no hay costo", () => {
    expect(
      costoDiseno({
        piezas: [pieza("a", 1, 1)],
        grupo,
        acomodo: null,
        precios: {},
        config,
      }),
    ).toBeNull();
  });
});
