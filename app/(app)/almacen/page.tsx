import { exigirAlmacen } from "@/lib/sesion";
import { ROLES } from "@/lib/dominio";
import { cargarCatalogoPlanchas } from "@/lib/cortes-servidor";
import { odooConfigurado } from "@/lib/odoo/rpc";
import { cargarSobrantes } from "@/lib/sobrantes-servidor";
import { cargarIngresos, cargarInventario, preciosDeSobrantes } from "@/lib/stock-servidor";
import { PantallaAlmacen, type Vista } from "@/components/almacen/pantalla-almacen";

const VISTAS: Vista[] = ["planchas", "accesorios", "sobrantes", "ingresos"];

/**
 * El almacén: lo que hay de cada plancha y cada accesorio en cada almacén
 * (Andahuaylas, Católica, Esmeraldas…), los ingresos de stock y los sobrantes.
 *
 * Lo ven los tres roles. Ingresar stock, crear productos y registrar sobrantes es
 * de Administración y Logística; cambiar precios, solo de Administración. El
 * precio no lo ve el taller.
 */
export default async function Page({ searchParams }: PageProps<"/almacen">) {
  const perfil = await exigirAlmacen();
  const permisos = ROLES[perfil.rol];
  const pedida = (await searchParams).vista;
  const vista = VISTAS.find((v) => v === pedida) ?? "planchas";

  const verPrecios = permisos.gestionarStock;
  const [inventario, sobrantes, catalogo, ingresos] = await Promise.all([
    cargarInventario({ verPrecios, gestionaStock: permisos.gestionarStock }),
    cargarSobrantes(),
    cargarCatalogoPlanchas(true),
    permisos.gestionarStock ? cargarIngresos() : Promise.resolve([]),
  ]);
  const precios = verPrecios ? await preciosDeSobrantes(sobrantes, catalogo) : {};

  return (
    <PantallaAlmacen
      vista={vista}
      inventario={inventario}
      sobrantes={sobrantes}
      preciosSobrantes={precios}
      catalogo={catalogo}
      ingresos={ingresos}
      permisos={{
        gestionarStock: permisos.gestionarStock,
        editarPrecios: permisos.editarPrecios,
        verPrecios,
      }}
      odooConectado={odooConfigurado()}
    />
  );
}
