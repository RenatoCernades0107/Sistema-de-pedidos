/** Las plantillas del motor CAD, con el esquema del que sale cada formulario. */

import { listarPlantillas } from "@/lib/cad/motor";
import { errorDeMotor, puertaCad } from "../respuesta";

export async function GET() {
  const cerrada = await puertaCad();
  if (cerrada) return cerrada;

  try {
    return Response.json(await listarPlantillas());
  } catch (e) {
    return errorDeMotor(e);
  }
}
