import { describe, expect, it } from "vitest";
import { planchasPorPaginaDefecto, rangoDePlanchas, ventanaDePagina } from "./paginacion";

describe("planchasPorPaginaDefecto", () => {
  it("en móvil es una por página", () => {
    expect(planchasPorPaginaDefecto(75, false)).toBe(1);
    expect(planchasPorPaginaDefecto(2, false)).toBe(1);
  });
  it("en escritorio son 4 con cuatro o más y 2 con dos o tres", () => {
    expect(planchasPorPaginaDefecto(75, true)).toBe(4);
    expect(planchasPorPaginaDefecto(4, true)).toBe(4);
    expect(planchasPorPaginaDefecto(3, true)).toBe(2);
    expect(planchasPorPaginaDefecto(2, true)).toBe(2);
  });
});

describe("ventanaDePagina", () => {
  it("parte las planchas en páginas", () => {
    expect(ventanaDePagina(75, 0, 4)).toEqual({ desde: 0, hasta: 4, pagina: 0, paginas: 19 });
    expect(ventanaDePagina(75, 4, 4)).toEqual({ desde: 4, hasta: 8, pagina: 1, paginas: 19 });
    expect(ventanaDePagina(75, 72, 4)).toEqual({ desde: 72, hasta: 75, pagina: 18, paginas: 19 });
  });
  it("con pocas planchas es una sola página", () => {
    expect(ventanaDePagina(3, 0, 4)).toEqual({ desde: 0, hasta: 3, pagina: 0, paginas: 1 });
    expect(ventanaDePagina(0, 0, 4).paginas).toBe(1);
  });
  it("al cambiar de tamaño sigue mostrando la plancha en que estaba", () => {
    // Estaba en la plancha 6 (índice 5) con 1 por página; pasa a 4 por página.
    const v = ventanaDePagina(75, 5, 4);
    expect(v.desde).toBeLessThanOrEqual(5);
    expect(v.hasta).toBeGreaterThan(5);
  });
  it("si quedan menos planchas, se queda en la última página", () => {
    expect(ventanaDePagina(6, 40, 4)).toEqual({ desde: 4, hasta: 6, pagina: 1, paginas: 2 });
  });
  it("ignora un valor inválido y no pasa de los extremos", () => {
    expect(ventanaDePagina(10, -3, 0)).toEqual({ desde: 0, hasta: 1, pagina: 0, paginas: 10 });
  });
});

describe("rangoDePlanchas", () => {
  it("una plancha o un rango", () => {
    expect(rangoDePlanchas(4, 5, 75)).toBe("Plancha 5 de 75");
    expect(rangoDePlanchas(4, 8, 75)).toBe("Planchas 5–8 de 75");
    expect(rangoDePlanchas(72, 75, 75)).toBe("Planchas 73–75 de 75");
  });
});
