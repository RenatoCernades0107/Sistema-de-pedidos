/**
 * La herramienta `extraer_contorno_pdf`, del lado del servidor: busca el PDF
 * entre los adjuntos del diseño, saca el contorno vectorial de la región con
 * `lib/pdf-vector.ts`, lo guarda en `cad_contornos` y devuelve la medida y una
 * previsualización para que el modelo compruebe que es el logo.
 *
 * Nunca lanza por un problema del PDF o de lo que pidió el modelo: devuelve
 * `{ ok: false, codigo, mensaje }` para que lo corrija. Lo inesperado (la base,
 * Storage) sí sube.
 */

import { AdjuntoNoDisponible, descargarAdjunto } from "@/lib/cad/adjuntos-servidor";
import type { AdjuntoCad } from "@/lib/cad/adjuntos";
import { ContornoRepetido, guardarContorno } from "@/lib/cad/libre-servidor";
import { ErrorContorno, extraerContornoVectorial, previsualizarContorno, type RegionPagina } from "@/lib/pdf-vector";

export type PeticionContorno = {
  /** El nombre del archivo PDF, como lo adjuntó la persona. */
  adjunto: string;
  pagina: number;
  region: RegionPagina;
  nombre: string;
  anchoMm: number;
  incluirTrazos?: boolean;
};

export type ResultadoContorno =
  | { ok: true; anchoMm: number; altoMm: number; trazos: number; segmentos: number; previsualizacion: string }
  | { ok: false; codigo: string; mensaje: string };

const falla = (codigo: string, mensaje: string): ResultadoContorno => ({ ok: false, codigo, mensaje });

/** El PDF más reciente con ese nombre (sin distinguir mayúsculas), entre los adjuntos de la conversación. */
export function buscarPdf(adjuntos: readonly AdjuntoCad[], nombre: string): AdjuntoCad | undefined {
  const quiero = nombre.trim().toLowerCase();
  return [...adjuntos].reverse().find((a) => a.mime === "application/pdf" && a.nombre.trim().toLowerCase() === quiero);
}

export async function extraerYGuardarContorno(
  disenoId: string,
  adjuntos: readonly AdjuntoCad[],
  peticion: PeticionContorno,
): Promise<ResultadoContorno> {
  const pdf = buscarPdf(adjuntos, peticion.adjunto);
  if (!pdf) {
    const hay = [...new Set(adjuntos.filter((a) => a.mime === "application/pdf").map((a) => a.nombre))];
    return falla(
      "adjunto_no_encontrado",
      hay.length
        ? `No hay un PDF adjunto llamado «${peticion.adjunto}». PDF disponibles: ${hay.join(", ")}.`
        : "En esta conversación no hay ningún PDF adjunto. Pídele a la persona que lo adjunte.",
    );
  }
  let bytes: Buffer;
  try {
    bytes = await descargarAdjunto(pdf);
  } catch (e) {
    if (e instanceof AdjuntoNoDisponible) return falla("adjunto_no_disponible", `${e.message} Pídele a la persona que lo vuelva a adjuntar.`);
    throw e;
  }

  let contorno;
  try {
    contorno = await extraerContornoVectorial(bytes, {
      pagina: peticion.pagina,
      region: peticion.region,
      anchoMm: peticion.anchoMm,
      incluirTrazos: peticion.incluirTrazos,
    });
  } catch (e) {
    if (e instanceof ErrorContorno) return falla("contorno_no_encontrado", e.message);
    // Un PDF que pdf.js no puede abrir (dañado, con contraseña).
    console.error("[cad] extraer contorno del PDF", e);
    return falla("pdf_ilegible", `No se pudo leer «${pdf.nombre}» como PDF vectorial (¿está dañado o tiene contraseña?).`);
  }

  try {
    await guardarContorno({
      disenoId,
      nombre: peticion.nombre,
      contorno: { ancho_mm: contorno.anchoMm, alto_mm: contorno.altoMm, trazos: contorno.trazos },
      origen: { adjunto: pdf.nombre, pagina: peticion.pagina, region: peticion.region },
    });
  } catch (e) {
    if (e instanceof ContornoRepetido) {
      return falla(
        "nombre_repetido",
        `Ya hay un contorno llamado «${peticion.nombre}» en este diseño (no se pisan: las versiones anteriores dependen de él). Usa otro nombre, por ejemplo «${peticion.nombre}_2».`,
      );
    }
    throw e;
  }

  const png = await previsualizarContorno(contorno);
  return {
    ok: true,
    anchoMm: contorno.anchoMm,
    altoMm: contorno.altoMm,
    trazos: contorno.trazos.length,
    segmentos: contorno.segmentos,
    previsualizacion: `data:image/png;base64,${png}`,
  };
}
