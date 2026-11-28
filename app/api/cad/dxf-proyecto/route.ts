/**
 * El DXF por planchas de un proyecto: las piezas de TODOS sus diseños acomodadas
 * juntas en las planchas del catálogo (`lib/cad/proyecto-corte.ts`).
 *
 * `{ proyectoId, grupo? }`: sin `grupo`, todas las planchas en un archivo, cada una
 * rotulada; con él (la `clave` de un grupo del corte), solo las de ese material.
 *
 * El acomodo se recalcula aquí, con las versiones vigentes (el navegador no manda
 * ni código ni coordenadas), y no se baja nada mientras algo lo impida: un diseño
 * personalizado sin aprobar, uno sin material o una pieza que no cabe. Lo que se
 * corta aparte (MDF) no va en las planchas: tiene su propio DXF (`dxf-suelto`).
 */

import { z } from "zod";
import { calcularCorteProyecto, planchasParaDxfProyecto } from "@/lib/cad/proyecto-corte-servidor";
import { nombreSeguro } from "@/lib/cad/proyectos";
import { ErrorSandboxCad, exportarDxfProyecto, sandboxConfigurado } from "@/lib/cad/sandbox";
import { archivo, error, leerCuerpo, puertaCad } from "../respuesta";

export const maxDuration = 120;

const cuerpo = z.object({
  proyectoId: z.uuid(),
  grupo: z.string().min(1).max(300).optional(),
});

export async function POST(request: Request) {
  const cerrada = await puertaCad();
  if (cerrada) return cerrada;

  const leido = await leerCuerpo(request, cuerpo);
  if (!leido.ok) return leido.respuesta;
  if (!sandboxConfigurado()) return error("Falta configurar el sandbox CAD.", 503, { codigo: "no_configurado" });

  const { proyectoId, grupo } = leido.data;
  try {
    const corte = await calcularCorteProyecto(proyectoId);
    if (!corte) return error("El proyecto ya no está disponible. Recarga la página.", 404);
    if (corte.vista.problemas.length > 0) {
      return error("El corte conjunto todavía tiene problemas que resolver.", 409, {
        codigo: "corte_con_problemas",
        errores: corte.vista.problemas.map((mensaje) => ({ campo: "proyecto", mensaje })),
      });
    }
    const dxf = planchasParaDxfProyecto(corte, grupo);
    if (!dxf) {
      return error(
        grupo ? "Ese material ya no está en el corte del proyecto. Vuelve a calcularlo." : "No hay piezas que acomodar en planchas.",
        409,
        { codigo: "sin_planchas" },
      );
    }
    const contenido = await exportarDxfProyecto(dxf.disenos, dxf.planchas, { kerf_mm: corte.kerfMm });
    const sufijo = grupo ? `-${nombreSeguro(corte.grupos.find((g) => g.clave === grupo)?.etiqueta ?? "grupo", "grupo")}` : "";
    return archivo(contenido, "application/dxf", `${nombreSeguro(corte.vista.proyecto.nombre)}-planchas${sufijo}.dxf`);
  } catch (e) {
    if (e instanceof ErrorSandboxCad) {
      return error(e.message, e.estado === 422 || e.estado === 503 ? e.estado : 502, {
        codigo: e.codigo,
        ...(e.errores ? { errores: e.errores } : {}),
      });
    }
    console.error("[cad] dxf de proyecto", e);
    return error("No se pudo generar el archivo. Intenta de nuevo.", 500);
  }
}
