/**
 * El precio de cada formato de plancha de un grupo, según Odoo.
 *
 * Sale del índice de productos que el servidor ya tiene en memoria, así que casi
 * nunca hay viaje a Odoo: con esto el navegador calcula el corte sobre todos los
 * formatos mientras se escriben las piezas.
 */

import type { NextRequest } from "next/server";
import { almacenDeLugar } from "@/lib/almacenes";
import { cargarAlmacenes } from "@/lib/almacenes-servidor";
import { cargarGrupoPlancha, preciosDeGrupo } from "@/lib/cortes-servidor";
import type { LugarCorte } from "@/lib/cortes/guardado";
import { sobrantesDisponibles, type SobranteDisponible } from "@/lib/sobrantes-servidor";
import { error, errorDeBusqueda, puertaDeBusqueda } from "../../cotizaciones/buscar/respuesta";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RespuestaPrecios {
  /** Por código de Odoo. Un formato que no esté aquí no existe en Odoo. */
  precios: Record<string, { productoId: number; precio: number; nombre: string }>;
  /**
   * Los sobrantes que se pueden usar, en orden de uso, en el almacén de cada
   * lugar: un corte en el taller usa los del taller; uno en la tienda, los de la tienda.
   */
  sobrantes: Record<LugarCorte, SobranteDisponible[]>;
}

export async function GET(request: NextRequest) {
  const cerrada = await puertaDeBusqueda();
  if (cerrada) return cerrada;

  const id = request.nextUrl.searchParams.get("grupo") ?? "";
  if (!UUID.test(id)) return error("Falta el material.", 400);

  try {
    const grupo = await cargarGrupoPlancha(id);
    if (!grupo) return error("Ese material ya no está en el catálogo.", 404);
    const almacenes = await cargarAlmacenes();
    const delLugar = async (lugar: LugarCorte) => {
      const almacen = almacenDeLugar(almacenes, lugar);
      return grupo.sobrantesActivo && almacen ? sobrantesDisponibles(grupo.id, almacen.id) : [];
    };
    const [precios, taller, tienda] = await Promise.all([preciosDeGrupo(grupo), delLugar("taller"), delLugar("tienda")]);
    const respuesta: RespuestaPrecios = { precios: Object.fromEntries(precios), sobrantes: { taller, tienda } };
    return Response.json(respuesta);
  } catch (e) {
    return errorDeBusqueda(e);
  }
}
