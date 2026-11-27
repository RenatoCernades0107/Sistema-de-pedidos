import { describe, expect, it } from "vitest";
import { AJUSTES_POR_DEFECTO, leerAjustesAgente } from "./ajustes";
import { cuentasParaAgente } from "./cuentas";
import { promptDelSistema } from "./sistema";
import type { CuentaBancaria } from "@/lib/cuentas-bancarias";

describe("promptDelSistema", () => {
  const ahora = new Date("2026-11-24T15:00:00Z");

  it("solo responde lo que sabe: lo demás lo deriva callado; y lleva la nota de precios", () => {
    const p = promptDelSistema({ ajustes: AJUSTES_POR_DEFECTO, notaPrecios: "Los precios incluyen IGV.", ahora });
    expect(p).toContain("cotizar cortes a medida");
    expect(p).toContain("productos terminados");
    expect(p).toContain("registrar un pedido");
    expect(p).toContain("NO escribas nada");
    expect(p).toContain("Fotos y PDF del cliente");
    expect(p).toContain("[Asesor humano]");
    expect(p).toContain("Los precios incluyen IGV.");
    expect(p).not.toContain("anuncio de Meta\n- ");
  });

  it("con anuncio, suma su titular, texto y el contexto configurado para su ID", () => {
    const ajustes = {
      ...AJUSTES_POR_DEFECTO,
      anuncios: [{ sourceId: "123", nombre: "Cristal noviembre", contexto: "Promo 10% en 3 mm" }],
    };
    const p = promptDelSistema({
      ajustes,
      anuncio: { sourceId: "123", titulo: "Acrílico a precio de fábrica", texto: "Escríbenos" },
      ahora,
    });
    expect(p).toContain("llegó desde un anuncio");
    expect(p).toContain("Cristal noviembre");
    expect(p).toContain("Acrílico a precio de fábrica");
    expect(p).toContain("Promo 10% en 3 mm");
  });

  it("incluye las indicaciones de Administración", () => {
    const p = promptDelSistema({ ajustes: { ...AJUSTES_POR_DEFECTO, instrucciones: "Envíos con Shalom." }, ahora });
    expect(p).toContain("Envíos con Shalom.");
  });
});

describe("leerAjustesAgente", () => {
  it("completa con los defectos y descarta anuncios inválidos o repetidos", () => {
    const a = leerAjustesAgente({
      instrucciones: "  Hola  ",
      // Viene de antes de que el agente callara al derivar: se ignora.
      mensajeDerivacion: "Te paso con un asesor",
      anuncios: [
        { sourceId: "1", nombre: "A", contexto: "" },
        { sourceId: "1", nombre: "B", contexto: "" },
        { sourceId: "", nombre: "C", contexto: "" },
      ],
    });
    expect(a.instrucciones).toBe("Hola");
    expect(a).not.toHaveProperty("mensajeDerivacion");
    expect(a.anuncios.map((x) => x.nombre)).toEqual(["A"]);
    expect(leerAjustesAgente(null)).toEqual(AJUSTES_POR_DEFECTO);
  });
});

describe("cuentasParaAgente", () => {
  const cuenta = (o: Partial<CuentaBancaria>): CuentaBancaria => ({
    id: "x",
    banco: "BCP",
    tipo: "corriente",
    moneda: "PEN",
    numero: "191-1",
    cci: null,
    creadaEn: "2026-01-01T00:00:00Z",
    creadaPor: "u",
    vigenteDesde: "2026-01-02T00:00:00Z",
    retiradaEn: null,
    retiradaPor: null,
    enPdf: true,
    ...o,
  });
  const ahora = new Date("2026-11-24T00:00:00Z");

  it("solo las vigentes marcadas para el PDF", () => {
    const r = cuentasParaAgente(
      [
        cuenta({ banco: "BCP" }),
        cuenta({ banco: "Oculta", enPdf: false }),
        cuenta({ banco: "Retirada", retiradaEn: "2026-05-01T00:00:00Z" }),
        cuenta({ banco: "Pendiente", vigenteDesde: "2026-11-25T00:00:00Z" }),
      ],
      ahora,
    );
    expect(r).toEqual([{ banco: "BCP", tipo: "Cuenta corriente", moneda: "Soles", numero: "191-1", cci: null }]);
  });
});
