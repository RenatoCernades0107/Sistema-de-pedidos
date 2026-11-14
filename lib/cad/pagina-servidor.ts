/**
 * Lo que cargan en el servidor las pantallas de diseño (`/disenos/[id]` y el
 * producto terminado de `/pedidos/nuevo`): las plantillas del motor y el
 * catálogo de planchas con sus precios.
 */

import { cargarCatalogoPlanchas, cargarConfigCortes } from "@/lib/cortes-servidor";
import type { GrupoPlancha } from "@/lib/cortes/catalogo";
import { productosPorCodigo } from "@/lib/odoo/catalogos";
import type { CostosDiseno } from "@/components/disenos/diseno-contexto";
import { ErrorMotorCad, listarPlantillas } from "@/lib/cad/motor";
import type { PlantillaCad } from "@/lib/cad/tipos";

/**
 * Las plantillas del motor CAD. El motor es un servicio aparte y puede no estar:
 * en ese caso la pantalla se pinta igual —el chat y lo guardado siguen ahí— con
 * el motivo a la vista, en vez de caer en el límite de error de `(app)`.
 */
export async function plantillasDelMotor(): Promise<{ plantillas: PlantillaCad[]; aviso: string | null }> {
  try {
    return { plantillas: await listarPlantillas(), aviso: null };
  } catch (e) {
    if (!(e instanceof ErrorMotorCad)) throw e;
    console.error("[cad] plantillas", e.estado, e.codigo, e.message);
    return { plantillas: [], aviso: e.message };
  }
}

/**
 * El catálogo de planchas para elegir el material. Sin él, el diseño se usa igual.
 * Con `conPrecios` (solo Administración) trae también lo que cuesta cada plancha
 * en Odoo, para el panel de costo.
 */
export async function catalogoParaDiseno(conPrecios: boolean): Promise<{
  grupos: GrupoPlancha[];
  kerfMm: number;
  margenMm: number;
  costos: CostosDiseno | null;
}> {
  try {
    const [grupos, config] = await Promise.all([cargarCatalogoPlanchas(true), cargarConfigCortes()]);
    let costos: CostosDiseno | null = null;
    if (conPrecios) {
      try {
        const productos = await productosPorCodigo(grupos.flatMap((g) => g.formatos.map((f) => f.codigo)));
        costos = { config, precios: Object.fromEntries([...productos].map(([c, p]) => [c, p.precio])) };
      } catch (e) {
        // Sin Odoo el diseño se usa igual; el panel de costo dice que no hay precios.
        console.error("[cad] precios de planchas", e);
        costos = { config, precios: {} };
      }
    }
    // La configuración de cortes está en cm; el diseño, en mm.
    return { grupos, kerfMm: config.corte.kerfLaser * 10, margenMm: config.corte.margen * 10, costos };
  } catch (e) {
    console.error("[cad] catálogo de planchas", e);
    return { grupos: [], kerfMm: 0, margenMm: 0, costos: null };
  }
}

