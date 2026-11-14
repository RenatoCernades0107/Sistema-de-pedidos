"use client";

/**
 * Bajar el DXF por plancha de un diseño (de plantilla o libre): de todos sus
 * grupos de plancha, en un solo archivo con cada plancha rotulada, o de un solo
 * grupo (`parcial`). Lo usan las descargas y la pestaña Planchas.
 */

import { toast } from "sonner";
import { aPlanchasMotor } from "@/lib/cad/acomodo";
import { aPlanchasMotorDeGrupos, type PlanchasDeGrupo } from "@/lib/cad/materiales";
import { PLANTILLA_LIBRE, type ResultadoGeneracion } from "@/lib/cad/tipos";

/** Hace que el navegador guarde unos bytes como si se hubiera pulsado un enlace de descarga. */
export function guardarArchivo(blob: Blob, nombre: string) {
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombre;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  // En el siguiente ciclo: Safari cancela la descarga si la URL se revoca antes.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Las planchas de los grupos tal como las pide el motor, cada una con su rótulo. */
export const planchasParaDxf = (grupos: readonly PlanchasDeGrupo[]) => aPlanchasMotorDeGrupos(grupos, aPlanchasMotor);

/** Pide el DXF por plancha y lo guarda. `false` si falló (ya avisado). */
export async function bajarDxfPlanchas(entrada: {
  resultado: ResultadoGeneracion;
  disenoId: string;
  grupos: readonly PlanchasDeGrupo[];
  kerfMm: number;
  /** Solo estos grupos, no todo el diseño. */
  parcial?: boolean;
  nombre: string;
}): Promise<boolean> {
  const { resultado, disenoId, grupos, kerfMm, parcial } = entrada;
  const libre = resultado.plantilla === PLANTILLA_LIBRE;
  const opciones = { kerf_mm: kerfMm, ...(parcial ? { parcial: true } : {}) };
  try {
    const res = await fetch("/api/cad/dxf-planchas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // De un diseño libre el código no viaja: el servidor lo lee de la versión vigente.
      body: JSON.stringify(
        libre
          ? { disenoId, planchas: planchasParaDxf(grupos), opciones }
          : { plantilla: resultado.plantilla, parametros: resultado.parametros, planchas: planchasParaDxf(grupos), opciones },
      ),
    });
    if (!res.ok) {
      const cuerpo = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(cuerpo.error ?? "No se pudo generar el archivo.");
      return false;
    }
    guardarArchivo(await res.blob(), entrada.nombre);
    return true;
  } catch {
    toast.error("No se pudo descargar el archivo. Revisa tu conexión.");
    return false;
  }
}

/** «acrilico-eco-cristal-3-mm», para el nombre del archivo de un grupo. */
export const sufijoDeGrupo = (etiqueta: string) =>
  etiqueta
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
