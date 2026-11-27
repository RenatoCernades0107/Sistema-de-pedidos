import { describe, expect, it } from "vitest";
import { devueltoDe, type Pedido } from "./dominio";
import { esquemaDevolucion, esquemaFormDevolucion } from "./esquemas";
import { cobradoEn, cobradoPorMetodo } from "./metricas";
import type { PostgrestError } from "@supabase/supabase-js";
import { mensajeDeError } from "./errores";

/** Solo lo que mira cada función: el resto del pedido no importa aquí. */
const pedido = (parcial: Partial<Pedido>) => ({ abonos: [], devoluciones: [], ...parcial }) as unknown as Pedido;

const junio = { desde: "2026-06-01", hasta: "2026-06-30" };

describe("esquemaFormDevolucion", () => {
  const esquema = esquemaFormDevolucion(100);
  const base = { monto: 40, metodo: "efectivo", motivo: "Anuló el pedido" };

  it("acepta un monto dentro de lo cobrado", () => {
    expect(esquema.safeParse(base).success).toBe(true);
    expect(esquema.safeParse({ ...base, monto: 100 }).success).toBe(true);
  });

  it("rechaza devolver más de lo cobrado, cero o negativo", () => {
    expect(esquema.safeParse({ ...base, monto: 100.01 }).success).toBe(false);
    expect(esquema.safeParse({ ...base, monto: 0 }).success).toBe(false);
    expect(esquema.safeParse({ ...base, monto: -5 }).success).toBe(false);
  });

  it("exige motivo, sin contar espacios, y lo limita a 300 caracteres", () => {
    expect(esquema.safeParse({ ...base, motivo: "   " }).success).toBe(false);
    expect(esquema.safeParse({ ...base, motivo: "x".repeat(301) }).success).toBe(false);
    expect(esquema.safeParse({ ...base, motivo: "x".repeat(300) }).success).toBe(true);
  });
});

describe("esquemaDevolucion (lo que revalida el servidor)", () => {
  it("recorta el motivo y rechaza uno vacío", () => {
    const ok = esquemaDevolucion.safeParse({
      codigo: "P2611-001",
      monto: 10,
      metodo: "yape_plin",
      motivo: "  Producto con falla ",
    });
    expect(ok.success && ok.data.motivo).toBe("Producto con falla");

    expect(
      esquemaDevolucion.safeParse({ codigo: "P2611-001", monto: 10, metodo: "efectivo", motivo: " " }).success,
    ).toBe(false);
  });

  it("rechaza un método que no existe", () => {
    expect(
      esquemaDevolucion.safeParse({ codigo: "P2611-001", monto: 10, metodo: "cheque", motivo: "x" }).success,
    ).toBe(false);
  });
});

describe("devueltoDe", () => {
  it("suma las devoluciones del pedido", () => {
    const p = pedido({
      devoluciones: [
        { fecha: "2026-06-03", monto: 30, metodo: "efectivo", motivo: "a", usuario: "Ana" },
        { fecha: "2026-06-04", monto: 12.5, metodo: "yape_plin", motivo: "b", usuario: "Ana" },
      ],
    });
    expect(devueltoDe(p)).toBe(42.5);
    expect(devueltoDe(pedido({}))).toBe(0);
  });
});

describe("la caja descuenta lo devuelto", () => {
  const p = pedido({
    abonos: [
      { fecha: "2026-06-02", monto: 100, metodo: "efectivo", usuario: "Ana" },
      { fecha: "2026-06-05", monto: 50, metodo: "transferencia", usuario: "Ana" },
    ],
    devoluciones: [
      { fecha: "2026-06-10", monto: 30, metodo: "efectivo", motivo: "m", usuario: "Ana" },
      // Fuera del rango: no resta de junio.
      { fecha: "2026-07-01", monto: 999, metodo: "efectivo", motivo: "m", usuario: "Ana" },
    ],
  });

  it("cobradoEn es neto en el rango", () => {
    expect(cobradoEn([p], junio)).toBe(120);
  });

  it("cobradoPorMetodo resta por método y no deja barras negativas", () => {
    const filas = cobradoPorMetodo([p], junio);
    expect(filas.map((f) => [f.clave, f.monto])).toEqual([
      ["efectivo", 70],
      ["transferencia", 50],
    ]);

    const soloDevolvio = pedido({
      devoluciones: [{ fecha: "2026-06-10", monto: 30, metodo: "tarjeta", motivo: "m", usuario: "Ana" }],
    });
    expect(cobradoPorMetodo([soloDevolvio], junio)).toEqual([]);
    expect(cobradoEn([soloDevolvio], junio)).toBe(-30);
  });
});

describe("mensajeDeError", () => {
  it("traduce el tope de la devolución", () => {
    const msg = mensajeDeError({
      code: "P0001",
      message: "DEVOLUCION_EXCEDE: solo se cobró S/ 50.00",
      details: "",
      hint: "",
      name: "PostgrestError",
      toJSON: () => ({}),
    } as unknown as PostgrestError);
    expect(msg).toBe("No se puede devolver más de lo cobrado. Recarga la página.");
  });
});
