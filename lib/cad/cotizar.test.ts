import { describe, expect, it } from "vitest";
import { lineaDeDiseno } from "./cotizar";

const id = "0f8a3c1e-2b4d-4e6f-8a9b-1c2d3e4f5a6b";

describe("lineaDeDiseno", () => {
  it("arma un personalizado con el área de las piezas y la referencia al diseño", () => {
    const l = lineaDeDiseno({
      disenoId: id,
      nombre: " Caja regalo ",
      version: 4,
      versionId: "11111111-2222-4333-8444-555555555555",
      areaPiezasMm2: 130_000,
      grupo: null,
      color: null,
    });
    expect(l).toMatchObject({
      productoCodigo: null,
      nombre: "Caja regalo",
      geometria: "manual",
      areaManualM2: 0.13,
      cantidad: 1,
    });
    expect(l.disenoVersionId).toBe("11111111-2222-4333-8444-555555555555");
    expect(l.notas).toBe("");
  });

  it("sin acomodo guardado, el área queda para escribirla a mano", () => {
    const l = lineaDeDiseno({
      disenoId: id,
      nombre: "",
      version: 1,
      versionId: "11111111-2222-4333-8444-555555555555",
      areaPiezasMm2: null,
      grupo: null,
      color: null,
    });
    expect(l.areaManualM2).toBeNull();
    expect(l.nombre).toBe("Diseño CAD");
  });
});

describe("lineaDeDiseno para un pedido", () => {
  const disenoBase = {
    disenoId: id,
    nombre: "Caja con tapa",
    version: 2,
    versionId: "11111111-2222-4333-8444-555555555555",
    areaPiezasMm2: 368_510,
    grupo: null,
    color: null,
  };
  const plancha = { productoId: 9, codigo: "F15E004", nombre: "Plancha", anchoCm: 150, largoCm: 300, precio: 450 };

  it("con un producto del catálogo se vende como ese producto y se estima por su forma", () => {
    const l = lineaDeDiseno(disenoBase, {
      cantidad: 2,
      precioUnitario: 150,
      reservar: true,
      producto: { codigo: "CAJ-001", tipo: "CAJ", nombre: "Caja con tapa removible", geometria: "caja_cerrada" },
      medidas: { m1: 30, m2: 20, m3: 20 },
      estimacion: { plancha, factor: 2, mermaPct: 15, anchoDeLetra: 0 },
    });
    expect(l).toMatchObject({
      productoCodigo: "CAJ-001",
      tipoCodigo: "CAJ",
      nombre: "Caja con tapa removible",
      geometria: "caja_cerrada",
      medidas: { m1: 30, m2: 20, m3: 20 },
      areaManualM2: null,
      cantidad: 2,
      precioUnitario: 150,
      reservar: true,
    });
    expect(l.disenoVersionId).toBe("11111111-2222-4333-8444-555555555555");
    // 2 × 0.32 m² con 15% de merma, sobre la plancha de 4.5 m².
    expect(l.calculo.areaUnidadM2).toBeCloseTo(0.32, 2);
    expect(l.calculo.materiales.map((m) => m.productoId)).toEqual([9]);
    expect(l.calculo.precioSugerido).toBeGreaterThan(0);
  });

  it("sin producto del catálogo es un personalizado: el área de las piezas, a mano", () => {
    const l = lineaDeDiseno(disenoBase, { cantidad: 3, reservar: true, estimacion: { plancha, factor: 1, mermaPct: 10, anchoDeLetra: 0 } });
    expect(l).toMatchObject({ productoCodigo: null, geometria: "manual", medidas: {}, areaManualM2: 0.3685, cantidad: 3, reservar: true });
    expect(l.calculo.materiales).toHaveLength(1);
  });

  it("un producto sin medidas cae al área de las piezas", () => {
    const l = lineaDeDiseno(disenoBase, {
      producto: { codigo: "LET-001", tipo: "LET", nombre: "Letras", geometria: "letras" },
      medidas: {},
    });
    expect(l.areaManualM2).toBe(0.3685);
  });
});
