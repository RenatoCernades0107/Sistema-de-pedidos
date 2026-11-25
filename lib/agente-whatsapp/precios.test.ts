import { describe, expect, it } from "vitest";
import type { DatosListaPrecios } from "@/lib/lista-precios-servidor";
import { buscarPrecios, palabrasDe } from "./precios";

const plancha = (material: string, color: string, espesorMm: number, precio: number | null, activo = true) => ({
  material,
  color,
  espesorMm,
  anchoCm: 122,
  largoCm: 244,
  codigo: `${material}-${color}-${espesorMm}`.replace(/\s+/g, ""),
  precio,
  activo,
  grupoId: "g",
  formatoId: "f",
  formato: "1.22 x 2.44",
});

const DATOS = {
  planchas: [
    plancha("ACRILICO", "CRISTAL", 3, 180),
    plancha("ACRILICO", "CRISTAL", 5, 290),
    plancha("ACRILICO", "BLANCO", 3, 175),
    plancha("POLICARBONATO ALVEOLAR", "BRONCE", 6, 210),
    plancha("ACRILICO", "NEGRO", 3, null),
    plancha("ACRILICO", "ROJO", 3, 190, false),
  ],
  accesorios: [
    { categoriaId: "c1", nombre: "SEPARADOR DE ACERO 19MM", codigo: "SEP19", precio: 4.5, activo: true },
    { categoriaId: "c2", nombre: "PEGAMENTO PARA ACRILICO 250ML", codigo: "PEG250", precio: 25, activo: true },
  ],
  categorias: [
    { id: "c1", nombre: "Separadores", orden: 1 },
    { id: "c2", nombre: "Pegamentos", orden: 2 },
  ],
} as unknown as DatosListaPrecios;

describe("palabrasDe", () => {
  it("normaliza tildes, plurales y espesores", () => {
    expect(palabrasDe("¿Cuánto están los acrílicos de 3 milímetros?")).toEqual(["acrilico", "3mm"]);
    expect(palabrasDe("acrilico 3mm 1.22x2.44")).toEqual(["acrilico", "3mm", "1.22", "2.44"]);
    expect(palabrasDe("5,5 mm")).toEqual(["5.5mm"]);
  });
});

describe("buscarPrecios", () => {
  it("encuentra por material, color y espesor como escribe un cliente", () => {
    const r = buscarPrecios(DATOS, "cuánto está el acrílico cristal de 3 mm?");
    expect(r.encontrados[0]).toMatchObject({ producto: "ACRILICO CRISTAL 3 mm", precio: 180, medida: "1.22 × 2.44 m" });
    // El espesor manda: no aparece el de 5 mm.
    expect(r.encontrados.map((e) => e.precio)).not.toContain(290);
  });

  it("no ofrece lo inactivo ni lo que no tiene precio", () => {
    const r = buscarPrecios(DATOS, "acrilico 3mm");
    const productos = r.encontrados.map((e) => e.producto);
    expect(productos).not.toContain("ACRILICO NEGRO 3 mm");
    expect(productos).not.toContain("ACRILICO ROJO 3 mm");
  });

  it("encuentra accesorios por su nombre o categoría", () => {
    expect(buscarPrecios(DATOS, "pegamento").encontrados[0]).toMatchObject({ codigo: "PEG250", categoria: "Pegamentos" });
    expect(buscarPrecios(DATOS, "separadores").encontrados[0]).toMatchObject({ codigo: "SEP19" });
  });

  it("acepta palabras a medias y avisa cuántos más hay", () => {
    expect(buscarPrecios(DATOS, "policarb").encontrados[0].producto).toContain("POLICARBONATO");
    const r = buscarPrecios(DATOS, "acrilico", 1);
    expect(r.encontrados).toHaveLength(1);
    expect(r.mas).toBeGreaterThan(0);
  });

  it("sin palabras útiles no devuelve nada", () => {
    expect(buscarPrecios(DATOS, "hola, precio?")).toEqual({ encontrados: [], mas: 0 });
    expect(buscarPrecios(DATOS, "madera")).toEqual({ encontrados: [], mas: 0 });
  });
});
