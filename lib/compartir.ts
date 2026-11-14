/**
 * Lo que se le manda al cliente por WhatsApp o Gmail, en texto plano: los
 * enlaces para abrir cada app con el mensaje ya escrito y el resumen de una
 * cotización.
 *
 * Un enlace de WhatsApp o de Gmail solo lleva texto. El PDF viaja como enlace
 * público (`/c/<token>/pdf`), que el cliente abre sin cuenta.
 *
 * Funciones puras: se usan igual en el navegador, en el PDF y en los tests.
 */

import { planchasTexto, resumenPiezas, tituloCorte, totalPiezas, type CorteGuardado } from "./cortes/guardado";
import { descripcionDeTerminado, tituloTerminado, type TerminadoGuardado } from "./terminados/guardado";
import { referenciaDe, sumaLineas, type Cotizacion } from "./cotizaciones";
import { fechaCompleta, money, numero } from "./formato";
import { diaEnLima } from "./fecha";

export const EMPRESA = "Plexiacril";

/* ── Teléfono y enlaces ────────────────────────────────────────────────────── */

/**
 * El número para `wa.me`: solo dígitos y con código de país. Un celular peruano
 * se escribe de 9 dígitos que empiezan por 9 ("981 342 705"); se le pone el 51.
 * Lo que ya trae código (+51…, o de otro país con +) se respeta. Lo que no se
 * entiende devuelve `null` y WhatsApp deja elegir el contacto.
 */
export function telefonoWhatsApp(telefono: string | null | undefined): string | null {
  if (!telefono) return null;
  const conMas = telefono.trim().startsWith("+");
  const digitos = telefono.replace(/\D/g, "");
  if (!digitos) return null;
  if (conMas) return digitos.length >= 8 ? digitos : null;
  if (digitos.length === 9 && digitos.startsWith("9")) return `51${digitos}`;
  if (digitos.length === 11 && digitos.startsWith("519")) return digitos;
  // Un fijo de Lima (01 xxx xxxx) o algo raro: mejor que la persona elija.
  return null;
}

/** Abre WhatsApp (app o web) con el mensaje escrito, al número si se sabe. */
export function enlaceWhatsApp(telefono: string | null | undefined, mensaje: string): string {
  const numero = telefonoWhatsApp(telefono);
  return `https://wa.me/${numero ?? ""}?text=${encodeURIComponent(mensaje)}`;
}

/** Abre la ventana de redactar de Gmail con asunto y cuerpo. */
export function enlaceGmail(asunto: string, cuerpo: string, para?: string | null): string {
  const q = new URLSearchParams({ view: "cm", fs: "1", su: asunto, body: cuerpo });
  if (para) q.set("to", para);
  return `https://mail.google.com/mail/?${q.toString()}`;
}

/* ── Cotización ────────────────────────────────────────────────────────────── */

type LineaParaTexto = {
  nombre: string;
  codigo: string | null;
  descripcion: string | null;
  cantidad: number;
  corte: CorteGuardado | null;
  terminado: TerminadoGuardado | null;
};

/** Una línea en dos partes: qué es y sus características. Sin precios. */
export function describirLinea(l: LineaParaTexto): { titulo: string; detalle: string | null; cantidad: string } {
  const limpio = (s: string | null | undefined) => s?.replace(/\s+/g, " ").trim() || null;
  if (l.corte) {
    const piezas = totalPiezas(l.corte.piezas);
    return {
      titulo: tituloCorte(l.corte),
      detalle: `${resumenPiezas(l.corte.piezas)} — ${planchasTexto(l.corte)}`,
      cantidad: `${piezas} ${piezas === 1 ? "pieza" : "piezas"}`,
    };
  }
  if (l.terminado) {
    return {
      titulo: tituloTerminado(l.terminado),
      detalle: limpio(descripcionDeTerminado(l.terminado)),
      cantidad: numero(l.cantidad),
    };
  }
  return {
    titulo: l.codigo ? `[${l.codigo}] ${l.nombre}` : l.nombre,
    detalle: limpio(l.descripcion),
    cantidad: numero(l.cantidad),
  };
}

type ParaCompartir = Pick<
  Cotizacion,
  "id" | "odooOrderName" | "cliente" | "creadoEn" | "lineas" | "montoTotal" | "montoSinImpuestos" | "montoImpuestos"
>;

/** El total que se le dice al cliente: el de Odoo, con impuestos; si aún no hay, la suma. */
export const totalDe = (c: Pick<Cotizacion, "montoTotal" | "lineas">) => c.montoTotal ?? sumaLineas(c.lineas);

/** "Cotizacion-S04254.pdf": ASCII, para el `filename` de la descarga. */
export const nombreArchivoCotizacion = (c: Pick<Cotizacion, "id" | "odooOrderName">, extension: "pdf" | "txt") =>
  `Cotizacion-${referenciaDe(c)}`.replace(/[^\w.\-]/g, "_") + `.${extension}`;

export const asuntoCotizacion = (c: ParaCompartir) => `Cotización ${referenciaDe(c)} — ${EMPRESA}`;

/** La cotización entera en texto: para descargar como .txt o pegar en un correo. */
export function textoCotizacion(c: ParaCompartir): string {
  const renglones: string[] = [
    `${EMPRESA.toUpperCase()} — Acrílicos de calidad`,
    `Cotización ${referenciaDe(c)}`,
    `Fecha: ${fechaCompleta(diaEnLima(c.creadoEn))}`,
    "",
    `Cliente: ${c.cliente.nombre}`,
  ];
  if (c.cliente.documento) renglones.push(`Documento: ${c.cliente.documento}`);
  renglones.push("", "PRODUCTOS");

  c.lineas.forEach((l, i) => {
    const { titulo, detalle, cantidad } = describirLinea(l);
    const precio = l.corte ? money(l.importe) : `${cantidad} × ${money(l.precioUnitario)} = ${money(l.importe)}`;
    renglones.push(`${i + 1}. ${titulo}`);
    if (detalle) renglones.push(`   ${detalle}`);
    renglones.push(`   ${precio}`);
  });

  renglones.push("");
  if (c.montoTotal !== null) {
    if (c.montoSinImpuestos !== null) renglones.push(`Subtotal: ${money(c.montoSinImpuestos)}`);
    if (c.montoImpuestos !== null) renglones.push(`IGV: ${money(c.montoImpuestos)}`);
    renglones.push(`TOTAL: ${money(c.montoTotal)}`);
  } else {
    renglones.push(`TOTAL: ${money(sumaLineas(c.lineas))}`);
  }
  return renglones.join("\n");
}

/** El mensaje corto de WhatsApp o del correo: saludo, total y el enlace al PDF. */
export function mensajeCotizacion(c: ParaCompartir, urlPdf: string): string {
  const nombre = primerNombre(c.cliente.nombre);
  return [
    `Hola${nombre ? ` ${nombre}` : ""}, te enviamos la cotización ${referenciaDe(c)} de ${EMPRESA}.`,
    `Total: ${money(totalDe(c))}`,
    "",
    `Puedes verla y descargarla aquí: ${urlPdf}`,
    "",
    "Cualquier consulta, estamos para ayudarte.",
  ].join("\n");
}

/* ── Seguimiento ───────────────────────────────────────────────────────────── */

export function mensajeSeguimiento(cliente: string, codigo: string, url: string): string {
  const nombre = primerNombre(cliente);
  return [
    `Hola${nombre ? ` ${nombre}` : ""}, puedes ver el estado de tu pedido ${codigo} de ${EMPRESA} en tiempo real aquí:`,
    url,
  ].join("\n");
}

export const asuntoSeguimiento = (codigo: string) => `Tu pedido ${codigo} — ${EMPRESA}`;

/**
 * "Juan" de "Juan Pérez"; nada si es una empresa (lleva S.A.C., E.I.R.L., …) o
 * si está en mayúsculas sostenidas, porque "Hola INVERSIONES" suena mal.
 */
export function primerNombre(nombre: string): string | null {
  const limpio = nombre.trim();
  if (!limpio) return null;
  if (/\b(S\.?A\.?C?|E\.?I\.?R\.?L|S\.?R\.?L|SOCIEDAD|EMPRESA|INVERSIONES|CORPORACI[OÓ]N|GRUPO)\b/i.test(limpio)) {
    return null;
  }
  const primero = limpio.split(/\s+/)[0];
  if (primero.length > 1 && primero === primero.toUpperCase()) {
    return primero.charAt(0) + primero.slice(1).toLowerCase();
  }
  return primero;
}
