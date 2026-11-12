import { describe, expect, it } from "vitest";
import { armadoDeCaja, tieneArmado } from "./armado";

describe("armadoDeCaja", () => {
  it("una caja cerrada se arma en cuatro pasos y usa sus seis caras", () => {
    const a = armadoDeCaja("caja_cerrada", { m1: 30, m2: 20, m3: 10 })!;
    expect(a.pasos.map((p) => p.titulo)).toEqual(["Base", "Frente y fondo", "Laterales", "Tapa"]);
    expect(a.pasos.flatMap((p) => p.caras).sort()).toEqual(["base", "derecha", "fondo", "frente", "izquierda", "tapa"]);
    expect(a.pasos.map((p) => p.medida)).toEqual(["30 × 20 cm", "30 × 10 cm", "20 × 10 cm", "30 × 20 cm"]);
    expect([a.largo, a.ancho, a.alto]).toEqual([30, 20, 10]);
  });

  it("la abierta no lleva tapa", () => {
    expect(armadoDeCaja("caja_abierta", { m1: 30, m2: 20, m3: 10 })!.pasos.map((p) => p.titulo)).toEqual([
      "Base",
      "Frente y fondo",
      "Laterales",
    ]);
  });

  it("solo las cajas, y con sus tres medidas", () => {
    expect(armadoDeCaja("caja_cerrada", { m1: 30, m2: 20 })).toBeNull();
    expect(armadoDeCaja("cilindro", { diametro: 20, altura: 25 })).toBeNull();
    expect(tieneArmado("lamina")).toBe(false);
  });
});
