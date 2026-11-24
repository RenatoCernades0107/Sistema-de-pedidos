import { describe, expect, it } from "vitest";
import {
  admiteVersionNueva,
  detalleDesdeLineas,
  esEditable,
  etiquetaVersion,
  motivoNoEnviable,
  type Cotizacion,
  type LineaGuardada,
} from "./cotizaciones";

const linea = (l: Partial<LineaGuardada>): LineaGuardada => ({
  posicion: 1,
  productoId: 10,
  nombre: "ACRILICO F8 CRISTAL 3MM",
  codigo: "AC-003",
  descripcion: null,
  cantidad: 1,
  precioUnitario: 120,
  corte: null,
  terminado: null,
  importe: 120,
  ...l,
});

describe("detalleDesdeLineas", () => {
  it("una línea por producto, con cantidad, código y medidas", () => {
    expect(
      detalleDesdeLineas([
        linea({ cantidad: 2, descripcion: "corte\n30x50 cm" }),
        linea({ posicion: 2, cantidad: 0.5, codigo: null, nombre: "SERVICIO CORTE LASER" }),
      ]),
    ).toBe("2 × [AC-003] ACRILICO F8 CRISTAL 3MM — corte 30x50 cm\n0.5 × SERVICIO CORTE LASER");
  });

  it("las indicaciones de una línea van debajo de ella", () => {
    expect(
      detalleDesdeLineas([
        linea({ cantidad: 2, indicaciones: "bordes  pulidos\nentregar con film" }),
        linea({ posicion: 2, nombre: "SERVICIO CORTE LASER", codigo: null }),
      ]),
    ).toBe("2 × [AC-003] ACRILICO F8 CRISTAL 3MM\n  ↳ bordes pulidos entregar con film\n1 × SERVICIO CORTE LASER");
  });

  it("no arrastra decimales de más", () => {
    expect(detalleDesdeLineas([linea({ cantidad: 2.5 })])).toBe("2.5 × [AC-003] ACRILICO F8 CRISTAL 3MM");
  });
});

describe("edición de cotizaciones", () => {
  const c = (x: Partial<Cotizacion> = {}) => ({
    estado: "borrador" as const,
    pedido: null,
    sincronizacion: "sincronizada" as const,
    odooOrderId: 4254,
    errorEdicion: null,
    version: 1,
    ...x,
  });

  it("solo un borrador sin pedido se edita", () => {
    expect(esEditable(c())).toBe(true);
    expect(esEditable(c({ estado: "enviada" }))).toBe(false);
    expect(esEditable(c({ estado: "reemplazada" }))).toBe(false);
    expect(esEditable(c({ pedido: { codigo: "PED-1" } }))).toBe(false);
  });

  it("solo una enviada sin pedido admite versión nueva", () => {
    expect(admiteVersionNueva(c({ estado: "enviada" }))).toBe(true);
    expect(admiteVersionNueva(c({ estado: "borrador" }))).toBe(false);
    expect(admiteVersionNueva(c({ estado: "reemplazada" }))).toBe(false);
    expect(admiteVersionNueva(c({ estado: "enviada", pedido: { codigo: "PED-1" } }))).toBe(false);
  });

  it("no se envía sin Odoo ni con cambios que Odoo no tiene", () => {
    expect(motivoNoEnviable(c())).toBeNull();
    expect(motivoNoEnviable(c({ sincronizacion: "error", odooOrderId: null }))).toMatch(/Odoo/);
    expect(motivoNoEnviable(c({ sincronizacion: "pendiente", odooOrderId: null }))).toMatch(/Odoo/);
    expect(motivoNoEnviable(c({ errorEdicion: "Los cambios todavía no están en Odoo." }))).toMatch(/cambios/);
    expect(motivoNoEnviable(c({ estado: "enviada" }))).toMatch(/borrador/);
    expect(motivoNoEnviable(c({ pedido: { codigo: "PED-1" } }))).toMatch(/pedido/);
  });

  it("la versión se marca desde la segunda", () => {
    expect(etiquetaVersion({ version: 1 })).toBeNull();
    expect(etiquetaVersion({ version: 2 })).toBe("v2");
  });
});
