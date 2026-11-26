import { describe, expect, it } from "vitest";
import { ROLES, gruposDe, tiposDeLineas } from "./dominio";
import { FORMATO_CODIGO } from "./esquemas";

describe("tiposDeLineas", () => {
  it("un corte láser es CL y uno manual CM", () => {
    expect(tiposDeLineas([{ corte: { modalidad: "laser" } }])).toEqual(["CL"]);
    expect(tiposDeLineas([{ corte: { modalidad: "manual" } }])).toEqual(["CM"]);
  });

  it("un producto terminado es PT y un producto de Odoo tal cual, SP", () => {
    expect(tiposDeLineas([{ terminado: {} }])).toEqual(["PT"]);
    expect(tiposDeLineas([{}])).toEqual(["SP"]);
  });

  it("combina sin repetir y siempre en el mismo orden", () => {
    expect(
      tiposDeLineas([
        { terminado: {} },
        {},
        { corte: { modalidad: "laser" } },
        { corte: { modalidad: "laser" } },
      ]),
    ).toEqual(["CL", "SP", "PT"]);
  });
});

describe("FORMATO_CODIGO", () => {
  it("acepta el código nuevo y el de los pedidos anteriores", () => {
    expect(FORMATO_CODIGO.test("P2611-001")).toBe(true);
    expect(FORMATO_CODIGO.test("P2611-999")).toBe(true);
    expect(FORMATO_CODIGO.test("LCL_2026_H4TP")).toBe(true);
    expect(FORMATO_CODIGO.test("PMX_2026_H4TP")).toBe(true);
  });

  it("rechaza lo que no es un código", () => {
    expect(FORMATO_CODIGO.test("P2611-1000")).toBe(false);
    expect(FORMATO_CODIGO.test("P2611-01")).toBe(false);
    expect(FORMATO_CODIGO.test("p2611-001")).toBe(false);
  });
});

describe("gruposDe", () => {
  const resumen = (rol: keyof typeof ROLES, excluir?: string[]) =>
    gruposDe(ROLES[rol], excluir).map((g) => [
      g.id,
      g.vistas.map((v) => v.titulo),
    ]);

  it("a Administración le da las tres secciones en orden", () => {
    expect(resumen("administracion")).toEqual([
      ["principal", ["Cotizaciones", "Chat"]],
      ["taller", ["Diseños", "Almacén"]],
      ["gestion", ["Compras", "Costos y precios", "Métricas", "Agente de WhatsApp", "Configuración"]],
    ]);
  });

  it("a Logística le da Compras en Gestión, sin costos ni métricas", () => {
    expect(resumen("logistica")).toEqual([
      ["principal", ["Chat"]],
      ["taller", ["Diseños", "Almacén"]],
      ["gestion", ["Compras"]],
    ]);
  });

  it("a Ventas le da Cotizaciones, Chat, Diseños y Almacén: ni Métricas ni Configuración", () => {
    expect(resumen("ventas")).toEqual([
      ["principal", ["Cotizaciones", "Chat"]],
      ["taller", ["Diseños", "Almacén"]],
    ]);
  });

  it("Ventas cotiza y registra pedidos, ve precios, y no gestiona stock ni cambia pedidos", () => {
    const v = ROLES.ventas;
    expect([v.gestionarCotizaciones, v.crearPedido, v.verAlmacen, v.verPrecios, v.usarCad]).toEqual([true, true, true, true, true]);
    expect([v.gestionarStock, v.editarPrecios, v.verMetricas, v.configurar, v.editarTodo, v.editarUbicacion]).toEqual([
      false, false, false, false, false, false,
    ]);
    expect([v.verMontos, v.verEnvioCompleto]).toEqual([true, true]);
  });

  it("sin el Chat, que en el celular tiene pestaña propia, el grupo principal desaparece", () => {
    expect(resumen("operaciones", ["/chat"])).toEqual([
      ["taller", ["Diseños", "Almacén"]],
    ]);
  });
});
