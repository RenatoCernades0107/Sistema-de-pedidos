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
