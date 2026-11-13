/**
 * Genera el diseño de una plantilla con unos parámetros: el GLB para el visor,
 * el despiece y las validaciones. Lo llama el contexto de `/disenos` cada vez
 * que cambia un parámetro, así que no guarda nada: persistir es cosa de
 * `guardarVersion`.
 */

import { generarDiseno } from "@/lib/cad/motor";
import { cuerpoGenerar, errorDeMotor, leerCuerpo, puertaCad } from "../respuesta";

export async function POST(request: Request) {
  const cerrada = await puertaCad();
  if (cerrada) return cerrada;

  const cuerpo = await leerCuerpo(request, cuerpoGenerar);
  if (!cuerpo.ok) return cuerpo.respuesta;

  try {
    return Response.json(await generarDiseno(cuerpo.data.plantilla, cuerpo.data.parametros));
  } catch (e) {
    return errorDeMotor(e);
  }
}
