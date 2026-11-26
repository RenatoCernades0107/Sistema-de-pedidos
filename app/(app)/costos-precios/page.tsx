import { exigirCostos } from "@/lib/sesion";
import { cargarCostosYPrecios } from "@/lib/costos-servidor";
import { PantallaCostos } from "@/components/costos/pantalla-costos";

/**
 * Costos y precios: el costo de adquisición de cada plancha (lo que dejan las
 * compras liquidadas), el precio de venta en Odoo, el margen y el precio que
 * sugiere el margen objetivo. Solo Administración.
 */
export default async function Page() {
  await exigirCostos();
  const datos = await cargarCostosYPrecios();
  return <PantallaCostos datos={datos} />;
}
