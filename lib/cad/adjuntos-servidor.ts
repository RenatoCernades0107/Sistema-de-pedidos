/**
 * Los adjuntos del chat de diseños, convertidos en lo que lee el modelo.
 *
 * Se bajan de Storage con la sesión de quien escribe (la política del bucket
 * es la de `cad_mensajes`) y se arman como partes del mensaje:
 *   · imagen → una parte `imagen` con su `data:`.
 *   · PDF    → por defecto, cada página como imagen (más el texto): las
 *              pasarelas descartan en silencio las partes `archivo` y el modelo
 *              se quedaba con solo el nombre. Con `INFERHUB_PDF=archivo`, el PDF
 *              entero, como parte `archivo`; con `INFERHUB_PDF=texto`
 *              (pasarelas sin imágenes ni archivos), solo el texto de pdf.js,
 *              que en un plano sale desordenado (cotas sueltas, sin dibujo).
 *              Si pasar a imágenes falla, también se cae al texto.
 * Cada archivo va precedido de una línea que lo nombra, para que el asistente
 * pueda referirse a él ("en plano.pdf…").
 */

import { clienteServidor } from "@/lib/supabase-servidor";
import { modoPdf, type ParteLlm } from "@/lib/llm/inferhub";
import { BUCKET_CAD_ADJUNTOS, esImagenAdjunto, rutaNueva, type AdjuntoCad } from "@/lib/cad/adjuntos";
import { paginasDePdf } from "@/lib/pdf-texto";
import { imagenesDePdf } from "@/lib/pdf-imagenes";

/** Cuánto texto de un PDF se le pasa al modelo, como mucho. */
const MAX_CARACTERES_PDF = 30_000;
/** De cuántas páginas se saca el texto. */
const MAX_PAGINAS_PDF = 40;
/** Cuántas páginas se le pasan como imagen (cada una cuesta tokens de imagen). */
const MAX_PAGINAS_IMAGEN = 8;

/** Un archivo adjunto que ya no está en Storage (o no se pudo leer). */
export class AdjuntoNoDisponible extends Error {
  constructor(readonly nombre: string) {
    super(`El archivo «${nombre}» ya no está disponible.`);
    this.name = "AdjuntoNoDisponible";
  }
}

/** Los bytes de un adjunto, con la sesión de quien escribe. Lanza `AdjuntoNoDisponible` si ya no está. */
export async function descargarAdjunto(adjunto: AdjuntoCad, bucket: string = BUCKET_CAD_ADJUNTOS): Promise<Buffer> {
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
  const bytes = await descargarAdjunto(adjunto, bucket);

  if (esImagenAdjunto(adjunto.mime)) {
    return [
      { tipo: "texto", texto: `[Imagen adjunta: ${adjunto.nombre}]` },
      { tipo: "imagen", url: `data:${adjunto.mime};base64,${bytes.toString("base64")}` },
    ];
  }

  const modo = modoPdf();

  if (modo === "imagenes") {
    try {
      const { paginas, total } = await imagenesDePdf(bytes, { maxPaginas: MAX_PAGINAS_IMAGEN });
      if (paginas.length) {
        const aviso = total > paginas.length ? ` Solo se muestran las primeras ${paginas.length} de ${total} páginas.` : "";
        const { texto } = await textoDePdf(bytes);
        return [
          { tipo: "texto", texto: `[PDF adjunto: ${adjunto.nombre} (${total} ${total === 1 ? "página" : "páginas"}), como imágenes.${aviso}]` },
          ...paginas.flatMap((p): ParteLlm[] => [
            { tipo: "texto", texto: `[${adjunto.nombre}, página ${p.numero}]` },
            { tipo: "imagen", url: `data:image/png;base64,${p.png}` },
          ]),
          ...(texto ? [{ tipo: "texto" as const, texto: `[Texto del PDF, por si ayuda a leer las cotas; puede venir desordenado:]\n${texto}` }] : []),
        ];
      }
    } catch (e) {
      // Sin canvas o PDF raro: se cae al texto, como con INFERHUB_PDF=texto.
      console.error("[cad] adjuntos: pasar el PDF a imágenes", e);
    }
  } else if (modo === "archivo") {
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

/**
 * Copia archivos adjuntos a la carpeta de otro diseño (Storage `copy`, sin bajarlos):
 * cada uno recibe una ruta nueva, así que borrar un diseño no deja al otro sin su
 * plano. Un archivo que ya no está se omite y se nombra en `fallidos`.
 */
export async function copiarAdjuntos(
  origen: readonly AdjuntoCad[],
  disenoDestino: string,
  bucket: string = BUCKET_CAD_ADJUNTOS,
): Promise<{ copiados: AdjuntoCad[]; fallidos: string[] }> {
  const supabase = await clienteServidor();
  const copiados: AdjuntoCad[] = [];
  const fallidos: string[] = [];
  for (const a of origen) {
    const ruta = rutaNueva(disenoDestino, a.mime);
    const { error } = await supabase.storage.from(bucket).copy(a.ruta, ruta);
    if (error) {
      console.error("[cad] copiar adjunto", a.ruta, error.message);
      fallidos.push(a.nombre);
    } else {
      copiados.push({ ...a, ruta });
    }
  }
  return { copiados, fallidos };
}
