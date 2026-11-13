/**
 * Descargas de un diseño libre: `{ disenoId, formato: "dxf" | "step" }`.
 *
 * El DXF es el archivo que va a producción: solo se entrega si la versión
 * vigente está APROBADA por Administración. El STEP sirve para revisar y se
 * entrega también en borrador.
 */

import { z } from "zod";
import { obtenerVersionLibre } from "@/lib/cad/libre-servidor";
import { ErrorSandboxCad, exportarDxfLibre, exportarStepLibre, sandboxConfigurado } from "@/lib/cad/sandbox";
import { archivo, error, leerCuerpo, puertaCad } from "../../respuesta";

export const maxDuration = 120;

const cuerpo = z.object({
  disenoId: z.uuid(),
  formato: z.enum(["dxf", "step"]),
  opciones: z.object({ kerf_mm: z.number().min(0).max(5).optional() }).optional(),
});

export async function POST(request: Request) {
  const cerrada = await puertaCad();
  if (cerrada) return cerrada;

  const leido = await leerCuerpo(request, cuerpo);
  if (!leido.ok) return leido.respuesta;
  if (!sandboxConfigurado()) return error("Falta configurar el sandbox CAD.", 503, { codigo: "no_configurado" });

  const { disenoId, formato, opciones } = leido.data;
  try {
    const libre = await obtenerVersionLibre(disenoId);
    if (!libre) return error("Este diseño no tiene una versión personalizada vigente.", 404);
    if (formato === "dxf" && libre.estado !== "aprobado") {
      return error("Un diseño personalizado necesita la aprobación de Administración antes de bajar el DXF.", 403, {
        codigo: "sin_aprobar",
      });
    }
    const nombre = `diseno-personalizado-v${libre.version}.${formato}`;
    return formato === "dxf"
      ? archivo(await exportarDxfLibre(libre.codigo, opciones), "application/dxf", nombre)
      : archivo(await exportarStepLibre(libre.codigo), "application/step", nombre);
  } catch (e) {
    if (e instanceof ErrorSandboxCad) {
      return error(e.message, e.estado === 422 || e.estado === 503 ? e.estado : 502, { codigo: e.codigo });
    }
    console.error("[cad] libre descarga", e);
    return error("No se pudo generar el archivo. Intenta de nuevo.", 500);
  }
}
