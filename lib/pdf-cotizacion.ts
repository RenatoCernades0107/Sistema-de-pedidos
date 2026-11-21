/**
 * El PDF de una cotización, hecho por la app: sirve para todas, las del
 * formulario y las del asistente, estén o no en Odoo.
 *
 * Con `pdf-lib` y las fuentes estándar del PDF (Helvetica): nada que instalar ni
 * que descargar, corre en cualquier route handler de Node. Esas fuentes solo
 * saben escribir WinAnsi (latín-1 más comillas, guiones y €): las tildes, la ñ,
 * el × y el · entran; lo demás se cambia por un equivalente (`aWinAnsi`).
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type PDFImage } from "pdf-lib";
import { referenciaDe, sumaLineas, type Cotizacion } from "./cotizaciones";
import { describirLinea, EMPRESA } from "./compartir";
import { fechaCompleta, money } from "./formato";
import { diaEnLima } from "./fecha";
import { textoValidez, VALIDEZ_POR_DEFECTO } from "./cotizaciones-config";
import { tituloCuenta, type CuentaParaPdf } from "./cuentas-bancarias";

type ParaPdf = Pick<
  Cotizacion,
  "id" | "odooOrderName" | "cliente" | "creadoEn" | "lineas" | "montoTotal" | "montoSinImpuestos" | "montoImpuestos"
>;

/* ── Texto que la fuente sabe escribir ─────────────────────────────────────── */

const EXTRA_WINANSI = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");
const EQUIVALENTES: Record<string, string> = {
  "↳": "-",
  "→": "->",
  "≈": "~",
  "≤": "<=",
  "≥": ">=",
  " ": " ",
  " ": " ",
};

/** Lo que Helvetica estándar no puede dibujar, cambiado por algo que sí. */
export function aWinAnsi(s: string): string {
  let salida = "";
  for (const ch of s.normalize("NFC")) {
    const code = ch.codePointAt(0)!;
    if (ch === "\n" || ch === "\t") salida += " ";
    else if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || EXTRA_WINANSI.has(ch)) salida += ch;
    else if (EQUIVALENTES[ch]) salida += EQUIVALENTES[ch];
    else {
      // Una letra con un acento raro (ă, ő…) pierde el acento; lo demás, "?".
      const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
      salida += /^[\x20-\x7e]$/.test(base) ? base : "?";
    }
  }
  return salida;
}

/** Corta un texto en renglones que caben en `ancho`. Una palabra más larga que el renglón se parte. */
export function partirEnRenglones(texto: string, fuente: PDFFont, tamano: number, ancho: number): string[] {
  const mide = (s: string) => fuente.widthOfTextAtSize(s, tamano);
  const renglones: string[] = [];
  for (const parrafo of aWinAnsi(texto).split(/\r?\n/)) {
    let actual = "";
    for (const palabra of parrafo.split(/\s+/).filter(Boolean)) {
      const tentativa = actual ? `${actual} ${palabra}` : palabra;
      if (mide(tentativa) <= ancho) {
        actual = tentativa;
        continue;
      }
      if (actual) renglones.push(actual);
      // La palabra sola tampoco cabe: se parte por caracteres.
      let resto = palabra;
      while (mide(resto) > ancho) {
        let corte = resto.length - 1;
        while (corte > 1 && mide(resto.slice(0, corte)) > ancho) corte--;
        renglones.push(resto.slice(0, corte));
        resto = resto.slice(corte);
      }
      actual = resto;
    }
    if (actual) renglones.push(actual);
  }
  return renglones.length ? renglones : [""];
}

/* ── Dibujo ────────────────────────────────────────────────────────────────── */

const A4: [number, number] = [595.28, 841.89];
const MARGEN = 48;
const AZUL = rgb(0.07, 0.24, 0.53);
const GRIS = rgb(0.42, 0.45, 0.5);
const LINEA = rgb(0.86, 0.88, 0.91);
const FONDO = rgb(0.96, 0.97, 0.98);
const NEGRO = rgb(0.1, 0.11, 0.13);

/** Las columnas de la tabla: dónde empieza cada una. */
const COL = {
  n: MARGEN,
  desc: MARGEN + 22,
  cant: 340,
  unit: 410,
  importe: A4[0] - MARGEN,
};
const ANCHO_DESC = COL.cant - COL.desc - 12;

export async function generarPdfCotizacion(
  c: ParaPdf,
  logoPng?: Uint8Array | null,
  { validezDias = VALIDEZ_POR_DEFECTO, cuentas = [] }: { validezDias?: number; cuentas?: CuentaParaPdf[] } = {},
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const referencia = referenciaDe(c);
  pdf.setTitle(aWinAnsi(`Cotización ${referencia}`));
  pdf.setAuthor(EMPRESA);
  pdf.setCreator(EMPRESA);

  const normal = await pdf.embedFont(StandardFonts.Helvetica);
  const negrita = await pdf.embedFont(StandardFonts.HelveticaBold);
  let logo: PDFImage | null = null;
  if (logoPng) {
    try {
      logo = await pdf.embedPng(logoPng);
    } catch {
      logo = null; // Sin logo, el PDF igual sirve.
    }
  }

  let pagina: PDFPage = pdf.addPage(A4);
  let y = A4[1] - MARGEN;

  const escribir = (
    texto: string,
    x: number,
    yy: number,
    { fuente = normal, tamano = 10, color = NEGRO, derecha = false } = {},
  ) => {
    const t = aWinAnsi(texto);
    const xx = derecha ? x - fuente.widthOfTextAtSize(t, tamano) : x;
    pagina.drawText(t, { x: xx, y: yy, size: tamano, font: fuente, color });
  };

  const raya = (yy: number, color = LINEA, grosor = 0.75) =>
    pagina.drawLine({ start: { x: MARGEN, y: yy }, end: { x: A4[0] - MARGEN, y: yy }, thickness: grosor, color });

  /* Cabecera de la primera hoja: logo y referencia. */
  const altoLogo = 46;
  if (logo) {
    const escala = altoLogo / logo.height;
    pagina.drawImage(logo, { x: MARGEN, y: y - altoLogo, width: logo.width * escala, height: altoLogo });
  } else {
    escribir(EMPRESA.toUpperCase(), MARGEN, y - 24, { fuente: negrita, tamano: 22, color: AZUL });
  }
  escribir("COTIZACIÓN", A4[0] - MARGEN, y - 14, { fuente: negrita, tamano: 18, color: AZUL, derecha: true });
  escribir(referencia, A4[0] - MARGEN, y - 30, { fuente: negrita, tamano: 11, derecha: true });
  escribir(`Fecha: ${fechaCompleta(diaEnLima(c.creadoEn))}`, A4[0] - MARGEN, y - 44, { tamano: 9, color: GRIS, derecha: true });
  y -= altoLogo + 18;
  raya(y, AZUL, 1.5);
  y -= 22;

  /* Cliente. */
  escribir("CLIENTE", MARGEN, y, { fuente: negrita, tamano: 8, color: GRIS });
  y -= 15;
  for (const r of partirEnRenglones(c.cliente.nombre, negrita, 12, A4[0] - 2 * MARGEN)) {
    escribir(r, MARGEN, y, { fuente: negrita, tamano: 12 });
    y -= 15;
  }
  if (c.cliente.documento) {
    escribir(`Documento: ${c.cliente.documento}`, MARGEN, y, { tamano: 10, color: GRIS });
    y -= 14;
  }
  y -= 12;

  /* Tabla. */
  const cabeceraTabla = () => {
    pagina.drawRectangle({ x: MARGEN, y: y - 6, width: A4[0] - 2 * MARGEN, height: 20, color: FONDO });
    const op = { fuente: negrita, tamano: 8, color: GRIS };
    escribir("#", COL.n + 4, y, op);
    escribir("DESCRIPCIÓN", COL.desc, y, op);
    escribir("CANT.", COL.cant + 50, y, { ...op, derecha: true });
    escribir("P. UNIT.", COL.importe - 80, y, { ...op, derecha: true });
    escribir("IMPORTE", COL.importe, y, { ...op, derecha: true });
    y -= 24;
  };

  const nuevaPagina = () => {
    pagina = pdf.addPage(A4);
    y = A4[1] - MARGEN;
    escribir(`Cotización ${referencia} (continuación)`, MARGEN, y, { fuente: negrita, tamano: 10, color: GRIS });
    y -= 24;
    cabeceraTabla();
  };

  cabeceraTabla();

  c.lineas.forEach((l, i) => {
    const { titulo, detalle, cantidad } = describirLinea(l);
    const rTitulo = partirEnRenglones(titulo, negrita, 10, ANCHO_DESC);
    const rDetalle = detalle ? partirEnRenglones(detalle, normal, 8.5, ANCHO_DESC) : [];
    const alto = rTitulo.length * 13 + rDetalle.length * 11 + 10;

    if (y - alto < MARGEN + 40) nuevaPagina();

    const arriba = y;
    escribir(String(i + 1), COL.n + 4, y, { tamano: 9, color: GRIS });
    escribir(cantidad, COL.cant + 50, y, { tamano: 10, derecha: true });
    // En un corte, el precio es el del trabajo entero: no hay unitario que mostrar.
    if (!l.corte) escribir(money(l.precioUnitario), COL.importe - 80, y, { tamano: 10, derecha: true });
    escribir(money(l.importe), COL.importe, y, { fuente: negrita, tamano: 10, derecha: true });

    for (const r of rTitulo) {
      escribir(r, COL.desc, y, { fuente: negrita, tamano: 10 });
      y -= 13;
    }
    for (const r of rDetalle) {
      escribir(r, COL.desc, y + 1, { tamano: 8.5, color: GRIS });
      y -= 11;
    }
    y = Math.min(y, arriba - 13) - 6;
    raya(y + 2);
    y -= 12;
  });

  /* Totales. */
  const filas: [string, number, boolean][] =
    c.montoTotal !== null
      ? [
          ...(c.montoSinImpuestos !== null ? [["Subtotal", c.montoSinImpuestos, false] as [string, number, boolean]] : []),
          ...(c.montoImpuestos !== null ? [["IGV", c.montoImpuestos, false] as [string, number, boolean]] : []),
          ["TOTAL", c.montoTotal, true],
        ]
      : [["TOTAL", sumaLineas(c.lineas), true]];

  if (y - filas.length * 18 < MARGEN + 40) {
    pagina = pdf.addPage(A4);
    y = A4[1] - MARGEN;
  }
  y -= 4;
  for (const [etiqueta, valor, fuerte] of filas) {
    if (fuerte) {
      pagina.drawRectangle({ x: COL.unit - 40, y: y - 7, width: COL.importe - COL.unit + 40 + 0.5, height: 22, color: AZUL });
      escribir(etiqueta, COL.unit - 32, y, { fuente: negrita, tamano: 11, color: rgb(1, 1, 1) });
      escribir(money(valor), COL.importe - 8, y, { fuente: negrita, tamano: 12, color: rgb(1, 1, 1), derecha: true });
      y -= 26;
    } else {
      escribir(etiqueta, COL.unit - 32, y, { tamano: 10, color: GRIS });
      escribir(money(valor), COL.importe - 8, y, { tamano: 10, derecha: true });
      y -= 17;
    }
  }

  /* Validez, debajo de los totales. */
  if (y < MARGEN + 40) {
    pagina = pdf.addPage(A4);
    y = A4[1] - MARGEN;
  }
  y -= 8;
  escribir(textoValidez(c.creadoEn, validezDias), MARGEN, y, { fuente: negrita, tamano: 9, color: AZUL });

  /* Cuentas para depositar. Cada cuenta en un bloque que no se parte entre hojas. */
  if (cuentas.length) {
    const ALTO_CUENTA = 30;
    const ALTO_AVISO = 24;
    y -= 26;
    if (y - 16 - ALTO_CUENTA - ALTO_AVISO < MARGEN + 10) {
      pagina = pdf.addPage(A4);
      y = A4[1] - MARGEN;
    }
    escribir("CUENTAS PARA DEPÓSITO", MARGEN, y, { fuente: negrita, tamano: 8, color: GRIS });
    y -= 6;
    raya(y);
    y -= 14;
    for (const cuenta of cuentas) {
      if (y - ALTO_CUENTA < MARGEN + 10) {
        pagina = pdf.addPage(A4);
        y = A4[1] - MARGEN;
      }
      escribir(tituloCuenta(cuenta), MARGEN, y, { fuente: negrita, tamano: 9.5 });
      y -= 13;
      const numeros = `N.° ${cuenta.numero}${cuenta.cci ? `     CCI ${cuenta.cci}` : ""}`;
      escribir(numeros, MARGEN, y, { tamano: 9.5 });
      y -= ALTO_CUENTA - 13;
    }
    if (y - ALTO_AVISO < MARGEN + 10) {
      pagina = pdf.addPage(A4);
      y = A4[1] - MARGEN;
    }
    // Lo que frena la estafa más común: alguien que le escribe al cliente "pague
    // mejor a esta otra cuenta".
    for (const r of partirEnRenglones(
      `Solo recibimos pagos en estas cuentas. Si alguien te indica otra, no deposites y confírmalo antes con ${EMPRESA}.`,
      normal,
      8.5,
      A4[0] - 2 * MARGEN,
    )) {
      escribir(r, MARGEN, y, { tamano: 8.5, color: GRIS });
      y -= 11;
    }
  }

  /* Pie de cada hoja. */
  const hojas = pdf.getPages();
  hojas.forEach((h, i) => {
    pagina = h;
    escribir(`${EMPRESA} — Acrílicos de calidad · Precios en soles (PEN)`, MARGEN, MARGEN - 18, {
      tamano: 8,
      color: GRIS,
    });
    escribir(`Página ${i + 1} de ${hojas.length}`, A4[0] - MARGEN, MARGEN - 18, {
      tamano: 8,
      color: GRIS,
      derecha: true,
    });
  });

  return pdf.save();
}
