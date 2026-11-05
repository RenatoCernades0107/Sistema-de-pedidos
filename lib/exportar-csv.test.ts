import { describe, expect, it } from "vitest";
import { ROLES, type Pedido } from "./dominio";
import { celdaCsv, nombreArchivoCsv, pedidosACsv } from "./exportar-csv";

const pedido = (extra: Partial<Pedido> = {}): Pedido => ({
  codigo: "LCL_2026_H4TP",
  cliente: "Corporación Andina SAC",
  telefonoCliente: "981 342 705",
  tipos: ["CL"],
  producto: null,
  cantidad: 12,
  estado: "en_proceso",
  ubicacion: "taller",
  entrega: "tienda",
  fechaPrometida: "2026-08-30",
  fechaCreacion: "2026-08-24",
  tipoPago: "a_cuenta",
  plazoCredito: null,
  montoTotal: 1250,
  montoPagado: 600,
  responsable: "Angel",
  responsableId: "r1",
  detalle: "12 placas 60x40, grabado del logo",
  observaciones: null,
  numeroComprobante: "F001-004512",
  tieneComprobante: true,
  esProvincia: false,
  adjuntos: [{ id: "a1", tipo: "diseno", nombre: "plano.pdf", peso: "840 KB" }],
  abonos: [{ fecha: "2026-08-24", monto: 600, metodo: "efectivo", usuario: "Ana Torres" }],
  historial: [
    {
      estado: "registrado",
      usuario: "Ana Torres",
      rol: "administracion",
      fecha: "2026-08-24T08:30",
    },
  ],
  auditoria: [],
  creadoPorMi: false,
  ...extra,
});

/** Separa la cabecera de las filas sin pelearse con los saltos dentro de comillas. */
const cabecera = (csv: string) => csv.slice(1).split("\r\n")[0].split(",");

describe("celdaCsv", () => {
  it("deja el texto plano y escapa comas, comillas y saltos de línea", () => {
    expect(celdaCsv("hola")).toBe("hola");
    expect(celdaCsv("a,b")).toBe('"a,b"');
    expect(celdaCsv('dijo "sí"')).toBe('"dijo ""sí"""');
    expect(celdaCsv("uno\ndos")).toBe('"uno\ndos"');
  });

  it("vacía null y undefined, y no toca los números", () => {
    expect(celdaCsv(null)).toBe("");
    expect(celdaCsv(undefined)).toBe("");
    expect(celdaCsv(2.5)).toBe("2.5");
    expect(celdaCsv(-3)).toBe("-3");
  });

  it("neutraliza el texto que Excel ejecutaría como fórmula", () => {
    expect(celdaCsv("=HYPERLINK(\"http://x\")")).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(celdaCsv("+51 999 888 777")).toBe("'+51 999 888 777");
    expect(celdaCsv("@cmd")).toBe("'@cmd");
    expect(celdaCsv("-10 placas")).toBe("'-10 placas");
  });

  it("deja pasar un importe negativo en texto", () => {
    expect(celdaCsv("-50.00")).toBe("-50.00");
  });
});

describe("pedidosACsv", () => {
  it("empieza con BOM, termina cada fila con CRLF y trae una fila por pedido", () => {
    const csv = pedidosACsv([pedido(), pedido({ codigo: "OTRO" })], ROLES.administracion);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.trim().split("\r\n")).toHaveLength(3);
  });

  it("con una lista vacía deja solo la cabecera", () => {
    const csv = pedidosACsv([], ROLES.administracion);
    expect(csv.trim().split("\r\n")).toHaveLength(1);
  });

  it("Administración se lleva cliente, montos, comprobante y abonos", () => {
    const csv = pedidosACsv([pedido()], ROLES.administracion);
    const cols = cabecera(csv);
    expect(cols).toEqual(
      expect.arrayContaining(["Cliente", "Monto total", "Saldo", "Abonos", "Comprobante"]),
    );
    expect(csv).toContain("Corporación Andina SAC");
    expect(csv).toContain("1250.00");
    expect(csv).toContain("650.00");
    expect(csv).toContain("24/08/2026 · S/ 600.00 · Efectivo · Ana Torres");
    expect(csv).toContain("F001-004512");
  });

  it("Operaciones no se lleva teléfono, montos, comprobante ni datos de la agencia", () => {
    const envio = {
      departamento: "La Libertad",
      provincia: "Trujillo",
      departamentoId: 1,
      provinciaId: 2,
      agencia: "Shalom",
      personaQueRecoge: "Marisol Vega",
      tipoDocumento: "DNI" as const,
      numeroDocumento: "44821903",
      telefono: "958 447 210",
      montoFlete: 120,
      fletePagado: true,
    };
    const csv = pedidosACsv([pedido({ esProvincia: true, envio })], ROLES.operaciones);
    const cols = cabecera(csv);

    for (const oculta of [
      "Teléfono del cliente",
      "Monto total",
      "Saldo",
      "Abonos",
      "Comprobante",
      "Agencia",
      "Flete",
      "Auditoría",
    ]) {
      expect(cols).not.toContain(oculta);
    }
    // El destino sí: es lo que el taller ve como "Destino".
    expect(cols).toEqual(expect.arrayContaining(["Departamento", "Provincia"]));
    for (const secreto of ["981 342 705", "Shalom", "44821903", "958 447 210", "1250.00"]) {
      expect(csv).not.toContain(secreto);
    }
  });

  it("Logística ve el envío completo pero no los montos", () => {
    const cols = cabecera(pedidosACsv([pedido()], ROLES.logistica));
    expect(cols).toEqual(expect.arrayContaining(["Agencia", "Teléfono del cliente"]));
    expect(cols).not.toContain("Monto total");
  });

  it("incluye el historial con su motivo y los adjuntos con su tipo", () => {
    const csv = pedidosACsv(
      [
        pedido({
          estado: "anulado",
          historial: [
            {
              estado: "anulado",
              usuario: "Ana Torres",
              rol: "administracion",
              fecha: "2026-08-25T10:00",
              motivo: "El cliente desistió",
            },
          ],
        }),
      ],
      ROLES.administracion,
    );
    expect(csv).toContain("25/08/2026 10:00 · Anulado · Ana Torres (Administración) · El cliente desistió");
    expect(csv).toContain("Diseño: plano.pdf (840 KB)");
  });

  it("un saldo a favor negativo sale como número, no como texto", () => {
    const csv = pedidosACsv([pedido({ montoPagado: 1300 })], ROLES.administracion);
    expect(csv).toContain(",-50.00,");
  });
});

describe("nombreArchivoCsv", () => {
  it("lleva la fecha del día", () => {
    expect(nombreArchivoCsv("2026-08-31")).toBe("pedidos-2026-08-31.csv");
  });
});
