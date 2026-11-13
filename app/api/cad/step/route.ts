/** El STEP del conjunto armado, para abrirlo en otro programa de CAD. */

import { nombreArchivo } from "@/lib/cad/esquema";
import { exportarStep } from "@/lib/cad/motor";
import { archivo, cuerpoGenerar, errorDeMotor, leerCuerpo, puertaCad } from "../respuesta";

export async function POST(request: Request) {
  const cerrada = await puertaCad();
  if (cerrada) return cerrada;

  const cuerpo = await leerCuerpo(request, cuerpoGenerar);
  if (!cuerpo.ok) return cuerpo.respuesta;
  const { plantilla, parametros } = cuerpo.data;

  try {
    const step = await exportarStep(plantilla, parametros);
    return archivo(step, "application/step", nombreArchivo(plantilla, null, "step"));
  } catch (e) {
    return errorDeMotor(e);
  }
}
