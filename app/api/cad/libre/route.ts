/**
 * Diseño libre para el visor: ejecuta en el sandbox el código de la versión
 * vigente y devuelve lo mismo que `/api/cad/generar` (`plantilla: "libre"`,
 * `parametros: {}`) más `libre` (código, estado y versión).
 *
 * El código se lee de la base, no del cuerpo: el navegador no puede mandar a
 * ejecutar código propio.
 */

import { z } from "zod";
import { obtenerVersionLibre } from "@/lib/cad/libre-servidor";
import { ErrorSandboxCad, ejecutarCodigo, sandboxConfigurado } from "@/lib/cad/sandbox";
import { PLANTILLA_LIBRE } from "@/lib/cad/tipos";
import { error, leerCuerpo, puertaCad } from "../respuesta";

export const maxDuration = 120;

const cuerpo = z.object({ disenoId: z.uuid() });

export async function POST(request: Request) {
  const cerrada = await puertaCad();
  if (cerrada) return cerrada;

  const leido = await leerCuerpo(request, cuerpo);
  if (!leido.ok) return leido.respuesta;

  if (!sandboxConfigurado()) {
    return error("El diseño personalizado no está disponible: falta configurar el sandbox CAD.", 503, {
      codigo: "no_configurado",
    });
  }

  try {
    const libre = await obtenerVersionLibre(leido.data.disenoId);
    if (!libre) return error("Este diseño no tiene una versión personalizada vigente.", 404);
    const r = await ejecutarCodigo(libre.codigo);
    return Response.json({
      plantilla: PLANTILLA_LIBRE,
      version_plantilla: 1,
      parametros: {},
      dimensiones: r.dimensiones,
      glb_base64: r.glb_base64,
      piezas: r.piezas,
      validaciones: r.validaciones,
      libre,
    });
  } catch (e) {
    if (e instanceof ErrorSandboxCad) {
      const estado = e.estado === 422 || e.estado === 503 ? e.estado : 502;
      if (estado === 502) console.error("[cad] sandbox", e.estado, e.codigo, e.message);
      return error(e.message, estado, { codigo: e.codigo });
    }
    console.error("[cad] libre", e);
    return error("No se pudo generar el diseño personalizado. Intenta de nuevo.", 500);
  }
}
