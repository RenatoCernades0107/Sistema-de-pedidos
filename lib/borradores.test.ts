import { describe, expect, it } from "vitest";
import {
  esquemaGuardarBorrador,
  haceCuanto,
  horasRestantes,
  leerDatos,
  resumenDe,
  rutaDeBorrador,
  type DatosBorradorCompra,
  type DatosBorradorCotizacion,
  type DatosBorradorPedido,
} from "./borradores";
import { compraTieneContenido, resumenDeCompra } from "./borradores-compra";
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

describe("borrador de compra", () => {
  const vacia: DatosBorradorCompra = {
    version: 1,
    tipo: "nacional",
    proveedor: null,
    almacenId: null,
    documento: "",
    moneda: "PEN",
    tcMerc: "3.75",
    tcGastos: "3.75",
    incoterm: null,
    condicion: "contado",
    dias: "",
    embarque: "",
    llegada: "",
    nota: "",
    filas: [],
  };
  const fila = { productoId: 5, codigo: "F7E024", titulo: "Eco cristal 3", cantidad: "10", kilos: "", precio: "1,5", total: "" };

  it("el formulario de fábrica no cuenta como contenido", () => {
    expect(compraTieneContenido(vacia)).toBe(false);
    expect(compraTieneContenido({ ...vacia, nota: "   ", documento: " " })).toBe(false);
  });

  it("cualquier cosa escrita o elegida sí", () => {
    expect(compraTieneContenido({ ...vacia, proveedor: cliente })).toBe(true);
    expect(compraTieneContenido({ ...vacia, almacenId: "a" })).toBe(true);
    expect(compraTieneContenido({ ...vacia, documento: "PI-1" })).toBe(true);
    expect(compraTieneContenido({ ...vacia, nota: "negociar" })).toBe(true);
    expect(compraTieneContenido({ ...vacia, llegada: "2026-12-01" })).toBe(true);
    expect(compraTieneContenido({ ...vacia, filas: [fila] })).toBe(true);
  });

  it("vuelve igual tras pasar por JSON, aunque esté incompleta", () => {
    const d: DatosBorradorCompra = { ...vacia, proveedor: cliente, filas: [fila], moneda: "USD", incoterm: "FOB", tipo: "importacion" };
    expect(leerDatos("compra", JSON.parse(JSON.stringify(d)))).toEqual(d);
  });

  it("rechaza datos de otro tipo o con valores fuera de catálogo", () => {
    expect(leerDatos("compra", { ...vacia, version: 2 })).toBeNull();
    expect(leerDatos("compra", { ...vacia, moneda: "EUR" })).toBeNull();
    expect(leerDatos("compra", null)).toBeNull();
    expect(leerDatos("pedido", vacia)).toBeNull();
  });

  it("el resumen suma cantidad × precio, tolera filas a medias y lleva la moneda", () => {
    const r = resumenDeCompra({ proveedor: cliente, moneda: "USD", filas: [fila, { ...fila, productoId: 6, cantidad: "", precio: "" }] });
    expect(r).toEqual({ cliente: "Juan Pérez", productos: 2, total: 15, moneda: "USD" });
    expect(resumenDeCompra({ proveedor: null, moneda: "PEN", filas: [] })).toEqual({ cliente: null, productos: 0, total: 0, moneda: "PEN" });
  });

  it("guardar acepta el tipo compra y la ruta retoma en /compras/nueva", () => {
    const base = { id: null, cotizacionId: null, datos: {}, resumen: { cliente: null, productos: 0, total: 0, moneda: "PEN" } };
    expect(esquemaGuardarBorrador.safeParse({ ...base, tipo: "compra" }).success).toBe(true);
    expect(rutaDeBorrador({ id: "x", tipo: "compra", cotizacionId: null })).toBe("/compras/nueva?borrador=x");
  });
});
