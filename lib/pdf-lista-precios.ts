/**
 * El PDF de la lista de precios, en tres diseños:
 *
 * - **Clásico**: como la lista de siempre. Franjas en las esquinas, tablas con
 *   bordes y las celdas de medida, espesor y precio unidas.
 * - **Moderno**: banda de color abajo, cada material con su título y sus notas
 *   como etiquetas, y filas alternadas sin bordes.
 * - **Catálogo**: a dos columnas, estilo menú (color … código precio), para
 *   que la lista entera entre en pocas hojas.
 *
 * Con `pdf-lib` y Helvetica, igual que el PDF de la cotización (`aWinAnsi`
 * cambia lo que esa fuente no sabe escribir).
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from "pdf-lib";
import { EMPRESA } from "./compartir";
import { fechaCompleta } from "./formato";
import {
  tramosDePrecio,
  type BloquePlanchas,
  type DisenoLista,
  type FilaPlancha,
  type ListaPrecios,
  type SeccionAccesorios,
  type SeccionLista,
  type SeccionPlanchas,
} from "./lista-precios";
import { aWinAnsi, partirEnRenglones } from "./pdf-cotizacion";

/* ── Lo común ──────────────────────────────────────────────────────────────── */

const A4: [number, number] = [595.28, 841.89];
const [ANCHO, ALTO] = A4;

/** Los colores del logo. */
const AZUL = rgb(31 / 255, 21 / 255, 196 / 255);
const AMARILLO = rgb(226 / 255, 203 / 255, 1 / 255);
const NEGRO = rgb(0.1, 0.11, 0.13);
const GRIS = rgb(0.42, 0.45, 0.5);
const LINEA = rgb(0.84, 0.86, 0.9);
const FONDO = rgb(0.955, 0.965, 0.98);
const AZUL_CLARO = rgb(0.9, 0.935, 0.97);
const AMARILLO_CLARO = rgb(1, 0.95, 0.8);
const BLANCO = rgb(1, 1, 1);

interface Fuentes {
  normal: PDFFont;
  negrita: PDFFont;
  cursiva: PDFFont;
}

const enteros = new Intl.NumberFormat("es-PE", { maximumFractionDigits: 0 });
const decimales = new Intl.NumberFormat("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "1,195" o "49.50": sin céntimos cuando no los hay, como en la lista de siempre. */
export const precioLista = (n: number) => (Number.isInteger(n) ? enteros : decimales).format(n);

type Alineacion = "izquierda" | "centro" | "derecha";

function escribir(
  pagina: PDFPage,
  texto: string,
  x: number,
  y: number,
  { fuente, tamano = 9, color = NEGRO, alinear = "izquierda" as Alineacion }: { fuente: PDFFont; tamano?: number; color?: RGB; alinear?: Alineacion },
) {
  const t = aWinAnsi(texto);
  const ancho = fuente.widthOfTextAtSize(t, tamano);
  const xx = alinear === "derecha" ? x - ancho : alinear === "centro" ? x - ancho / 2 : x;
  pagina.drawText(t, { x: xx, y, size: tamano, font: fuente, color });
  return ancho;
}

/** El texto cortado con "…" para que quepa en `ancho`. */
function recortar(texto: string, fuente: PDFFont, tamano: number, ancho: number): string {
  const t = aWinAnsi(texto);
  if (fuente.widthOfTextAtSize(t, tamano) <= ancho) return t;
  let n = t.length;
  while (n > 1 && fuente.widthOfTextAtSize(`${t.slice(0, n)}…`, tamano) > ancho) n--;
  return `${t.slice(0, n).trimEnd()}…`;
}

/** La línea base para que un texto quede centrado en una celda de `alto` que empieza en `arriba`. */
const baseCentrada = (arriba: number, alto: number, tamano: number) => arriba - alto / 2 - tamano * 0.35;

/** Un polígono en coordenadas del PDF (y hacia arriba). */
function poligono(pagina: PDFPage, puntos: [number, number][], color: RGB) {
  const d = puntos.map(([x, y], i) => `${i ? "L" : "M"} ${x} ${-y}`).join(" ") + " Z";
  pagina.drawSvgPath(d, { x: 0, y: 0, color, borderWidth: 0 });
}

/** Un rectángulo de esquinas redondeadas; `y` es el borde de abajo. */
function rectRedondo(pagina: PDFPage, x: number, y: number, w: number, h: number, r: number, color: RGB) {
  const t = -(y + h);
  const d = [
    `M ${x + r} ${t}`,
    `L ${x + w - r} ${t}`,
    `Q ${x + w} ${t} ${x + w} ${t + r}`,
    `L ${x + w} ${t + h - r}`,
    `Q ${x + w} ${t + h} ${x + w - r} ${t + h}`,
    `L ${x + r} ${t + h}`,
    `Q ${x} ${t + h} ${x} ${t + h - r}`,
    `L ${x} ${t + r}`,
    `Q ${x} ${t} ${x + r} ${t}`,
    "Z",
  ].join(" ");
  pagina.drawSvgPath(d, { x: 0, y: 0, color, borderWidth: 0 });
}

/**
 * Por dónde va el contenido: la hoja, la columna y la altura. Al acabarse el
 * espacio salta a la siguiente columna o a una hoja nueva.
 */
class Flujo {
  pagina!: PDFPage;
  y = 0;
  private arriba = 0;
  private col = 0;

  constructor(
    private pdf: PDFDocument,
    /** Las columnas de la hoja. */
    private columnas: { x: number; ancho: number }[],
    /** Hasta dónde se puede escribir. */
    readonly abajo: number,
    /** Dibuja lo fijo de una hoja nueva (la cabecera) y devuelve dónde empieza el contenido. */
    private alAbrir: (pagina: PDFPage, primera: boolean) => number,
  ) {
    this.abrir(true);
  }

  private abrir(primera: boolean) {
    this.pagina = this.pdf.addPage(A4);
    this.arriba = this.alAbrir(this.pagina, primera);
    this.y = this.arriba;
    this.col = 0;
  }

  get x() {
    return this.columnas[this.col].x;
  }
  get ancho() {
    return this.columnas[this.col].ancho;
  }
  /** Si está al principio de una columna (no hace falta saltar). */
  get alInicio() {
    return this.y >= this.arriba - 0.01;
  }

  cabe(alto: number) {
    return this.y - alto >= this.abajo;
  }

  saltar() {
    if (this.col < this.columnas.length - 1) {
      this.col++;
      this.y = this.arriba;
    } else {
      this.abrir(false);
    }
  }

  /** Salta si no cabe `alto` (y no está ya al principio). */
  asegurar(alto: number) {
    if (!this.cabe(alto) && !this.alInicio) this.saltar();
  }
}

/**
 * Dibuja `items` de a trozos que caben: cuando no entran al menos dos (o los
 * que quedan), salta y llama a `alSaltar` (que repite la cabecera de la tabla).
 */
function enTrozos<T>(
  f: Flujo,
  items: T[],
  altoFila: number,
  altoExtra: number,
  alSaltar: () => void,
  dibujar: (trozo: T[], desde: number) => void,
) {
  let i = 0;
  while (i < items.length) {
    const minimo = Math.min(2, items.length - i);
    const caben = Math.floor((f.y - f.abajo - altoExtra) / altoFila);
    if (caben < minimo && !f.alInicio) {
      f.saltar();
      alSaltar();
      continue;
    }
    const n = Math.max(1, Math.min(caben, items.length - i));
    dibujar(items.slice(i, i + n), i);
    i += n;
  }
}

/** Para una sección de planchas: cada bloque partido en trozos, con su posición. */
type DibujarBloque = (b: BloquePlanchas, filas: FilaPlancha[], continuacion: boolean) => void;

function bloquesEnTrozos(
  f: Flujo,
  s: SeccionPlanchas,
  altoFila: number,
  altoBloque: number,
  alSaltar: () => void,
  dibujar: DibujarBloque,
) {
  for (const b of s.bloques) {
    enTrozos(f, b.filas, altoFila, altoBloque, alSaltar, (filas, desde) => dibujar(b, filas, desde > 0));
  }
}

export async function generarPdfListaPrecios(
  lista: ListaPrecios,
  diseno: DisenoLista,
  logoPng?: Uint8Array | null,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(aWinAnsi(`Lista de precios ${EMPRESA} ${fechaCompleta(lista.fecha)}`));
  pdf.setAuthor(EMPRESA);
  pdf.setCreator(EMPRESA);

  const fuentes: Fuentes = {
    normal: await pdf.embedFont(StandardFonts.Helvetica),
    negrita: await pdf.embedFont(StandardFonts.HelveticaBold),
    cursiva: await pdf.embedFont(StandardFonts.HelveticaOblique),
  };
  let logo: PDFImage | null = null;
  if (logoPng) {
    try {
      logo = await pdf.embedPng(logoPng);
    } catch {
      logo = null; // Sin logo, la lista igual sirve.
    }
  }

  const dibujar = { clasico: clasico, moderno: moderno, compacto: catalogo }[diseno];
  dibujar(pdf, lista, fuentes, logo);
  return pdf.save();
}

/** El logo a `alto`, o el nombre de la empresa si no hay logo. Devuelve el ancho usado. */
function dibujarLogo(pagina: PDFPage, logo: PDFImage | null, fuentes: Fuentes, x: number, yAbajo: number, alto: number) {
  if (logo) {
    const w = (logo.width * alto) / logo.height;
    pagina.drawImage(logo, { x, y: yAbajo, width: w, height: alto });
    return w;
  }
  const tamano = alto * 0.5;
  return escribir(pagina, EMPRESA.toUpperCase(), x, yAbajo + alto / 2 - tamano * 0.35, {
    fuente: fuentes.negrita,
    tamano,
    color: AZUL,
  });
}

const vigente = (lista: ListaPrecios) => `Vigente al ${fechaCompleta(lista.fecha)}`;

/* ── A · Clásico ───────────────────────────────────────────────────────────── */

function clasico(pdf: PDFDocument, lista: ListaPrecios, { normal, negrita }: Fuentes, logo: PDFImage | null) {
  const M = 40;
  const W = ANCHO - 2 * M;
  const FILA = 15.5;
  const CAB = 18;
  const T = 9; // Tamaño del texto de las tablas.

  const franjas = (p: PDFPage) => {
    // Arriba a la derecha: una cuña amarilla y la esquina azul.
    poligono(p, [[360, ALTO], [455, ALTO], [ANCHO, ALTO - 68], [ANCHO, ALTO - 92]], AMARILLO);
    poligono(p, [[455, ALTO], [ANCHO, ALTO], [ANCHO, ALTO - 68]], AZUL);
    // Abajo: la banda azul que sube hacia la derecha, con su filo amarillo.
    poligono(p, [[0, 0], [ANCHO, 0], [ANCHO, 38], [0, 10]], AZUL);
    poligono(p, [[0, 10], [ANCHO, 38], [ANCHO, 46], [0, 13]], AMARILLO);
  };

  const f = new Flujo(pdf, [{ x: M, ancho: W }], 78, (p, primera) => {
    franjas(p);
    if (!primera) {
      dibujarLogo(p, logo, { normal, negrita, cursiva: normal }, M, ALTO - 30 - 28, 28);
      escribir(p, "LISTA DE PRECIOS (continuación)", ANCHO / 2, ALTO - 50, { fuente: negrita, tamano: 10, alinear: "centro" });
      return ALTO - 80;
    }
    dibujarLogo(p, logo, { normal, negrita, cursiva: normal }, M, ALTO - 26 - 54, 54);
    let y = ALTO - 104;
    escribir(p, "LISTA DE PRECIOS", ANCHO / 2, y, { fuente: negrita, tamano: 13, alinear: "centro" });
    y -= 17;
    if (lista.telefonos) {
      escribir(p, `Teléfonos: ${lista.telefonos}`, ANCHO / 2, y, { fuente: negrita, tamano: 11, alinear: "centro" });
      y -= 17;
    }
    return y - 6;
  });

  /** Una celda con borde y su texto. */
  const celda = (
    x: number,
    arriba: number,
    w: number,
    h: number,
    texto: string,
    { fuente = normal, alinear = "centro" as Alineacion, grosor = 0.9, tamano = T } = {},
  ) => {
    f.pagina.drawRectangle({ x, y: arriba - h, width: w, height: h, borderColor: NEGRO, borderWidth: grosor });
    const t = recortar(texto, fuente, tamano, w - 8);
    const xx = alinear === "centro" ? x + w / 2 : alinear === "derecha" ? x + w - 4 : x + 4;
    escribir(f.pagina, t, xx, baseCentrada(arriba, h, tamano), { fuente, tamano, alinear });
  };

  const tituloSeccion = (s: SeccionLista, cont = false) => {
    f.y -= 4;
    escribir(f.pagina, `${s.titulo.toUpperCase()}${cont ? " (cont.)" : ""}`, ANCHO / 2, f.y - 11, {
      fuente: negrita,
      tamano: 12,
      alinear: "centro",
    });
    f.y -= 20;
  };

  const notas = (s: SeccionLista) => {
    if (!s.notas.length) return;
    f.y -= 4;
    s.notas.forEach((n, i) => {
      const fuente = i === 0 ? negrita : normal;
      for (const r of partirEnRenglones(n, fuente, 10, W)) {
        f.asegurar(14);
        escribir(f.pagina, r, f.x, f.y - 11, { fuente, tamano: 10 });
        f.y -= 14;
      }
    });
  };

  const planchas = (s: SeccionPlanchas) => {
    const cols = s.conRef
      ? { medida: 112, espesor: 64, color: 128, ref: 74, codigo: 70, precio: 67 }
      : { medida: 124, espesor: 72, color: 176, ref: 0, codigo: 76, precio: 67 };
    const xs = {
      medida: M,
      espesor: M + cols.medida,
      color: M + cols.medida + cols.espesor,
      ref: M + cols.medida + cols.espesor + cols.color,
      codigo: M + cols.medida + cols.espesor + cols.color + cols.ref,
      precio: M + W - cols.precio,
    };
    const cabecera = () => {
      const a = f.y;
      const op = { fuente: negrita, grosor: 1.4 };
      celda(xs.medida, a, cols.medida, CAB, "MEDIDA", op);
      celda(xs.espesor, a, cols.espesor, CAB, "ESPESOR", op);
      celda(xs.color, a, cols.color + cols.ref, CAB, "COLOR", op);
      celda(xs.codigo, a, cols.codigo, CAB, "CÓDIGO", op);
      celda(xs.precio, a, cols.precio, CAB, "PRECIO S/", op);
      f.y -= CAB;
    };

    f.asegurar(30 + CAB + FILA * Math.min(2, s.bloques[0]?.filas.length ?? 1));
    tituloSeccion(s);
    cabecera();
    bloquesEnTrozos(f, s, FILA, 0, () => {
      tituloSeccion(s, true);
      cabecera();
    }, (b, filas) => {
      const a = f.y;
      const h = filas.length * FILA;
      celda(xs.medida, a, cols.medida, h, b.medida, { fuente: negrita });
      celda(xs.espesor, a, cols.espesor, h, b.espesor);
      filas.forEach((fila, i) => {
        const y = a - i * FILA;
        if (s.conRef) {
          celda(xs.color, y, cols.color, FILA, fila.color);
          celda(xs.ref, y, cols.ref, FILA, fila.ref ?? "");
        } else {
          celda(xs.color, y, cols.color, FILA, fila.color);
        }
        celda(xs.codigo, y, cols.codigo, FILA, fila.codigo);
      });
      for (const [desde, n] of tramosDePrecio(filas)) {
        celda(xs.precio, a - desde * FILA, cols.precio, n * FILA, precioLista(filas[desde].precio));
      }
      // El borde de afuera del bloque, más grueso, como en la lista de siempre.
      f.pagina.drawRectangle({ x: M, y: a - h, width: W, height: h, borderColor: NEGRO, borderWidth: 1.4 });
      f.y -= h;
    });
    notas(s);
    f.y -= 14;
  };

  const accesorios = (s: SeccionAccesorios) => {
    const cols = { nombre: 250, codigo: 80, precio: 70 };
    const cabecera = () => {
      const a = f.y;
      celda(M, a, cols.nombre, CAB, "PRODUCTO", { fuente: negrita, grosor: 1.4 });
      celda(M + cols.nombre, a, cols.codigo, CAB, "CÓDIGO", { fuente: negrita, grosor: 1.4 });
      celda(M + cols.nombre + cols.codigo, a, cols.precio, CAB, "PRECIO S/", { fuente: negrita, grosor: 1.4 });
      f.y -= CAB;
    };
    f.asegurar(30 + CAB + FILA * Math.min(2, s.filas.length));
    // Los accesorios van alineados a la izquierda, como en la lista de siempre.
    f.y -= 4;
    escribir(f.pagina, s.titulo.toUpperCase(), M, f.y - 11, { fuente: negrita, tamano: 11 });
    f.y -= 20;
    cabecera();
    enTrozos(f, s.filas, FILA, 0, cabecera, (filas) => {
      filas.forEach((fila) => {
        celda(M, f.y, cols.nombre, FILA, fila.nombre, { alinear: "izquierda" });
        celda(M + cols.nombre, f.y, cols.codigo, FILA, fila.codigo);
        celda(M + cols.nombre + cols.codigo, f.y, cols.precio, FILA, precioLista(fila.precio));
        f.y -= FILA;
      });
    });
    notas(s);
    f.y -= 14;
  };

  for (const s of lista.secciones) {
    if (s.tipo === "planchas") planchas(s);
    else accesorios(s);
  }

  // El pie de cada hoja: la nota del IGV, la fecha y el número de hoja.
  const paginas = pdf.getPages();
  paginas.forEach((p, i) => {
    if (lista.notaPie) escribir(p, lista.notaPie.toUpperCase(), M, 58, { fuente: negrita, tamano: 10 });
    escribir(p, vigente(lista), ANCHO - M, 58, { fuente: normal, tamano: 10, alinear: "derecha" });
    if (paginas.length > 1)
      escribir(p, `${i + 1} / ${paginas.length}`, ANCHO / 2, 58, { fuente: normal, tamano: 8, color: GRIS, alinear: "centro" });
  });
}

/* ── B · Moderno ───────────────────────────────────────────────────────────── */

function moderno(pdf: PDFDocument, lista: ListaPrecios, fuentes: Fuentes, logo: PDFImage | null) {
  const { normal, negrita } = fuentes;
  const M = 40;
  const W = ANCHO - 2 * M;
  const FILA = 17;
  const CAB = 18;
  const BLOQUE = 22;
  const T = 9;

  const barra = (p: PDFPage, y: number) => {
    p.drawRectangle({ x: M, y, width: W, height: 3, color: AZUL });
    p.drawRectangle({ x: M + W - 90, y, width: 90, height: 3, color: AMARILLO });
  };

  const f = new Flujo(pdf, [{ x: M, ancho: W }], 74, (p, primera) => {
    if (!primera) {
      dibujarLogo(p, logo, fuentes, M, ALTO - 34 - 24, 24);
      escribir(p, "LISTA DE PRECIOS", ANCHO - M, ALTO - 44, { fuente: negrita, tamano: 10, color: AZUL, alinear: "derecha" });
      barra(p, ALTO - 66);
      return ALTO - 84;
    }
    dibujarLogo(p, logo, fuentes, M, ALTO - 34 - 50, 50);
    escribir(p, "LISTA DE PRECIOS", ANCHO - M, ALTO - 56, { fuente: negrita, tamano: 22, color: AZUL, alinear: "derecha" });
    escribir(p, vigente(lista), ANCHO - M, ALTO - 74, { fuente: normal, tamano: 9.5, color: GRIS, alinear: "derecha" });
    barra(p, ALTO - 98);
    return ALTO - 122;
  });

  const titulo = (s: SeccionLista, cont = false) => {
    f.pagina.drawRectangle({ x: M, y: f.y - 16, width: 4, height: 16, color: AMARILLO });
    escribir(f.pagina, `${s.titulo.toUpperCase()}${cont ? "  (cont.)" : ""}`, M + 12, f.y - 12.5, {
      fuente: negrita,
      tamano: 13,
      color: AZUL,
    });
    f.y -= 24;
  };

  /** Las notas como etiquetas, una al lado de otra. */
  const etiquetas = (s: SeccionLista) => {
    if (!s.notas.length) return;
    const H = 15;
    let x = M;
    let y = f.y;
    s.notas.forEach((n, i) => {
      const fuente = i === 0 ? negrita : normal;
      const t = recortar(n, fuente, 8, W - 14);
      const w = fuente.widthOfTextAtSize(t, 8) + 14;
      if (x + w > M + W) {
        x = M;
        y -= H + 5;
      }
      rectRedondo(f.pagina, x, y - H, w, H, 7.5, i === 0 ? AMARILLO_CLARO : FONDO);
      escribir(f.pagina, t, x + 7, baseCentrada(y, H, 8), { fuente, tamano: 8, color: NEGRO });
      x += w + 6;
    });
    f.y = y - H - 10;
  };

  /** La cabecera de una tabla: `cols` son [texto, x, alineación]. */
  const cabecera = (cols: [string, number, Alineacion][]) => {
    f.pagina.drawRectangle({ x: M, y: f.y - CAB, width: W, height: CAB, color: AZUL_CLARO });
    for (const [t, x, alinear] of cols) {
      escribir(f.pagina, t, x, baseCentrada(f.y, CAB, 7.5), { fuente: negrita, tamano: 7.5, color: AZUL, alinear });
    }
    f.y -= CAB;
  };

  const fila = (i: number, celdas: [string, number, Alineacion, PDFFont, RGB, number?][]) => {
    if (i % 2 === 1) f.pagina.drawRectangle({ x: M, y: f.y - FILA, width: W, height: FILA, color: FONDO });
    for (const [t, x, alinear, fuente, color, max] of celdas) {
      const texto = max ? recortar(t, fuente, T, max) : t;
      escribir(f.pagina, texto, x, baseCentrada(f.y, FILA, T), { fuente, tamano: T, color, alinear });
    }
    f.y -= FILA;
  };

  const xPrecio = M + W - 10;

  const planchas = (s: SeccionPlanchas) => {
    const x = { color: M + 10, ref: M + 220, codigo: M + 320 };
    const cols: [string, number, Alineacion][] = [
      ["COLOR", x.color, "izquierda"],
      ...(s.conRef ? [["REF. PROVEEDOR", x.ref, "izquierda"] as [string, number, Alineacion]] : []),
      ["CÓDIGO", x.codigo, "izquierda"],
      ["PRECIO", xPrecio, "derecha"],
    ];
    f.asegurar(24 + 30 + CAB + BLOQUE + 2 * FILA);
    titulo(s);
    etiquetas(s);
    cabecera(cols);
    bloquesEnTrozos(f, s, FILA, BLOQUE, () => {
      titulo(s, true);
      cabecera(cols);
    }, (b, filas, continuacion) => {
      // El renglón de la medida: lo que en la lista de siempre son las celdas unidas.
      escribir(f.pagina, `${b.medida}   ·   ${b.espesor}${continuacion ? "   (cont.)" : ""}`, M + 10, f.y - 15, {
        fuente: negrita,
        tamano: 9.5,
        color: NEGRO,
      });
      f.pagina.drawLine({ start: { x: M, y: f.y - BLOQUE + 1 }, end: { x: M + W, y: f.y - BLOQUE + 1 }, thickness: 0.8, color: AZUL });
      f.y -= BLOQUE;
      filas.forEach((r, i) =>
        fila(i, [
          [r.color, x.color, "izquierda", normal, NEGRO, (s.conRef ? x.ref : x.codigo) - x.color - 8],
          ...(s.conRef ? [[r.ref ?? "", x.ref, "izquierda", normal, GRIS] as [string, number, Alineacion, PDFFont, RGB]] : []),
          [r.codigo, x.codigo, "izquierda", normal, GRIS],
          [`S/ ${precioLista(r.precio)}`, xPrecio, "derecha", negrita, AZUL],
        ]),
      );
      f.y -= 4;
    });
    f.y -= 16;
  };

  const accesorios = (s: SeccionAccesorios) => {
    const x = { nombre: M + 10, codigo: M + 320 };
    const cols: [string, number, Alineacion][] = [
      ["PRODUCTO", x.nombre, "izquierda"],
      ["CÓDIGO", x.codigo, "izquierda"],
      ["PRECIO", xPrecio, "derecha"],
    ];
    f.asegurar(24 + 30 + CAB + 2 * FILA);
    titulo(s);
    etiquetas(s);
    cabecera(cols);
    enTrozos(f, s.filas, FILA, 0, () => {
      titulo(s, true);
      cabecera(cols);
    }, (filas, desde) =>
      filas.forEach((r, i) =>
        fila(desde + i, [
          [r.nombre, x.nombre, "izquierda", normal, NEGRO, x.codigo - x.nombre - 8],
          [r.codigo, x.codigo, "izquierda", normal, GRIS],
          [`S/ ${precioLista(r.precio)}`, xPrecio, "derecha", negrita, AZUL],
        ]),
      ),
    );
    f.y -= 16;
  };

  for (const s of lista.secciones) {
    if (s.tipo === "planchas") planchas(s);
    else accesorios(s);
  }

  // El pie: la nota del IGV y la banda azul con los teléfonos.
  const paginas = pdf.getPages();
  paginas.forEach((p, i) => {
    if (lista.notaPie) escribir(p, lista.notaPie, M, 46, { fuente: negrita, tamano: 9, color: AZUL });
    p.drawRectangle({ x: 0, y: 0, width: ANCHO, height: 30, color: AZUL });
    p.drawRectangle({ x: 0, y: 30, width: ANCHO, height: 2.5, color: AMARILLO });
    if (lista.telefonos) escribir(p, `Teléfonos: ${lista.telefonos}`, M, 11, { fuente: negrita, tamano: 9, color: BLANCO });
    escribir(p, `Página ${i + 1} de ${paginas.length}`, ANCHO - M, 11, { fuente: normal, tamano: 8.5, color: BLANCO, alinear: "derecha" });
  });
}

/* ── C · Catálogo (dos columnas) ───────────────────────────────────────────── */

function catalogo(pdf: PDFDocument, lista: ListaPrecios, fuentes: Fuentes, logo: PDFImage | null) {
  const { normal, negrita, cursiva } = fuentes;
  const M = 32;
  const SEP = 22;
  const COL = (ANCHO - 2 * M - SEP) / 2;
  const FILA = 13;
  const BLOQUE = 16;
  const TITULO = 19;

  const f = new Flujo(
    pdf,
    [
      { x: M, ancho: COL },
      { x: M + COL + SEP, ancho: COL },
    ],
    46,
    (p, primera) => {
      const alto = primera ? 40 : 22;
      dibujarLogo(p, logo, fuentes, M, ALTO - M - alto, alto);
      const derecha = ANCHO - M;
      if (primera) {
        escribir(p, "LISTA DE PRECIOS", derecha, ALTO - M - 13, { fuente: negrita, tamano: 15, color: AZUL, alinear: "derecha" });
        escribir(p, vigente(lista), derecha, ALTO - M - 26, { fuente: normal, tamano: 8.5, color: GRIS, alinear: "derecha" });
        if (lista.telefonos)
          escribir(p, `Tel.: ${lista.telefonos}`, derecha, ALTO - M - 38, { fuente: normal, tamano: 8.5, color: GRIS, alinear: "derecha" });
      } else {
        escribir(p, "LISTA DE PRECIOS", derecha, ALTO - M - 15, { fuente: negrita, tamano: 10, color: AZUL, alinear: "derecha" });
      }
      const yBarra = ALTO - M - alto - 10;
      p.drawRectangle({ x: M, y: yBarra, width: ANCHO - 2 * M, height: 3, color: AMARILLO });
      // La raya entre las dos columnas.
      p.drawLine({ start: { x: ANCHO / 2, y: yBarra - 12 }, end: { x: ANCHO / 2, y: 50 }, thickness: 0.5, color: LINEA });
      return yBarra - 14;
    },
  );

  const titulo = (s: SeccionLista, cont = false) => {
    f.pagina.drawRectangle({ x: f.x, y: f.y - TITULO, width: f.ancho, height: TITULO, color: AZUL });
    f.pagina.drawRectangle({ x: f.x, y: f.y - TITULO, width: 4, height: TITULO, color: AMARILLO });
    const t = recortar(`${s.titulo.toUpperCase()}${cont ? " (cont.)" : ""}`, negrita, 9.5, f.ancho - 18);
    escribir(f.pagina, t, f.x + 11, baseCentrada(f.y, TITULO, 9.5), { fuente: negrita, tamano: 9.5, color: BLANCO });
    f.y -= TITULO + 5;
  };

  const notas = (s: SeccionLista) => {
    if (!s.notas.length) return;
    const renglones = s.notas.flatMap((n, i) =>
      partirEnRenglones(n, i === 0 ? negrita : cursiva, 7.5, f.ancho - 4).map((r) => ({ r, fuente: i === 0 ? negrita : cursiva })),
    );
    for (const { r, fuente } of renglones) {
      escribir(f.pagina, r, f.x + 2, f.y - 8, { fuente, tamano: 7.5, color: GRIS });
      f.y -= 10;
    }
    f.y -= 3;
  };

  /** Un renglón estilo menú: nombre (y su ref en gris) …… código  precio. */
  const renglon = (nombre: string, ref: string | null, codigo: string, precio: number) => {
    const xPrecio = f.x + f.ancho;
    const xCodigo = xPrecio - 44;
    const base = baseCentrada(f.y, FILA, 8);
    const wCodigo = normal.widthOfTextAtSize(aWinAnsi(codigo), 7);
    const maxNombre = xCodigo - wCodigo - f.x - 30;
    const n = recortar(nombre, normal, 8, maxNombre);
    let fin = f.x + escribir(f.pagina, n, f.x, base, { fuente: normal, tamano: 8 });
    if (ref && fin + 8 < xCodigo - wCodigo - 16) {
      const r = recortar(ref, normal, 6.5, xCodigo - wCodigo - 16 - fin - 4);
      fin += 4 + escribir(f.pagina, r, fin + 4, base, { fuente: normal, tamano: 6.5, color: GRIS });
    }
    f.pagina.drawLine({
      start: { x: fin + 4, y: base + 1 },
      end: { x: xCodigo - wCodigo - 5, y: base + 1 },
      thickness: 0.7,
      color: rgb(0.7, 0.72, 0.76),
      dashArray: [0.8, 2],
    });
    escribir(f.pagina, codigo, xCodigo, base, { fuente: normal, tamano: 7, color: GRIS, alinear: "derecha" });
    escribir(f.pagina, precioLista(precio), xPrecio, base, { fuente: negrita, tamano: 8.5, color: AZUL, alinear: "derecha" });
    f.y -= FILA;
  };

  const altoNotas = (s: SeccionLista) =>
    s.notas.length ? s.notas.reduce((n, t) => n + partirEnRenglones(t, cursiva, 7.5, COL - 4).length, 0) * 10 + 3 : 0;

  const planchas = (s: SeccionPlanchas) => {
    f.asegurar(TITULO + 5 + altoNotas(s) + BLOQUE + 2 * FILA);
    titulo(s);
    notas(s);
    bloquesEnTrozos(f, s, FILA, BLOQUE, () => titulo(s, true), (b, filas, continuacion) => {
      escribir(f.pagina, `${b.medida}  ·  ${b.espesor}${continuacion ? "  (cont.)" : ""}`, f.x, f.y - 11, {
        fuente: negrita,
        tamano: 8.5,
        color: AZUL,
      });
      f.y -= BLOQUE;
      for (const r of filas) renglon(r.color, r.ref, r.codigo, r.precio);
      f.y -= 4;
    });
    f.y -= 10;
  };

  const accesorios = (s: SeccionAccesorios) => {
    f.asegurar(TITULO + 5 + altoNotas(s) + 2 * FILA);
    titulo(s);
    notas(s);
    enTrozos(f, s.filas, FILA, 0, () => titulo(s, true), (filas) => {
      for (const r of filas) renglon(r.nombre, null, r.codigo, r.precio);
    });
    f.y -= 14;
  };

  for (const s of lista.secciones) {
    if (s.tipo === "planchas") planchas(s);
    else accesorios(s);
  }

  const paginas = pdf.getPages();
  paginas.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: 36 }, end: { x: ANCHO - M, y: 36 }, thickness: 0.6, color: LINEA });
    if (lista.notaPie) escribir(p, lista.notaPie, M, 22, { fuente: negrita, tamano: 8.5, color: AZUL });
    escribir(p, `Precios en soles  ·  ${i + 1} / ${paginas.length}`, ANCHO - M, 22, {
      fuente: normal,
      tamano: 8,
      color: GRIS,
      alinear: "derecha",
    });
  });
}
