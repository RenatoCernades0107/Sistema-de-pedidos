import { describe, expect, it } from "vitest";
import { leerParametrosCad, medidasAParametrosCad, medidasDeParametrosCad, parametrosCadDe } from "./plantilla-cad";

describe("medidasAParametrosCad", () => {
  it("una caja de 20 × 15 × 10 cm va al motor en mm", () => {
    expect(medidasAParametrosCad("caja", { m1: 20, m2: 15, m3: 10 })).toEqual({ largo: 200, ancho: 150, alto: 100 });
  });

  it("cada plantilla toma sus medidas en su orden", () => {
    expect(medidasAParametrosCad("display", { m1: 20, m2: 15, m3: 15 })).toEqual({ ancho: 200, fondo: 150, alto: 150 });
    expect(medidasAParametrosCad("porta_afiche", { m1: 10, m2: 15, m3: 7 })).toEqual({ ancho: 100, alto: 150, fondo: 70 });
    expect(medidasAParametrosCad("atril", { m1: 22, m2: 30, m3: 15 })).toEqual({ ancho: 220, alto: 300 });
    expect(medidasAParametrosCad("letras", { altura: 5, letras: 4 })).toEqual({ alto_letra: 50 });
    expect(medidasAParametrosCad("letrero", { m1: 35.7, m2: 49 })).toEqual({ ancho: 357, alto: 490 });
  });

  it("lo que falta no se manda, y una plantilla desconocida no da nada", () => {
    expect(medidasAParametrosCad("caja", { m1: 20, m2: null })).toEqual({ largo: 200 });
    expect(medidasAParametrosCad("otra", { m1: 20 })).toEqual({});
  });
});

describe("parametrosCadDe", () => {
  const caja = { plantillaCad: "caja", parametrosCad: { largo: 200, ancho: 150, alto: 100, espesor: 3, con_tapa: true } };

  it("sin plantilla no hay parámetros", () => {
    expect(parametrosCadDe({ plantillaCad: null, parametrosCad: null }, { m1: 20 })).toBeNull();
  });

  it("la medida elegida y el espesor de la plancha pisan los guardados; los fijos se quedan", () => {
    expect(parametrosCadDe(caja, { m1: 30, m2: 20, m3: 20 }, { espesorMm: 4 })).toEqual({
      largo: 300,
      ancho: 200,
      alto: 200,
      espesor: 4,
      con_tapa: true,
    });
  });

  it("el texto del pedido llega a letras y letreros, recortado", () => {
    const letras = { plantillaCad: "letras", parametrosCad: { alto_letra: 50 } };
    expect(parametrosCadDe(letras, {}, { texto: "  HOLA " })).toEqual({ alto_letra: 50, texto: "HOLA" });
    expect(parametrosCadDe(letras, {}, { texto: "x".repeat(50) })!.texto).toHaveLength(40);
    expect(parametrosCadDe(caja, {}, { texto: "HOLA" })!.texto).toBeUndefined();
  });
});

describe("leerParametrosCad", () => {
  it("solo un objeto de valores planos", () => {
    expect(leerParametrosCad(null)).toBeNull();
    expect(leerParametrosCad([1])).toBeNull();
    expect(leerParametrosCad({ largo: 200, con_tapa: true, x: { y: 1 } })).toEqual({ largo: 200, con_tapa: true });
  });
});

describe("medidasDeParametrosCad", () => {
  it("vuelve de los parámetros del motor (mm) a las medidas del catálogo (cm)", () => {
    expect(medidasDeParametrosCad("caja", { largo: 300, ancho: 200, alto: 205, espesor: 3, con_tapa: true })).toEqual({
      m1: 30,
      m2: 20,
      m3: 20.5,
    });
    expect(medidasDeParametrosCad("letras", { alto_letra: 150 })).toEqual({ altura: 15 });
  });

  it("es la inversa de medidasAParametrosCad", () => {
    const medidas = { m1: 25, m2: 20, m3: 15 };
    expect(medidasDeParametrosCad("display", medidasAParametrosCad("display", medidas))).toEqual(medidas);
  });

  it("sin plantilla conocida o sin valores, no da medidas", () => {
    expect(medidasDeParametrosCad("libre", { largo: 300 })).toEqual({});
    expect(medidasDeParametrosCad("caja", { largo: "300", ancho: 0 })).toEqual({});
  });
});
