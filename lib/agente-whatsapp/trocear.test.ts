import { describe, expect, it } from "vitest";
import { paginasDeTranscripcion, trocearPaginas, trocearTexto } from "./trocear";

describe("trocearTexto", () => {
  it("deja junto lo que cabe", () => {
    expect(trocearTexto("Uno.\n\nDos.")).toEqual(["Uno.\nDos."]);
    expect(trocearTexto("   ")).toEqual([]);
  });

  it("parte por párrafos sin pasarse del largo (más el solape)", () => {
    const parrafo = (n: number) => `Párrafo ${n}. ` + "palabra ".repeat(40);
    const texto = Array.from({ length: 10 }, (_, i) => parrafo(i)).join("\n\n");
    const trozos = trocearTexto(texto, 600, 100);
    expect(trozos.length).toBeGreaterThan(3);
    for (const t of trozos) expect(t.length).toBeLessThanOrEqual(600 + 100 + 2);
    // Cada trozo (menos el primero) empieza con un poco del anterior.
    expect(trozos[1].startsWith("palabra")).toBe(true);
  });

  it("parte un párrafo enorme por frases o palabras", () => {
    const trozos = trocearTexto("x".repeat(10) + " " + "palabra ".repeat(500), 300, 0);
    expect(trozos.length).toBeGreaterThan(5);
    for (const t of trozos) expect(t.length).toBeLessThanOrEqual(300);
  });
});

describe("trocearPaginas", () => {
  it("no mezcla páginas y dice de cuál es cada fragmento", () => {
    const r = trocearPaginas([
      { numero: 1, texto: "Acrílico cristal." },
      { numero: 3, texto: "Policarbonato." },
    ]);
    expect(r).toEqual([
      { pagina: 1, contenido: "Acrílico cristal." },
      { pagina: 3, contenido: "Policarbonato." },
    ]);
  });
});

describe("paginasDeTranscripcion", () => {
  it("separa por las marcas de página", () => {
    expect(paginasDeTranscripcion("=== Página 1 ===\nHola\n=== Pagina 2 ===\nChau")).toEqual([
      { numero: 1, texto: "Hola" },
      { numero: 2, texto: "Chau" },
    ]);
  });

  it("sin marcas, todo es la página 1", () => {
    expect(paginasDeTranscripcion("Solo texto")).toEqual([{ numero: 1, texto: "Solo texto" }]);
    expect(paginasDeTranscripcion("")).toEqual([]);
  });
});
