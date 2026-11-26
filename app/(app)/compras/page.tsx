import { exigirCompras } from "@/lib/sesion";
import { cargarCompras } from "@/lib/compras-servidor";
import { odooConfigurado } from "@/lib/odoo/rpc";
import { ListaCompras } from "@/components/compras/lista-compras";

/**
 * Las compras: nacionales e importaciones. Se registran como pre-compra, se
 * confirman (orden de compra en Odoo), Almacén las recibe y aquí se cargan sus
 * gastos hasta liquidar el costo de cada plancha. Administración y Logística.
 */
export default async function Page() {
  await exigirCompras();
  const compras = await cargarCompras();
  return <ListaCompras compras={compras} odooListo={odooConfigurado()} />;
}
