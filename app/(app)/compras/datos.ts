import { cargarInventario } from "@/lib/stock-servidor";
import { tarifasManoObra, tipoDeCambioSugerido } from "@/lib/compras-servidor";
import { ingresables } from "@/lib/inventario";

/** Lo que necesita el editor de una compra: almacenes, productos, TC y tarifas. */
export async function datosDelEditor() {
  const [inventario, tc, tarifas] = await Promise.all([
    cargarInventario({ verPrecios: false, gestionaStock: true }),
    tipoDeCambioSugerido(),
    tarifasManoObra(),
  ]);
  return {
    almacenes: inventario.almacenes,
    productos: ingresables(inventario.planchas, inventario.accesorios),
    tcSugerido: tc.tc,
    tarifas,
  };
}
