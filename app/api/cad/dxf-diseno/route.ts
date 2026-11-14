/**
 * El DXF de producción de una versión concreta de un diseño, para la hoja de
 * corte del pedido: `{ disenoId, version }`.
 *
 * De plantilla: las piezas del motor acomodadas en las planchas que se guardaron
 * con esa versión (`/dxf/planchas`); si la versión no guardó acomodo, el
 * despiece suelto. Libre: lo mismo pero con el sandbox (el código se lee de la
 * base), y solo si la versión está aprobada.
 */

import { z } from "zod";
import { aPlanchasMotor } from "@/lib/cad/acomodo";
import { leerAcomodoGuardado } from "@/lib/cad/materiales";
import type { PlanchaAcomodadaCad } from "@/lib/cad/tipos";
import { deParametros } from "@/lib/cad/disenos-servidor";
import { exportarDxf, exportarDxfPlanchas } from "@/lib/cad/motor";
import {
  ErrorSandboxCad,
  exportarDxfLibre,
  exportarDxfPlanchasLibre,
  sandboxConfigurado,
} from "@/lib/cad/sandbox";
import { PLANTILLA_LIBRE } from "@/lib/cad/tipos";
import { clienteServidor } from "@/lib/supabase-servidor";
import {
  archivo,
  error,
  errorDeMotor,
  leerCuerpo,
  puertaCad,
} from "../respuesta";

export const maxDuration = 120;

const cuerpo = z.object({
  disenoId: z.uuid(),
  version: z.number().int().positive(),
});

/**
 * Las planchas guardadas con la versión (de todos sus grupos de material y
 * espesor, cada una rotulada) y su kerf. `null` si no guardó planchas.
 */
function conPlanchas(
  guardado: unknown,
): { planchas: PlanchaAcomodadaCad[]; kerf?: { kerf_mm: number } } | null {
  const leido = leerAcomodoGuardado(guardado);
  if (!leido) return null;
  return {
    planchas: leido.grupos.flatMap((g) =>
      aPlanchasMotor(g).map((p) => (g.etiqueta ? { ...p, etiqueta: g.etiqueta } : p)),
    ),
    kerf: leido.kerfMm !== null ? { kerf_mm: leido.kerfMm } : undefined,
  };
}

export async function POST(request: Request) {
  const cerrada = await puertaCad();
  if (cerrada) return cerrada;

  const leido = await leerCuerpo(request, cuerpo);
  if (!leido.ok) return leido.respuesta;
  const { disenoId, version } = leido.data;

  const supabase = await clienteServidor();
  const { data: v } = await supabase
    .from("cad_diseno_versiones")
    .select("version, plantilla, parametros, estado, codigo, acomodo")
    .eq("diseno_id", disenoId)
    .eq("version", version)
    .maybeSingle();
  if (!v) return error("No se encontró esa versión del diseño.", 404);

  const nombre = `diseno-v${v.version}`;
  try {
    if (v.plantilla === PLANTILLA_LIBRE) {
      if (v.estado !== "aprobado" || !v.codigo) {
        return error(
          "El diseño personalizado no está aprobado: no se puede bajar el DXF.",
          403,
          { codigo: "sin_aprobar" },
        );
      }
      if (!sandboxConfigurado())
        return error("Falta configurar el sandbox CAD.", 503, {
          codigo: "no_configurado",
        });
      const guardado = conPlanchas(v.acomodo);
      if (guardado) {
        const dxf = await exportarDxfPlanchasLibre(
          v.codigo,
          guardado.planchas,
          guardado.kerf,
        );
        return archivo(dxf, "application/dxf", `${nombre}-planchas.dxf`);
      }
      return archivo(
        await exportarDxfLibre(v.codigo),
        "application/dxf",
        `${nombre}.dxf`,
      );
    }

    const parametros = deParametros(v.parametros);
    const guardado = conPlanchas(v.acomodo);
    if (guardado) {
      const dxf = await exportarDxfPlanchas(
        v.plantilla,
        parametros,
        guardado.planchas,
        guardado.kerf,
      );
      return archivo(dxf, "application/dxf", `${nombre}-planchas.dxf`);
    }
    return archivo(
      await exportarDxf(v.plantilla, parametros),
      "application/dxf",
      `${nombre}.dxf`,
    );
  } catch (e) {
    if (e instanceof ErrorSandboxCad) {
      return error(
        e.message,
        e.estado === 422 || e.estado === 503 ? e.estado : 502,
        { codigo: e.codigo, ...(e.errores ? { errores: e.errores } : {}) },
      );
    }
    return errorDeMotor(e);
  }
}
