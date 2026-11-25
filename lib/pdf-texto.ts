/**
 * El texto de un PDF, página por página, con pdf.js (en el servidor: ver
 * `serverExternalPackages` en next.config.ts). Lo usan los adjuntos del chat de
 * diseños y la base de conocimiento del agente de WhatsApp.
 */

export type PaginaPdf = { numero: number; texto: string };

/**
 * Las páginas con texto, hasta `maxPaginas` o hasta juntar `maxCaracteres`.
 * Lanza si el archivo no es un PDF legible.
 */
export async function paginasDePdf(
  bytes: Uint8Array,
  { maxPaginas, maxCaracteres = Infinity }: { maxPaginas: number; maxCaracteres?: number },
): Promise<{ paginas: PaginaPdf[]; total: number }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    useSystemFonts: false,
    verbosity: 0,
  }).promise;
  try {
    const paginas: PaginaPdf[] = [];
    let largo = 0;
    for (let n = 1; n <= Math.min(doc.numPages, maxPaginas) && largo < maxCaracteres; n++) {
      const pagina = await doc.getPage(n);
      const contenido = await pagina.getTextContent();
      const texto = contenido.items
        .map((i) => ("str" in i ? i.str + (i.hasEOL ? "\n" : "") : ""))
        .join("")
        .replace(/[ \t]+/g, " ")
        .trim();
      if (texto) {
        paginas.push({ numero: n, texto });
        largo += texto.length;
      }
    }
    return { paginas, total: doc.numPages };
  } finally {
    await doc.destroy();
  }
}
