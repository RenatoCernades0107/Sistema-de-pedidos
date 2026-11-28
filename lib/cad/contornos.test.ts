import { describe, expect, it } from "vitest";
import { NOMBRE_CONTORNO, deFilasDeContorno } from "./contornos";

describe("contornos", () => {
  it("el nombre va en minúsculas, números y guion bajo, empezando por letra", () => {
    expect(NOMBRE_CONTORNO.test("hurley")).toBe(true);
    expect(NOMBRE_CONTORNO.test("hurley_2")).toBe(true);
    expect(NOMBRE_CONTORNO.test("2hurley")).toBe(false);
    expect(NOMBRE_CONTORNO.test("Hurley")).toBe(false);
    expect(NOMBRE_CONTORNO.test("con espacio")).toBe(false);
    expect(NOMBRE_CONTORNO.test("a".repeat(41))).toBe(false);
  });

  it("deFilasDeContorno pasa a la forma del sandbox y salta lo que no se entiende", () => {
    const r = deFilasDeContorno([
      { nombre: "hurley", ancho_mm: 3470 as number, alto_mm: 830, trazos: ["M 0 0 L 1 0 Z"] },
      { nombre: "Malo", ancho_mm: 1, alto_mm: 1, trazos: ["M 0 0 Z"] },
      { nombre: "sin_trazos", ancho_mm: 1, alto_mm: 1, trazos: [] },
      // numeric de Postgres puede llegar como texto
      { nombre: "texto", ancho_mm: "12.5" as unknown as number, alto_mm: "3" as unknown as number, trazos: ["M 0 0 Z"] },
    ]);
    expect(Object.keys(r)).toEqual(["hurley", "texto"]);
    expect(r.hurley).toEqual({ ancho_mm: 3470, alto_mm: 830, trazos: ["M 0 0 L 1 0 Z"] });
    expect(r.texto.ancho_mm).toBe(12.5);
  });
});
