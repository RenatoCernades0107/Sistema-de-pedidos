/** El DXF por plancha: las piezas acomodadas en las planchas del material elegido. */

import { nombreArchivo } from "@/lib/cad/esquema";
import { exportarDxfPlanchas } from "@/lib/cad/motor";
import { archivo, cuerpoDxfPlanchas, errorDeMotor, leerCuerpo, puertaCad } from "../respuesta";

export async function POST(request: Request) {
  const cerrada = await puertaCad();
  if (cerrada) return cerrada;

  const cuerpo = await leerCuerpo(request, cuerpoDxfPlanchas);
  if (!cuerpo.ok) return cuerpo.respuesta;
  const { plantilla, parametros, planchas, opciones } = cuerpo.data;

  try {
    const dxf = await exportarDxfPlanchas(plantilla, parametros, planchas, opciones);
    return archivo(dxf, "application/dxf", nombreArchivo(plantilla, null, "dxf"));
  } catch (e) {
    return errorDeMotor(e);
  }
}
