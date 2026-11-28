import { exigirCompras } from "@/lib/sesion";
import { cargarCompras } from "@/lib/compras-servidor";
import { odooConfigurado } from "@/lib/odoo/rpc";
import { cargarBorradores } from "@/lib/borradores-servidor";
import { ListaBorradores } from "@/components/borradores/lista-borradores";
import { ListaCompras } from "@/components/compras/lista-compras";

/**
 * Las compras: nacionales e importaciones. Se registran como pre-compra, se
 * confirman (orden de compra en Odoo), Almacén las recibe y aquí se cargan sus
 * gastos hasta liquidar el costo de cada plancha. Administración y Logística.
 */
export default async function Page() {
  await exigirCompras();
  const [compras, borradores] = await Promise.all([cargarCompras(), cargarBorradores("compra")]);
  return (
    <>
      {borradores.length > 0 && (
        <div className="px-4 pt-5 md:px-6">
          <ListaBorradores borradores={borradores} nombre="compra" />
        </div>
      )}
      <ListaCompras compras={compras} odooListo={odooConfigurado()} />
    </>
  );
}
