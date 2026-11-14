import { describe, expect, it } from "vitest";
import { conEspesor, conservarEspesores, espesoresDe, nodoValido, sinEspesores } from "./espesores";

const p = { largo: 200, espesor: 3, "espesor@lateral_2": 5, "espesor@base": "x" as unknown as number };

describe("espesores por copia", () => {
  it("lee solo los numéricos", () => {
    expect(espesoresDe(p)).toEqual({ lateral_2: 5 });
  });

  it("quita los propios y deja los de la plantilla", () => {
    expect(sinEspesores(p)).toEqual({ largo: 200, espesor: 3 });
  });

  it("conserva los propios al cambiar parámetros, sin pisar los nuevos", () => {
    expect(conservarEspesores({ largo: 300, espesor: 4 }, p)).toEqual({
      largo: 300,
      espesor: 4,
      "espesor@lateral_2": 5,
      "espesor@base": "x",
    });
    expect(conservarEspesores({ "espesor@lateral_2": 6 }, p)["espesor@lateral_2"]).toBe(6);
  });

  it("pone y quita", () => {
    const con = conEspesor({ largo: 1 }, ["lateral_1", "lateral_2"], 5);
    expect(con).toEqual({ largo: 1, "espesor@lateral_1": 5, "espesor@lateral_2": 5 });
    expect(conEspesor(con, "lateral_1", null)).toEqual({ largo: 1, "espesor@lateral_2": 5 });
  });

  it("valida el nombre del nodo", () => {
    expect(nodoValido("lateral_2")).toBe(true);
    expect(nodoValido("Lateral 2")).toBe(false);
    expect(nodoValido("")).toBe(false);
  });
});
