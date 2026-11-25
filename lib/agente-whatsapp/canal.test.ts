import { describe, expect, it } from "vitest";
import { anuncioDeReferral, envioDe } from "./canal";
import { leerAnuncio } from "./pruebas";

describe("anuncioDeReferral", () => {
  it("lee el referral de Meta (Click-to-WhatsApp)", () => {
    expect(
      anuncioDeReferral({
        source_type: "ad",
        source_id: "120210",
        source_url: "https://fb.me/x",
        headline: "Acrílico a precio de fábrica",
        body: "Escríbenos",
        ctwa_clid: "abc",
      }),
    ).toEqual({ sourceId: "120210", titulo: "Acrílico a precio de fábrica", texto: "Escríbenos", url: "https://fb.me/x", ctwaClid: "abc" });
  });

  it("sin datos del anuncio no hay anuncio", () => {
    expect(anuncioDeReferral(undefined)).toBeNull();
    expect(anuncioDeReferral({ source_type: "ad" })).toBeNull();
  });

  it("lo guardado en una prueba se lee igual", () => {
    expect(leerAnuncio({ sourceId: "1", titulo: " T ", basura: 3 })).toEqual({ sourceId: "1", titulo: "T" });
    expect(leerAnuncio({})).toBeNull();
  });
});

describe("envioDe", () => {
  const enlaces = new Map([["d1", "https://firmada/foto.jpg"], ["d2", "https://firmada/cat.pdf"]]);

  it("texto, foto con pie y PDF con nombre", () => {
    expect(envioDe({ tipo: "texto", texto: "Hola" }, enlaces)).toEqual({ tipo: "texto", body: "Hola" });
    expect(
      envioDe({ tipo: "archivo", adjunto: { documentoId: "d1", nombre: "foto.jpg", mime: "image/jpeg", tipo: "foto" }, texto: "Así queda" }, enlaces),
    ).toEqual({ tipo: "imagen", link: "https://firmada/foto.jpg", caption: "Así queda" });
    expect(
      envioDe({ tipo: "archivo", adjunto: { documentoId: "d2", nombre: "Catálogo.pdf", mime: "application/pdf", tipo: "catalogo" } }, enlaces),
    ).toMatchObject({ tipo: "documento", filename: "Catálogo.pdf" });
  });

  it("sin enlace no se envía", () => {
    expect(
      envioDe({ tipo: "archivo", adjunto: { documentoId: "zz", nombre: "x", mime: "image/png", tipo: "foto" } }, enlaces),
    ).toBeNull();
  });
});
