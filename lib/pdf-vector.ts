/**
 * El contorno vectorial de una región de un PDF (un logo, por ejemplo), con
 * pdf.js en el servidor (ver `serverExternalPackages` en next.config.ts).
 *
 * pdf.js no entrega los trazos tal cual: da una lista de operadores. Aquí se
 * recorre siguiendo la matriz de transformación (`save`/`restore`/`transform`
 * y los XObjects de formulario) y se juntan los subtrazados de los RELLENOS
 * cuya caja cae dentro de la región. Las curvas se conservan como Bézier
 * cúbicas: no se aproximan a tramos rectos. Los trazos de línea (cotas, ejes)
 * se ignoran, salvo que se pida `incluirTrazos`.
 *
 * La salida está en milímetros, con el origen abajo a la izquierda y Y hacia
 * arriba (como el sandbox): cada trazo es un `d` de SVG con `M`, `L`, `C` y `Z`.
 */

export type RegionPagina = {
  /** Fracciones de la página (0 a 1), con el origen arriba a la izquierda, como el PNG que ve el modelo. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

export type ContornoVectorial = {
  anchoMm: number;
  altoMm: number;
  /** Un `d` de SVG por subtrazado cerrado, en mm. */
  trazos: string[];
  segmentos: number;
};

/** Un problema que se le puede explicar al modelo (región vacía, demasiado detalle…). */
export class ErrorContorno extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorContorno";
  }
}

/** Cuántos segmentos (rectas y curvas) admite un contorno. Un logo normal tiene cientos. */
export const MAX_SEGMENTOS_CONTORNO = 20_000;

type Matriz = [number, number, number, number, number, number];
type Punto = [number, number];
/** Un segmento ya en coordenadas de página: recta (1 punto) o cúbica (3 puntos). */
type Segmento = { puntos: Punto[] };
type Subtrazado = { inicio: Punto; segmentos: Segmento[] };

/** `a × b`: aplica `b` primero y después `a`, como `ctx.transform` del canvas. */
function multiplicar(a: Matriz, b: Matriz): Matriz {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

const aplicar = (m: Matriz, x: number, y: number): Punto => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** Los operadores de pintura de `constructPath` (los números son los de `OPS` de pdf.js). */
const RELLENO = new Set([22, 23, 24, 25, 26, 27]);
const SOLO_TRAZO = new Set([20, 21]);

/**
 * Los códigos de los datos de `constructPath` (`DrawOPS` de pdf.js, que no se
 * exporta). Si una versión nueva los cambia, la prueba de este archivo falla.
 */
const DRAW = { moveTo: 0, lineTo: 1, curveTo: 2, quadraticCurveTo: 3, closePath: 4 } as const;

/** Los subtrazados de un `constructPath`, ya en coordenadas de página (píxeles del viewport a escala 1). */
function subtrazadosDe(datos: ArrayLike<number>, m: Matriz): Subtrazado[] {
  const draw = DRAW;
  const salida: Subtrazado[] = [];
  let actual: Subtrazado | null = null;
  let ultimo: Punto = [0, 0];
  let i = 0;
  while (i < datos.length) {
    const op = datos[i++];
    if (op === draw.moveTo) {
      ultimo = aplicar(m, datos[i], datos[i + 1]);
      i += 2;
      actual = { inicio: ultimo, segmentos: [] };
      salida.push(actual);
    } else if (op === draw.lineTo) {
      const p = aplicar(m, datos[i], datos[i + 1]);
      i += 2;
      actual?.segmentos.push({ puntos: [p] });
      ultimo = p;
    } else if (op === draw.curveTo) {
      const c1 = aplicar(m, datos[i], datos[i + 1]);
      const c2 = aplicar(m, datos[i + 2], datos[i + 3]);
      const p = aplicar(m, datos[i + 4], datos[i + 5]);
      i += 6;
      actual?.segmentos.push({ puntos: [c1, c2, p] });
      ultimo = p;
    } else if (op === draw.quadraticCurveTo) {
      // Una cuadrática pasa a cúbica exacta: C1 = P0 + 2/3 (Q − P0), C2 = P + 2/3 (Q − P).
      const q = aplicar(m, datos[i], datos[i + 1]);
      const p = aplicar(m, datos[i + 2], datos[i + 3]);
      i += 4;
      const c1: Punto = [ultimo[0] + (2 / 3) * (q[0] - ultimo[0]), ultimo[1] + (2 / 3) * (q[1] - ultimo[1])];
      const c2: Punto = [p[0] + (2 / 3) * (q[0] - p[0]), p[1] + (2 / 3) * (q[1] - p[1])];
      actual?.segmentos.push({ puntos: [c1, c2, p] });
      ultimo = p;
    } else if (op === draw.closePath) {
      // Tras cerrar, un trazo nuevo sin `moveTo` arranca donde empezó este.
      if (actual) {
        ultimo = actual.inicio;
        actual = { inicio: actual.inicio, segmentos: [] };
        salida.push(actual);
      }
    } else {
      throw new ErrorContorno("El PDF trae un trazo con un operador que no se reconoce.");
    }
  }
  // Los subtrazados vacíos (los que deja un `closePath`) no cuentan.
  return salida.filter((s) => s.segmentos.length > 0);
}

/** La caja de un subtrazado según sus puntos de control (contiene a la curva). */
function cajaDe(s: Subtrazado): [number, number, number, number] {
  let x0 = s.inicio[0];
  let y0 = s.inicio[1];
  let x1 = x0;
  let y1 = y0;
  for (const seg of s.segmentos) {
    for (const [x, y] of seg.puntos) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return [x0, y0, x1, y1];
}

const num = (n: number) => String(Math.round(n * 1000) / 1000);

/**
 * El contorno de la región `region` de la página `pagina` (desde 1), a la
 * medida de `anchoMm` de ancho. Lanza `ErrorContorno` si no hay relleno
 * vectorial en la región o si trae demasiado detalle.
 */
export async function extraerContornoVectorial(
  bytes: Uint8Array,
  opciones: { pagina: number; region: RegionPagina; anchoMm: number; incluirTrazos?: boolean },
): Promise<ContornoVectorial> {
  const { pagina, region, anchoMm, incluirTrazos = false } = opciones;
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    useSystemFonts: false,
    verbosity: 0,
  }).promise;
  try {
    if (!Number.isInteger(pagina) || pagina < 1 || pagina > doc.numPages) {
      throw new ErrorContorno(`El PDF tiene ${doc.numPages} página(s); la ${pagina} no existe.`);
    }
    const hoja = await doc.getPage(pagina);
    const vista = hoja.getViewport({ scale: 1 });
    const base = vista.transform as Matriz;
    const OPS = pdfjs.OPS as Record<string, number>;

    const [rx0, ry0, rx1, ry1] = [region.x0 * vista.width, region.y0 * vista.height, region.x1 * vista.width, region.y1 * vista.height];
    const holgura = 0.5;

    const lista = await hoja.getOperatorList();
    let ctm: Matriz = base;
    const pila: Matriz[] = [];
    const elegidos: Subtrazado[] = [];

    for (let i = 0; i < lista.fnArray.length; i++) {
      const fn = lista.fnArray[i];
      const args = lista.argsArray[i];
      if (fn === OPS.save) pila.push(ctm);
      else if (fn === OPS.restore) ctm = pila.pop() ?? base;
      else if (fn === OPS.transform) ctm = multiplicar(ctm, args as Matriz);
      else if (fn === OPS.paintFormXObjectBegin) {
        pila.push(ctm);
        if (args?.[0]) ctm = multiplicar(ctm, args[0] as Matriz);
      } else if (fn === OPS.paintFormXObjectEnd) ctm = pila.pop() ?? base;
      else if (fn === OPS.constructPath) {
        const pintura = args[0] as number;
        if (!RELLENO.has(pintura) && !(incluirTrazos && SOLO_TRAZO.has(pintura))) continue;
        for (const s of (args[1] as ArrayLike<number>[]).flatMap((datos) => subtrazadosDe(datos, ctm))) {
          const [x0, y0, x1, y1] = cajaDe(s);
          if (x0 >= rx0 - holgura && y0 >= ry0 - holgura && x1 <= rx1 + holgura && y1 <= ry1 + holgura) elegidos.push(s);
        }
      }
    }

    if (elegidos.length === 0) {
      throw new ErrorContorno(
        "No hay relleno vectorial dentro de esa región. Revisa que la región encierre el logo entero (si el dibujo es una imagen y no un vector, esta herramienta no sirve).",
      );
    }
    const segmentos = elegidos.reduce((n, s) => n + s.segmentos.length, 0);
    if (segmentos > MAX_SEGMENTOS_CONTORNO) {
      throw new ErrorContorno(
        `La región trae demasiado detalle (${segmentos} segmentos; el máximo son ${MAX_SEGMENTOS_CONTORNO}). Reduce la región para que solo encierre el logo.`,
      );
    }

    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const s of elegidos) {
      const c = cajaDe(s);
      x0 = Math.min(x0, c[0]);
      y0 = Math.min(y0, c[1]);
      x1 = Math.max(x1, c[2]);
      y1 = Math.max(y1, c[3]);
    }
    const ancho = x1 - x0;
    const alto = y1 - y0;
    if (!(ancho > 0)) throw new ErrorContorno("El contorno encontrado no tiene ancho.");
    const k = anchoMm / ancho;
    // De píxeles de página (Y hacia abajo) a milímetros (Y hacia arriba, origen en la esquina).
    const mm = ([x, y]: Punto): string => `${num((x - x0) * k)} ${num((y1 - y) * k)}`;

    const trazos = elegidos.map((s) => {
      const partes = [`M ${mm(s.inicio)}`];
      for (const seg of s.segmentos) {
        partes.push(seg.puntos.length === 1 ? `L ${mm(seg.puntos[0])}` : `C ${seg.puntos.map(mm).join(" ")}`);
      }
      partes.push("Z");
      return partes.join(" ");
    });

    return { anchoMm: Math.round(anchoMm * 1000) / 1000, altoMm: Math.round(alto * k * 1000) / 1000, trazos, segmentos };
  } finally {
    await doc.destroy();
  }
}

/** Un PNG (base64) del contorno, relleno en negro sobre blanco, para que el modelo compruebe que es el logo. */
export async function previsualizarContorno(c: Pick<ContornoVectorial, "anchoMm" | "altoMm" | "trazos">): Promise<string> {
  const { createCanvas, Path2D } = await import("@napi-rs/canvas");
  const margen = 24;
  const lado = 900;
  const k = Math.min((lado - 2 * margen) / c.anchoMm, (lado - 2 * margen) / c.altoMm);
  const w = Math.max(1, Math.ceil(c.anchoMm * k + 2 * margen));
  const h = Math.max(1, Math.ceil(c.altoMm * k + 2 * margen));
  const lienzo = createCanvas(w, h);
  const ctx = lienzo.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  // Y hacia arriba, como los milímetros del contorno.
  ctx.setTransform(k, 0, 0, -k, margen, h - margen);
  ctx.fillStyle = "#111111";
  ctx.fill(new Path2D(c.trazos.join(" ")), "evenodd");
  return lienzo.toBuffer("image/png").toString("base64");
}
