import { describe, expect, it } from "vitest";
import {
  esquemaGuardarBorrador,
  haceCuanto,
  horasRestantes,
  leerDatos,
  resumenDe,
  rutaDeBorrador,
  type DatosBorradorCotizacion,
  type DatosBorradorPedido,
} from "./borradores";
import type { Linea } from "./lineas-cotizacion";

const producto: Linea = {
  clave: "a",
  productoId: 10,
  nombre: "ACRILICO 3MM",
  codigo: "AC-003",
  unidad: "Unidades",
  cantidad: 2,
  precioUnitario: 120,
  descripcion: "",
};

// Una línea de corte con lo mínimo que usa el resumen (el total del cálculo).
const corte = {
  tipo: "corte",
  clave: "b",
  grupoId: "g",
  material: "Acrílico",
  color: "Cristal",
  espesorMm: 3,
  rotable: true,
  modalidad: "laser",
  lugar: "taller",
  piezas: [{ ancho: 10, alto: 20, cantidad: 3 }],
  eleccion: null,
  calculo: { total: 55.5, formato: { codigo: "F1" } },
} as unknown as Linea;

const cliente = {
  id: 7,
  nombre: "Juan Pérez",
  documento: "12345678",
  telefono: null,
  email: null,
  ciudad: null,
  esEmpresa: false,
  empresa: null,
};

describe("resumenDe", () => {
  it("cuenta las líneas y suma productos y cortes", () => {
    expect(resumenDe(cliente, [producto, corte])).toEqual({ cliente: "Juan Pérez", productos: 2, total: 295.5 });
  });
  it("sin cliente ni líneas", () => {
    expect(resumenDe(null, [])).toEqual({ cliente: null, productos: 0, total: 0 });
  });
});

describe("leerDatos", () => {
  const cotizacion: DatosBorradorCotizacion = {
    version: 1,
    canal: "tienda",
    cliente,
    lineas: [producto, corte],
    notas: "pasa el viernes",
    disenosDeLinea: { b: "d1" },
  };
  const pedido: DatosBorradorPedido = {
    version: 1,
    cliente: null,
    lineas: [corte],
    campos: { destino: "local", fechaPrometida: "2026-11-20" },
    indicaciones: { b: "pulir cantos" },
    conObservaciones: true,
    disenosDeLinea: {},
    archivosOmitidos: ["plano.pdf"],
  };

  it("vuelve igual tras pasar por JSON (cotización y pedido)", () => {
    expect(leerDatos("cotizacion", JSON.parse(JSON.stringify(cotizacion)))).toEqual(cotizacion);
    expect(leerDatos("pedido", JSON.parse(JSON.stringify(pedido)))).toEqual(pedido);
  });

  it("rechaza datos del otro tipo o sin versión", () => {
    expect(leerDatos("pedido", cotizacion)).toBeNull();
    expect(leerDatos("cotizacion", { ...cotizacion, version: 2 })).toBeNull();
    expect(leerDatos("cotizacion", null)).toBeNull();
  });

  it("rechaza líneas sin clave", () => {
    expect(leerDatos("cotizacion", { ...cotizacion, lineas: [{ productoId: 1 }] })).toBeNull();
  });
});

describe("esquemaGuardarBorrador", () => {
  it("exige un id válido o null", () => {
    const base = { tipo: "pedido", cotizacionId: null, datos: {}, resumen: { cliente: null, productos: 0, total: 0 } };
    expect(esquemaGuardarBorrador.safeParse({ ...base, id: null }).success).toBe(true);
    expect(esquemaGuardarBorrador.safeParse({ ...base, id: "x" }).success).toBe(false);
    expect(esquemaGuardarBorrador.safeParse({ ...base, id: null, tipo: "otro" }).success).toBe(false);
  });
});

describe("plazos", () => {
  const ahora = Date.parse("2026-11-19T12:00:00Z");
  it("horasRestantes redondea hacia arriba y no baja de cero", () => {
    expect(horasRestantes("2026-11-21T12:00:00Z", ahora)).toBe(48);
    expect(horasRestantes("2026-11-19T12:30:00Z", ahora)).toBe(1);
    expect(horasRestantes("2026-11-19T11:00:00Z", ahora)).toBe(0);
  });
  it("haceCuanto", () => {
    expect(haceCuanto("2026-11-19T11:59:40Z", ahora)).toBe("hace un momento");
    expect(haceCuanto("2026-11-19T11:55:00Z", ahora)).toBe("hace 5 min");
    expect(haceCuanto("2026-11-19T09:00:00Z", ahora)).toBe("hace 3 h");
    expect(haceCuanto("2026-11-18T10:00:00Z", ahora)).toBe("hace 1 día");
  });
});

describe("rutaDeBorrador", () => {
  it("lleva al formulario con el borrador (y la cotización de la que sale el pedido)", () => {
    expect(rutaDeBorrador({ id: "x", tipo: "cotizacion", cotizacionId: null })).toBe("/cotizaciones/nueva?borrador=x");
    expect(rutaDeBorrador({ id: "x", tipo: "pedido", cotizacionId: null })).toBe("/pedidos/nuevo?borrador=x");
    expect(rutaDeBorrador({ id: "x", tipo: "pedido", cotizacionId: "c" })).toBe("/pedidos/nuevo?cotizacion=c&borrador=x");
  });
});
