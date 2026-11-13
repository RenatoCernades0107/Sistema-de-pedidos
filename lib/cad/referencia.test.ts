import { describe, expect, it } from "vitest";
import { leerReferenciaDiseno, marcaDiseno } from "./referencia";

const id = "0f8a3c1e-2b4d-4e6f-8a9b-1c2d3e4f5a6b";

describe("referencia al diseño", () => {
  it("ida y vuelta, aunque haya más notas alrededor", () => {
    const notas = `Pegado a tope.\n${marcaDiseno({ disenoId: id, version: 7 })}\nUrgente`;
    expect(leerReferenciaDiseno(notas)).toEqual({ disenoId: id, version: 7 });
  });

  it("sin marca, o con versión 0, no hay referencia", () => {
    expect(leerReferenciaDiseno("Caja de 20 cm")).toBeNull();
    expect(leerReferenciaDiseno(null)).toBeNull();
    expect(leerReferenciaDiseno(`Diseño CAD ${id} v0`)).toBeNull();
  });
});
