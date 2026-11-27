/**
 * Los adjuntos del chat de diseños, convertidos en lo que lee el modelo.
 *
 * Se bajan de Storage con la sesión de quien escribe (la política del bucket
 * es la de `cad_mensajes`) y se arman como partes del mensaje:
 *   · imagen → una parte `imagen` con su `data:`.
 *   · PDF    → el PDF entero, como parte `archivo`. El proveedor ya le da al
 *              modelo el texto Y la imagen de cada página: sacarle aquí el
 *              texto también sería pagarlo dos veces, y en un plano el texto
 *              de pdf.js sale desordenado (las cotas sueltas, sin su dibujo).
 *              Solo con `INFERHUB_PDF=texto` (pasarelas que no aceptan
 *              archivos) se manda el texto de pdf.js en su lugar.
 * Cada archivo va precedido de una línea que lo nombra, para que el asistente
 * pueda referirse a él ("en plano.pdf…").
 */

import { clienteServidor } from "@/lib/supabase-servidor";
import { pdfComoArchivo, type ParteLlm } from "@/lib/llm/inferhub";
import { BUCKET_CAD_ADJUNTOS, esImagenAdjunto, type AdjuntoCad } from "@/lib/cad/adjuntos";
import { paginasDePdf } from "@/lib/pdf-texto";

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

async function descargar(adjunto: AdjuntoCad, bucket: string): Promise<Buffer> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase.storage.from(bucket).download(adjunto.ruta);
  if (error || !data) throw new AdjuntoNoDisponible(adjunto.nombre);
  return Buffer.from(await data.arrayBuffer());
}

/** El texto de un PDF y cuántas páginas tiene. Si no se puede leer, sin texto. */
async function textoDePdf(bytes: Buffer): Promise<{ texto: string; paginas: number | null }> {
  try {
    const { paginas, total } = await paginasDePdf(bytes, {
      maxPaginas: MAX_PAGINAS_PDF,
      maxCaracteres: MAX_CARACTERES_PDF,
    });
    let texto = paginas.map((p) => `— Página ${p.numero} —\n${p.texto}`).join("\n\n");
    if (texto.length > MAX_CARACTERES_PDF) texto = `${texto.slice(0, MAX_CARACTERES_PDF)}\n[…texto recortado]`;
    return { texto, paginas: total };
  } catch (e) {
    console.error("[cad] adjuntos: leer el PDF", e);
    return { texto: "", paginas: null };
  }
}

/** Las partes de un archivo para el modelo. */
async function partesDeUno(adjunto: AdjuntoCad, bucket: string): Promise<ParteLlm[]> {
  const bytes = await descargar(adjunto, bucket);

  if (esImagenAdjunto(adjunto.mime)) {
    return [
      { tipo: "texto", texto: `[Imagen adjunta: ${adjunto.nombre}]` },
      { tipo: "imagen", url: `data:${adjunto.mime};base64,${bytes.toString("base64")}` },
    ];
  }

  if (pdfComoArchivo()) {
    return [
      { tipo: "texto", texto: `[PDF adjunto: ${adjunto.nombre}]` },
      { tipo: "archivo", nombre: adjunto.nombre, mime: adjunto.mime, datos: bytes.toString("base64") },
    ];
  }

  // Sin archivos en la pasarela: solo queda el texto (sin dibujos ni escaneados).
  const { texto, paginas } = await textoDePdf(bytes);
  const cuantas = paginas ? ` (${paginas} ${paginas === 1 ? "página" : "páginas"})` : "";
  return [
    {
      tipo: "texto",
      texto: texto
        ? `[PDF adjunto: ${adjunto.nombre}${cuantas}. Solo se pudo leer su texto, sin los dibujos; puede venir desordenado:]\n${texto}`
        : `[PDF adjunto: ${adjunto.nombre}${cuantas}. No tiene texto seleccionable (¿escaneado?) y no se pudo leer: pide las medidas o una foto.]`,
    },
  ];
}

/**
 * Las partes de todos los adjuntos de un mensaje, en orden. Con `estricto`
 * (el mensaje que se está enviando) un archivo que falta es un error; si no
 * (los del historial), queda una línea que dice que ya no está.
 *
 * `bucket`: de dónde se bajan. Por defecto los del chat de diseños; el agente de
 * WhatsApp usa los mismos adjuntos (misma forma de ruta) en `agente_adjuntos`.
 */
export async function partesDeAdjuntos(
  adjuntos: AdjuntoCad[],
  estricto: boolean,
  bucket: string = BUCKET_CAD_ADJUNTOS,
): Promise<ParteLlm[]> {
  const grupos = await Promise.all(
    adjuntos.map(async (a): Promise<ParteLlm[]> => {
      try {
        return await partesDeUno(a, bucket);
      } catch (e) {
        if (estricto) throw e;
        return [{ tipo: "texto", texto: `[Adjunto: ${a.nombre} — ya no está disponible]` }];
      }
    }),
  );
  return grupos.flat();
}
