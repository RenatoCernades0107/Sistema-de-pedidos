/**
 * El DXF por plancha: las piezas acomodadas en las planchas del material elegido.
 *
 * De plantilla: `{ plantilla, parametros, planchas, opciones? }` al motor.
 * Libre: `{ disenoId, planchas, opciones? }` al sandbox, con el código de la
 * versión vigente leído de la base (el navegador no manda código) y solo si
 * está aprobada: es el archivo que va a producción.
 */

import { z } from "zod";
import { nombreArchivo } from "@/lib/cad/esquema";
import { obtenerVersionLibre } from "@/lib/cad/libre-servidor";
import { exportarDxfPlanchas } from "@/lib/cad/motor";
import { ErrorSandboxCad, exportarDxfPlanchasLibre, sandboxConfigurado } from "@/lib/cad/sandbox";
import { archivo, cuerpoDxfPlanchas, error, errorDeMotor, leerCuerpo, puertaCad } from "../respuesta";

export const maxDuration = 120;

const cuerpoLibre = cuerpoDxfPlanchas.pick({ planchas: true, opciones: true }).extend({ disenoId: z.uuid() });

const cuerpo = z.union([cuerpoLibre, cuerpoDxfPlanchas]);

export async function POST(request: Request) {
  const cerrada = await puertaCad();
  if (cerrada) return cerrada;

  const leido = await leerCuerpo(request, cuerpo);
  if (!leido.ok) return leido.respuesta;

  if ("disenoId" in leido.data) {
    const { disenoId, planchas, opciones } = leido.data;
    if (!sandboxConfigurado()) return error("Falta configurar el sandbox CAD.", 503, { codigo: "no_configurado" });
    try {
      const libre = await obtenerVersionLibre(disenoId);
      if (!libre) return error("Este diseño no tiene una versión personalizada vigente.", 404);
      if (libre.estado !== "aprobado") {
        return error("Un diseño personalizado necesita la aprobación de Administración antes de bajar el DXF.", 403, {
          codigo: "sin_aprobar",
        });
      }
      const dxf = await exportarDxfPlanchasLibre(libre.codigo, planchas, opciones);
      return archivo(dxf, "application/dxf", `diseno-personalizado-v${libre.version}-planchas.dxf`);
    } catch (e) {
      if (e instanceof ErrorSandboxCad) {
        return error(e.message, e.estado === 422 || e.estado === 503 ? e.estado : 502, {
          codigo: e.codigo,
          ...(e.errores ? { errores: e.errores } : {}),
        });
      }
      console.error("[cad] libre dxf por plancha", e);
      return error("No se pudo generar el archivo. Intenta de nuevo.", 500);
    }
  }

  const { plantilla, parametros, planchas, opciones } = leido.data;
  try {
    const dxf = await exportarDxfPlanchas(plantilla, parametros, planchas, opciones);
    return archivo(dxf, "application/dxf", nombreArchivo(plantilla, null, "dxf"));
  } catch (e) {
    return errorDeMotor(e);
  }
}
