import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  enlaceGmail,
  enlaceWhatsApp,
  mensajeCotizacion,
  mensajeSeguimiento,
  nombreArchivoCotizacion,
  primerNombre,
  telefonoWhatsApp,
  textoCotizacion,
} from "./compartir";
import { aWinAnsi, generarPdfCotizacion } from "./pdf-cotizacion";
import type { Cotizacion, LineaGuardada } from "./cotizaciones";
import { esquemaConfigCotizaciones, leerConfigCotizaciones } from "./cotizaciones-config";

const linea = (l: Partial<LineaGuardada>): LineaGuardada => ({
  posicion: 1,
  productoId: 10,
  nombre: "ACRILICO F8 CRISTAL 3MM",
  codigo: "AC-003",
  descripcion: null,
  cantidad: 2,
  precioUnitario: 120,
  corte: null,
  terminado: null,
  importe: 240,
  ...l,
});

const cotizacion = (c: Partial<Cotizacion> = {}): Cotizacion => ({
  id: "0f8fad5b-d9cb-469f-a165-70867728950e",
  canal: "tienda",
  cliente: { id: 1, nombre: "Juan Pérez", documento: "45678912", telefono: "981 342 705", contacto: null },
  odooOrderId: 7,
  odooOrderName: "S04254",
  sincronizacion: "sincronizada",
  errorSincronizacion: null,
  montoSinImpuestos: 338.98,
  montoImpuestos: 61.02,
  montoTotal: 400,
  notas: "No mostrar esto",
  chatAgenteId: null,
  creadoPor: "Ana",
  creadoEn: "2026-11-14T15:30:00Z",
  lineas: [
    linea({}),
    linea({ posicion: 2, codigo: null, nombre: "Servicio de pulido", descripcion: "cantos\nbrillantes", cantidad: 1, precioUnitario: 160, importe: 160 }),
  ],
  pedido: null,
  confirmadaEnOdoo: false,
  errorConfirmacion: null,
  tokenPublico: "b7d1c1a2-1111-4b5c-9d00-000000000001",
  almacenDespachoId: null,
  estado: "enviada",
  enviadaEn: null,
  version: 1,
  reemplazaA: null,
  errorEdicion: null,
  ...c,
});

describe("telefonoWhatsApp", () => {
  it("un celular peruano lleva el 51 delante", () => {
    expect(telefonoWhatsApp("981 342 705")).toBe("51981342705");
    expect(telefonoWhatsApp("981-342-705")).toBe("51981342705");
  });

  it("respeta el código que ya trae", () => {
    expect(telefonoWhatsApp("+51 981 342 705")).toBe("51981342705");
    expect(telefonoWhatsApp("51981342705")).toBe("51981342705");
    expect(telefonoWhatsApp("+34 612 345 678")).toBe("34612345678");
  });

  it("lo que no es un celular reconocible no se adivina", () => {
    expect(telefonoWhatsApp(null)).toBeNull();
    expect(telefonoWhatsApp("")).toBeNull();
    expect(telefonoWhatsApp("01 4567890")).toBeNull();
    expect(telefonoWhatsApp("12345")).toBeNull();
  });
});

describe("enlaces", () => {
  it("WhatsApp: al número, con el texto codificado", () => {
    expect(enlaceWhatsApp("981342705", "Hola & chau")).toBe("https://wa.me/51981342705?text=Hola%20%26%20chau");
  });

  it("WhatsApp sin número deja elegir el contacto", () => {
    expect(enlaceWhatsApp(null, "Hola")).toBe("https://wa.me/?text=Hola");
  });

  it("Gmail abre la ventana de redactar con asunto y cuerpo", () => {
    const url = new URL(enlaceGmail("Cotización S04254", "Línea 1\nLínea 2"));
    expect(url.origin).toBe("https://mail.google.com");
    expect(url.searchParams.get("view")).toBe("cm");
    expect(url.searchParams.get("su")).toBe("Cotización S04254");
    expect(url.searchParams.get("body")).toBe("Línea 1\nLínea 2");
    expect(url.searchParams.has("to")).toBe(false);
  });
});

describe("primerNombre", () => {
  it("saluda por el nombre", () => {
    expect(primerNombre("Juan Pérez")).toBe("Juan");
    expect(primerNombre("MARIA LOPEZ")).toBe("Maria");
  });

  it("a una empresa no se la saluda por su primera palabra", () => {
    expect(primerNombre("INVERSIONES LUMA S.A.C.")).toBeNull();
    expect(primerNombre("Grupo Andino")).toBeNull();
    expect(primerNombre("  ")).toBeNull();
  });
});

describe("textoCotizacion", () => {
  it("lleva la referencia, el cliente, cada línea y los totales de Odoo", () => {
    const t = textoCotizacion(cotizacion());
    expect(t).toContain("Cotización S04254");
    expect(t).toContain("Cliente: Juan Pérez");
    expect(t).toContain("Documento: 45678912");
    expect(t).toContain("1. [AC-003] ACRILICO F8 CRISTAL 3MM");
    expect(t).toContain("2. Servicio de pulido");
    expect(t).toContain("   cantos brillantes");
    expect(t).toMatch(/IGV: S\/\s?61\.02/);
    expect(t).toMatch(/TOTAL: S\/\s?400\.00/);
  });

  it("dice hasta cuándo vale: 15 días por defecto, o lo configurado", () => {
    // Emitida el 14/11 a las 10:30 de Lima.
    expect(textoCotizacion(cotizacion())).toContain("Cotización válida por 15 días (hasta el 29/11/2026).");
    expect(textoCotizacion(cotizacion(), 1)).toContain("Cotización válida por 1 día (hasta el 15/11/2026).");
  });

  it("la fecha de emisión es la de Lima, no la de UTC", () => {
    // 02:00 UTC del 15/11 son las 21:00 del 14/11 en Lima.
    const t = textoCotizacion(cotizacion({ creadoEn: "2026-11-15T02:00:00Z" }), 7);
    expect(t).toContain("Fecha: 14/11/2026");
    expect(t).toContain("(hasta el 21/11/2026)");
  });

  it("no filtra las notas internas", () => {
    expect(textoCotizacion(cotizacion())).not.toContain("No mostrar esto");
  });

  it("sin total de Odoo, suma las líneas", () => {
    const t = textoCotizacion(cotizacion({ montoTotal: null, montoSinImpuestos: null, montoImpuestos: null }));
    expect(t).toMatch(/TOTAL: S\/\s?400\.00/);
    expect(t).not.toContain("IGV");
  });
});

describe("mensajes", () => {
  it("la cotización: saludo, referencia, total y enlace", () => {
    const m = mensajeCotizacion(cotizacion(), "https://app.test/c/x/pdf");
    expect(m).toMatch(/^Hola Juan, te enviamos la cotización S04254/);
    expect(m).toContain("https://app.test/c/x/pdf");
    expect(m).toMatch(/Total: S\/\s?400\.00/);
  });

  it("el seguimiento: código y enlace", () => {
    const m = mensajeSeguimiento("Juan Pérez", "LCL_0001_ABCD", "https://app.test/seguimiento/x");
    expect(m).toContain("Hola Juan");
    expect(m).toContain("LCL_0001_ABCD");
    expect(m.endsWith("https://app.test/seguimiento/x")).toBe(true);
  });

  it("el nombre del archivo es ASCII", () => {
    expect(nombreArchivoCotizacion(cotizacion(), "pdf")).toBe("Cotizacion-S04254.pdf");
    expect(nombreArchivoCotizacion(cotizacion({ odooOrderName: null }), "txt")).toBe("Cotizacion-Borrador_0f8fad5b.txt");
  });
});

describe("PDF", () => {
  it("cambia lo que Helvetica no dibuja y deja tildes, ñ y ×", () => {
    expect(aWinAnsi("Año · 30×20 cm — ↳ ok")).toBe("Año · 30×20 cm — - ok");
    expect(aWinAnsi("Ştefan 中")).toBe("Stefan ?");
  });

  it("genera un PDF válido, con logo y con muchas líneas (salto de página)", async () => {
    const logo = new Uint8Array(readFileSync(new URL("../public/logo-plexiacril.png", import.meta.url)));
    const muchas = Array.from({ length: 40 }, (_, i) =>
      linea({ posicion: i + 1, descripcion: "Una descripción larga ".repeat(8) }),
    );
    const bytes = await generarPdfCotizacion(cotizacion({ lineas: muchas }), logo, { validezDias: 30 });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });
});

describe("leerConfigCotizaciones", () => {
  it("sin nada guardado, 15 días", () => {
    expect(leerConfigCotizaciones(null)).toEqual({ validezDias: 15 });
    expect(leerConfigCotizaciones({})).toEqual({ validezDias: 15 });
  });

  it("respeta lo guardado y descarta lo que no sirve", () => {
    expect(leerConfigCotizaciones({ validezDias: 30 })).toEqual({ validezDias: 30 });
    expect(leerConfigCotizaciones({ validezDias: "7" })).toEqual({ validezDias: 7 });
    expect(leerConfigCotizaciones({ validezDias: 0 })).toEqual({ validezDias: 15 });
    expect(leerConfigCotizaciones({ validezDias: 2.5 })).toEqual({ validezDias: 15 });
    expect(leerConfigCotizaciones({ validezDias: "nada" })).toEqual({ validezDias: 15 });
  });

  it("el esquema del formulario rechaza fuera de rango", () => {
    expect(esquemaConfigCotizaciones.safeParse({ validezDias: "400" }).success).toBe(false);
    expect(esquemaConfigCotizaciones.safeParse({ validezDias: "20" }).data).toEqual({ validezDias: 20 });
  });
});
