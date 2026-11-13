import { describe, expect, it } from "vitest";
import { PROMPT_DISENO_LIBRE, PROMPT_SIN_DISENO_LIBRE, contextoDisenoActual, promptDeTurno } from "./prompt";

describe("prompt del diseño libre", () => {
  it("sin la bandera dice que no está disponible y no explica el sandbox", () => {
    const p = promptDeTurno(null);
    expect(p).toContain(PROMPT_SIN_DISENO_LIBRE);
    expect(p).not.toContain("ejecutar_build123d");
  });

  it("con la bandera explica el contrato, el ciclo y la aprobación", () => {
    const p = promptDeTurno(null, { disenoLibre: true });
    expect(p).toContain(PROMPT_DISENO_LIBRE);
    for (const clave of ["piezas = [", "ver_render", "BORRADOR", "kerf", "build123d.exporters", "uvx"]) {
      expect(p).toContain(clave);
    }
    expect(p).not.toMatch(/\$\{/);
  });

  it("el diseño actual libre lleva su código y su estado", () => {
    const c = contextoDisenoActual({
      plantilla: "libre",
      parametros: {},
      version: 3,
      origen: "chat",
      codigo: "piezas = []",
      estado: "borrador",
    });
    expect(c).toContain("piezas = []");
    expect(c).toContain("borrador");
  });
});

describe("prompt de material y costo", () => {
  it("pide el material antes de cotizar y avisa de las piezas que no entran", () => {
    const p = promptDeTurno(null);
    for (const clave of ["elegir_material", "ver_costo", "no entran", "pregúntale primero material"]) {
      expect(p).toContain(clave);
    }
    // Sin montos, no se inventan.
    expect(p).toMatch(/no des ni estimes precios/);
  });
});
