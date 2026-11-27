/**
 * Las páginas de un PDF como imágenes PNG, con pdf.js y `@napi-rs/canvas` (en el
 * servidor: ver `serverExternalPackages` en next.config.ts). Es lo que ve el
 * modelo cuando la pasarela no acepta partes `file`: un plano llega con su
 * dibujo y sus cotas, no como texto suelto.
 */

export type PaginaImagen = {
  numero: number;
  /** PNG en base64. */
  png: string;
};

/** Lado mayor de cada imagen, en píxeles: lo bastante grande para leer cotas. */
const LADO_MAXIMO = 1800;
/** Escala mínima, para que una página pequeña no salga borrosa. */
const ESCALA_MINIMA = 1;

/**
 * Las primeras `maxPaginas` páginas como PNG, y cuántas tiene el PDF.
 * Lanza si el archivo no es un PDF legible o si falta el canvas.
 */
export async function imagenesDePdf(
  bytes: Uint8Array,
  { maxPaginas }: { maxPaginas: number },
): Promise<{ paginas: PaginaImagen[]; total: number }> {
  const [pdfjs, { createCanvas }] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("@napi-rs/canvas"),
  ]);
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    useSystemFonts: false,
    verbosity: 0,
  }).promise;
  try {
    const paginas: PaginaImagen[] = [];
    for (let n = 1; n <= Math.min(doc.numPages, maxPaginas); n++) {
      const pagina = await doc.getPage(n);
      const base = pagina.getViewport({ scale: 1 });
      const escala = Math.max(ESCALA_MINIMA, LADO_MAXIMO / Math.max(base.width, base.height));
      const vista = pagina.getViewport({ scale: escala });
      const lienzo = createCanvas(Math.ceil(vista.width), Math.ceil(vista.height));
      const ctx = lienzo.getContext("2d");
      // Fondo blanco: sin él, un PDF sin fondo sale transparente (negro en muchos visores).
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, lienzo.width, lienzo.height);
      // `canvas` y `canvasContext` son de @napi-rs/canvas; los tipos de pdf.js esperan los del DOM.
      await pagina.render({
        canvas: lienzo as unknown as HTMLCanvasElement,
        canvasContext: ctx as unknown as CanvasRenderingContext2D,
        viewport: vista,
      }).promise;
      paginas.push({ numero: n, png: lienzo.toBuffer("image/png").toString("base64") });
      pagina.cleanup();
    }
    return { paginas, total: doc.numPages };
  } finally {
    await doc.destroy();
  }
}
