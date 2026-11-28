import { describe, expect, it } from "vitest";
import {
  esquemaNombreProyecto,
  estadoDeDiseno,
  mensajeInicialDeDiseno,
  nombreSeguro,
  resumenDeProyecto,
  textoDeResumen,
} from "./proyectos";

describe("estadoDeDiseno", () => {
  it("sin versión, de plantilla, borrador y aprobado", () => {
    expect(estadoDeDiseno(null)).toBe("sin_version");
    expect(estadoDeDiseno({ plantilla: "caja", estado: "aprobado" })).toBe("plantilla");
    expect(estadoDeDiseno({ plantilla: "caja", estado: null })).toBe("plantilla");
    expect(estadoDeDiseno({ plantilla: "libre", estado: "borrador" })).toBe("borrador");
    expect(estadoDeDiseno({ plantilla: "libre", estado: null })).toBe("borrador");
    expect(estadoDeDiseno({ plantilla: "libre", estado: "aprobado" })).toBe("aprobado");
  });
});

describe("resumenDeProyecto", () => {
  it("cuenta y dice si está listo para producción", () => {
    expect(resumenDeProyecto([])).toEqual({ total: 0, aprobados: 0, borradores: 0, sinVersion: 0, listoParaProduccion: false });
    expect(resumenDeProyecto(["plantilla", "aprobado"])).toMatchObject({ total: 2, aprobados: 2, listoParaProduccion: true });
    const r = resumenDeProyecto(["aprobado", "borrador", "borrador", "sin_version"]);
    expect(r).toEqual({ total: 4, aprobados: 1, borradores: 2, sinVersion: 1, listoParaProduccion: false });
  });

  it("un diseño vacío impide que esté listo", () => {
    expect(resumenDeProyecto(["aprobado", "sin_version"]).listoParaProduccion).toBe(false);
  });
});

describe("textoDeResumen", () => {
  it("lo dice en una frase", () => {
    expect(textoDeResumen(resumenDeProyecto([]))).toBe("Sin diseños todavía");
    expect(textoDeResumen(resumenDeProyecto(["aprobado"]))).toBe("1 diseño, listo");
    expect(textoDeResumen(resumenDeProyecto(["aprobado", "plantilla"]))).toBe("2 diseños, todos listos");
    expect(textoDeResumen(resumenDeProyecto(["aprobado", "borrador", "borrador"]))).toBe("1 de 3 listos");
  });
});

describe("esquemaNombreProyecto", () => {
  it("recorta y exige entre 1 y 120 caracteres", () => {
    expect(esquemaNombreProyecto.parse("  Hurley  ")).toBe("Hurley");
    expect(esquemaNombreProyecto.safeParse("   ").success).toBe(false);
    expect(esquemaNombreProyecto.safeParse("x".repeat(121)).success).toBe(false);
  });
});

describe("mensajeInicialDeDiseno", () => {
  it("nombra el diseño, el proyecto y los otros, sin repetir el propio", () => {
    const t = mensajeInicialDeDiseno({
      proyecto: "Hurley",
      nombre: "Fitting room",
      descripcion: "Letrero de 125 × 50 cm en acrílico negro de 3 mm.",
      hermanos: ["Logo fachada", "Fitting room", "Logo counter"],
    });
    expect(t).toContain("«Fitting room», del proyecto «Hurley»");
    expect(t).toContain("125 × 50 cm");
    expect(t).toContain("Logo fachada, Logo counter");
    expect(t).not.toContain("Fitting room, ");
  });

  it("sin hermanos ni descripción no deja líneas vacías", () => {
    const t = mensajeInicialDeDiseno({ proyecto: "P", nombre: "A", descripcion: "  ", hermanos: ["A"] });
    expect(t).not.toMatch(/\n\n\n/);
    expect(t).not.toContain("otros diseños");
  });
});

describe("nombreSeguro", () => {
  it("deja un nombre de archivo sin tildes, espacios ni símbolos", () => {
    expect(nombreSeguro("Hurley Trujillo")).toBe("hurley-trujillo");
    expect(nombreSeguro("  Ñandú / «Logo» #2 ")).toBe("nandu-logo-2");
  });

  it("sin nada que conservar usa el respaldo, y recorta lo muy largo", () => {
    expect(nombreSeguro("¡¡¡")).toBe("proyecto");
    expect(nombreSeguro("", "diseno")).toBe("diseno");
    expect(nombreSeguro("a".repeat(100)).length).toBe(60);
  });
});
