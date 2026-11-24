import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  esquemaCuentaBancaria,
  estadoCuenta,
  elegirCuentas,
  leerCuentasPublicas,
  tituloCuenta,
  type CuentaParaPdf,
} from "./cuentas-bancarias";
import { generarPdfCotizacion } from "./pdf-cotizacion";
import type { Cotizacion } from "./cotizaciones";

const bcp = { id: "c1", enPdf: true, banco: "BCP", tipo: "corriente", moneda: "PEN", numero: "191-1234567-0-12", cci: "00219100123456701252" };

describe("esquemaCuentaBancaria", () => {
  it("acepta una cuenta completa y limpia lo copiado del banco", () => {
    const r = esquemaCuentaBancaria.parse({ ...bcp, numero: " 191 1234567 0 12 ", cci: "002-191-001234567012-52" });
    expect(r.numero).toBe("191-1234567-0-12");
    expect(r.cci).toBe("00219100123456701252");
  });

  it("el CCI tiene 20 dígitos", () => {
    expect(esquemaCuentaBancaria.safeParse({ ...bcp, cci: "0021910012345670125" }).success).toBe(false);
    expect(esquemaCuentaBancaria.safeParse({ ...bcp, cci: "0021910012345670125X" }).success).toBe(false);
  });

  it("solo la cuenta de detracciones puede ir sin CCI", () => {
    expect(esquemaCuentaBancaria.safeParse({ ...bcp, cci: "" }).success).toBe(false);
    expect(esquemaCuentaBancaria.safeParse({ ...bcp, banco: "Banco de la Nación", tipo: "detracciones", cci: "" }).success).toBe(true);
  });

  it("rechaza letras en el número, tipos y monedas desconocidos", () => {
    expect(esquemaCuentaBancaria.safeParse({ ...bcp, numero: "191-ABC-0" }).success).toBe(false);
    expect(esquemaCuentaBancaria.safeParse({ ...bcp, tipo: "plazo_fijo" }).success).toBe(false);
    expect(esquemaCuentaBancaria.safeParse({ ...bcp, moneda: "EUR" }).success).toBe(false);
  });
});

describe("estadoCuenta", () => {
  const ahora = new Date("2026-11-21T12:00:00Z");
  it("pendiente hasta su hora, vigente después, retirada siempre que se retiró", () => {
    expect(estadoCuenta({ vigenteDesde: "2026-11-22T11:00:00Z", retiradaEn: null }, ahora)).toBe("pendiente");
    expect(estadoCuenta({ vigenteDesde: "2026-11-21T11:00:00Z", retiradaEn: null }, ahora)).toBe("vigente");
    expect(estadoCuenta({ vigenteDesde: "2026-11-22T11:00:00Z", retiradaEn: "2026-11-21T11:30:00Z" }, ahora)).toBe("retirada");
  });
});

describe("leerCuentasPublicas", () => {
  it("se queda solo con cuentas completas", () => {
    expect(
      leerCuentasPublicas([
        bcp,
        { ...bcp, tipo: "raro" },
        { ...bcp, moneda: 3 },
        { banco: "BBVA" },
        null,
        { ...bcp, id: "c2", banco: "Banco de la Nación", tipo: "detracciones", cci: null },
      ]),
    ).toEqual([bcp, { ...bcp, id: "c2", banco: "Banco de la Nación", tipo: "detracciones", cci: null }]);
    expect(leerCuentasPublicas(null)).toEqual([]);
    expect(leerCuentasPublicas({})).toEqual([]);
  });

  it("el título dice banco, tipo y moneda", () => {
    expect(tituloCuenta(bcp as CuentaParaPdf)).toBe("BCP · Cuenta corriente · Soles");
  });
});

describe("elegirCuentas", () => {
  const a = { ...bcp, id: "a", enPdf: true } as never;
  const b = { ...bcp, id: "b", enPdf: false } as never;
  const todas = [a, b] as Parameters<typeof elegirCuentas>[0];
  it("sin elección salen las marcadas en Configuración", () => {
    expect(elegirCuentas(todas, null).map((c) => c.id)).toEqual(["a"]);
  });
  it("con elección salen solo esas, y un id inventado no agrega nada", () => {
    expect(elegirCuentas(todas, "b,zzz").map((c) => c.id)).toEqual(["b"]);
    expect(elegirCuentas(todas, "").map((c) => c.id)).toEqual([]);
  });
});

describe("PDF con cuentas", () => {
  const cotizacion = {
    id: "0f8fad5b-d9cb-469f-a165-70867728950e",
    odooOrderName: "S04254",
    cliente: { id: 1, nombre: "Juan Pérez", documento: "45678912", telefono: null },
    creadoEn: "2026-11-21T15:00:00Z",
    lineas: [],
    montoTotal: 400,
    montoSinImpuestos: 338.98,
    montoImpuestos: 61.02,
  } as unknown as Cotizacion;

  it("sale con y sin cuentas, y muchas cuentas no rompen la hoja", async () => {
    const sin = await generarPdfCotizacion(cotizacion);
    const muchas = Array.from({ length: 30 }, () => bcp as CuentaParaPdf);
    const con = await generarPdfCotizacion(cotizacion, null, { cuentas: muchas });
    expect((await PDFDocument.load(sin)).getPageCount()).toBe(1);
    expect((await PDFDocument.load(con)).getPageCount()).toBeGreaterThan(1);
  });
});
