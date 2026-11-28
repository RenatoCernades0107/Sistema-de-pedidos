/**
 * El DXF suelto de algunas copias de un diseño: lo que se corta aparte, en un
 * material que no está en el catálogo de planchas (MDF). Sin plancha ni acomodo:
 * las piezas acostadas en filas, como el DXF de corte de siempre.
 *
 * `{ disenoId, solo }`, con `solo` = `{ id de pieza: [copias] }` (la que dice el corte
 * conjunto). Un diseño personalizado necesita estar aprobado, como en los demás DXF.
 */

import { z } from "zod";
import { obtenerDiseno } from "@/lib/cad/disenos-servidor";
import { contornosDeDiseno, obtenerVersionLibre } from "@/lib/cad/libre-servidor";
import { exportarDxf } from "@/lib/cad/motor";
import { catalogoParaDiseno } from "@/lib/cad/pagina-servidor";
import { nombreSeguro } from "@/lib/cad/proyectos";
import { ErrorSandboxCad, exportarDxfLibre, sandboxConfigurado } from "@/lib/cad/sandbox";
import { PLANTILLA_LIBRE } from "@/lib/cad/tipos";
import { archivo, error, errorDeMotor, leerCuerpo, puertaCad } from "../respuesta";

export const maxDuration = 120;

const cuerpo = z.object({
  disenoId: z.uuid(),
  solo: z
    .record(z.string().min(1).max(64), z.array(z.number().int().min(1).max(10000)).min(1).max(500))
    .refine((s) => Object.keys(s).length >= 1 && Object.keys(s).length <= 200, "Indica qué piezas bajar."),
});

export async function POST(request: Request) {
  const cerrada = await puertaCad();
  if (cerrada) return cerrada;

  const leido = await leerCuerpo(request, cuerpo);
  if (!leido.ok) return leido.respuesta;
  const { disenoId, solo } = leido.data;

  try {
    const diseno = await obtenerDiseno(disenoId);
    if (!diseno || !diseno.plantilla) return error("El diseño ya no está disponible. Recarga la página.", 404);
    const { kerfMm } = await catalogoParaDiseno(false);
    const opciones = kerfMm > 0 ? { kerf_mm: kerfMm } : undefined;
    const nombre = `${nombreSeguro(diseno.nombre, "diseno")}-corte-aparte.dxf`;

    if (diseno.plantilla === PLANTILLA_LIBRE) {
      if (!sandboxConfigurado()) return error("Falta configurar el sandbox CAD.", 503, { codigo: "no_configurado" });
      const libre = await obtenerVersionLibre(disenoId);
      if (!libre) return error("Este diseño no tiene una versión personalizada vigente.", 404);
      if (libre.estado !== "aprobado") {
        return error("Un diseño personalizado necesita la aprobación de Administración antes de bajar el DXF.", 403, {
          codigo: "sin_aprobar",
        });
      }
      const dxf = await exportarDxfLibre(libre.codigo, opciones, await contornosDeDiseno(disenoId), solo);
      return archivo(dxf, "application/dxf", nombre);
    }
    return archivo(await exportarDxf(diseno.plantilla, diseno.parametros, opciones, solo), "application/dxf", nombre);
  } catch (e) {
    if (e instanceof ErrorSandboxCad) {
      return error(e.message, e.estado === 422 || e.estado === 503 ? e.estado : 502, { codigo: e.codigo });
    }
    return errorDeMotor(e);
  }
}
