/** El DXF del despiece: todas las piezas acostadas, en mm, para la cortadora. */

import { nombreArchivo } from "@/lib/cad/esquema";
import { exportarDxf } from "@/lib/cad/motor";
import { archivo, cuerpoDxf, errorDeMotor, leerCuerpo, puertaCad } from "../respuesta";

export async function POST(request: Request) {
  const cerrada = await puertaCad();
  if (cerrada) return cerrada;

  const cuerpo = await leerCuerpo(request, cuerpoDxf);
  if (!cuerpo.ok) return cuerpo.respuesta;
  const { plantilla, parametros, opciones } = cuerpo.data;

  try {
    const dxf = await exportarDxf(plantilla, parametros, opciones);
    // El nombre con medidas lo pone el navegador, que tiene el resultado a mano;
    // este es el que queda si alguien llama a la ruta directamente.
    return archivo(dxf, "application/dxf", nombreArchivo(plantilla, null, "dxf"));
  } catch (e) {
    return errorDeMotor(e);
  }
}
