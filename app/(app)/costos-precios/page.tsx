import { exigirCostos } from "@/lib/sesion";
import { cargarCompras } from "@/lib/compras-servidor";
import { cargarCostosYPrecios } from "@/lib/costos-servidor";
import { hoy } from "@/lib/fecha";
import { PantallaCostos } from "@/components/costos/pantalla-costos";

/**
 * Costos y precios: el 1er costo de cada plancha (costeando sus compras), el
 * 2do costo (más los gastos de operar del mes), el precio por factor y cómo han
 * variado en el tiempo. Solo Administración.
 */
export default async function Page() {
  await exigirCostos();
  const [datos, compras] = await Promise.all([cargarCostosYPrecios(), cargarCompras()]);
  return (
    <PantallaCostos
      datos={datos}
      compras={compras.filter((c) => ["recibida_parcial", "recibida", "liquidada"].includes(c.estado))}
      hoy={hoy()}
    />
  );
}
