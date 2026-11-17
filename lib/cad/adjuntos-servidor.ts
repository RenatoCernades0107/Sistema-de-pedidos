/**
 * Los adjuntos del chat de diseños, convertidos en lo que lee el modelo.
 *
 * Se bajan de Storage con la sesión de quien escribe (la política del bucket
 * es la de `cad_mensajes`) y se arman como partes del mensaje:
 *   · imagen → una parte `imagen` con su `data:`.
 *   · PDF    → el texto que se le saca con pdf.js, y además el PDF entero
 *              como parte `archivo` (el modelo ve también los dibujos y los
 *              escaneados), salvo con `INFERHUB_PDF=texto`.
 * Cada archivo va precedido de una línea que lo nombra, para que el asistente
 * pueda referirse a él ("en plano.pdf…").
 */

import { clienteServidor } from "@/lib/supabase-servidor";
import { pdfComoArchivo, type ParteLlm } from "@/lib/llm/inferhub";
import { BUCKET_CAD_ADJUNTOS, esImagenAdjunto, type AdjuntoCad } from "@/lib/cad/adjuntos";

/** Cuánto texto de un PDF se le pasa al modelo, como mucho. */
const MAX_CARACTERES_PDF = 30_000;
/** De cuántas páginas se saca el texto. */
const MAX_PAGINAS_PDF = 40;

/** Un archivo adjunto que ya no está en Storage (o no se pudo leer). */
export class AdjuntoNoDisponible extends Error {
  constructor(readonly nombre: string) {
    super(`El archivo «${nombre}» ya no está disponible.`);
    this.name = "AdjuntoNoDisponible";
  }
}

async function descargar(adjunto: AdjuntoCad): Promise<Buffer> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase.storage.from(BUCKET_CAD_ADJUNTOS).download(adjunto.ruta);
  if (error || !data) throw new AdjuntoNoDisponible(adjunto.nombre);
  return Buffer.from(await data.arrayBuffer());
}

/** El texto de un PDF y cuántas páginas tiene. Si no se puede leer, sin texto. */
async function textoDePdf(bytes: Buffer): Promise<{ texto: string; paginas: number | null }> {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      useSystemFonts: false,
      verbosity: 0,
    }).promise;
    try {
      const trozos: string[] = [];
      let largo = 0;
      for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGINAS_PDF) && largo < MAX_CARACTERES_PDF; n++) {
        const pagina = await doc.getPage(n);
        const contenido = await pagina.getTextContent();
        const texto = contenido.items
          .map((i) => ("str" in i ? i.str + (i.hasEOL ? "\n" : "") : ""))
          .join("")
          .replace(/[ \t]+/g, " ")
          .trim();
        if (texto) {
          const linea = `— Página ${n} —\n${texto}`;
          trozos.push(linea);
          largo += linea.length;
        }
      }
      let texto = trozos.join("\n\n");
      if (texto.length > MAX_CARACTERES_PDF) texto = `${texto.slice(0, MAX_CARACTERES_PDF)}\n[…texto recortado]`;
      return { texto, paginas: doc.numPages };
    } finally {
      await doc.destroy();
    }
  } catch (e) {
    console.error("[cad] adjuntos: leer el PDF", e);
    return { texto: "", paginas: null };
  }
}

/** Las partes de un archivo para el modelo. */
async function partesDeUno(adjunto: AdjuntoCad): Promise<ParteLlm[]> {
  const bytes = await descargar(adjunto);

  if (esImagenAdjunto(adjunto.mime)) {
    return [
      { tipo: "texto", texto: `[Imagen adjunta: ${adjunto.nombre}]` },
      { tipo: "imagen", url: `data:${adjunto.mime};base64,${bytes.toString("base64")}` },
    ];
  }

  const comoArchivo = pdfComoArchivo();
  const { texto, paginas } = await textoDePdf(bytes);
  const cuantas = paginas ? ` (${paginas} ${paginas === 1 ? "página" : "páginas"})` : "";
  const partes: ParteLlm[] = [];
  if (texto) {
    partes.push({ tipo: "texto", texto: `[PDF adjunto: ${adjunto.nombre}${cuantas}. Su texto:]\n${texto}` });
  } else {
    partes.push({
      tipo: "texto",
      texto: comoArchivo
        ? `[PDF adjunto: ${adjunto.nombre}${cuantas}. No tiene texto seleccionable: léelo del archivo.]`
        : `[PDF adjunto: ${adjunto.nombre}${cuantas}. No tiene texto seleccionable (¿escaneado?) y no se pudo leer: pide las medidas o una foto.]`,
    });
  }
  if (comoArchivo) {
    partes.push({ tipo: "archivo", nombre: adjunto.nombre, mime: adjunto.mime, datos: bytes.toString("base64") });
  }
  return partes;
}

/**
 * Las partes de todos los adjuntos de un mensaje, en orden. Con `estricto`
 * (el mensaje que se está enviando) un archivo que falta es un error; si no
 * (los del historial), queda una línea que dice que ya no está.
 */
export async function partesDeAdjuntos(adjuntos: AdjuntoCad[], estricto: boolean): Promise<ParteLlm[]> {
  const grupos = await Promise.all(
    adjuntos.map(async (a): Promise<ParteLlm[]> => {
      try {
        return await partesDeUno(a);
      } catch (e) {
        if (estricto) throw e;
        return [{ tipo: "texto", texto: `[Adjunto: ${a.nombre} — ya no está disponible]` }];
      }
    }),
  );
  return grupos.flat();
}
