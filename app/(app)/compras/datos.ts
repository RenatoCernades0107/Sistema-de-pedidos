import { cargarInventario } from "@/lib/stock-servidor";
import { tipoDeCambioSugerido } from "@/lib/compras-servidor";
import { ingresables } from "@/lib/inventario";

/** Lo que necesita el editor de una compra: almacenes, productos y el TC. */
export async function datosDelEditor() {
  const [inventario, tc] = await Promise.all([cargarInventario({ verPrecios: false, gestionaStock: true }), tipoDeCambioSugerido()]);
  return {
    almacenes: inventario.almacenes,
    productos: ingresables(inventario.planchas, inventario.accesorios),
    tcSugerido: tc.tc,
  };
}
