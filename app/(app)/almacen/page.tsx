import { exigirAlmacen } from "@/lib/sesion";
import { ROLES } from "@/lib/dominio";
import { cargarCatalogoPlanchas } from "@/lib/cortes-servidor";
import { odooConfigurado } from "@/lib/odoo/rpc";
import { cargarCasos } from "@/lib/casos-servidor";
import { cargarConteo, cargarConteos } from "@/lib/conteos-servidor";
import { cargarFaltantes } from "@/lib/faltantes-servidor";
import { cargarSobrantes } from "@/lib/sobrantes-servidor";
import { cargarIngresos, cargarInventario, preciosDeSobrantes } from "@/lib/stock-servidor";
import { comprasPorRecibir } from "@/lib/compras-servidor";
import { cargarTransferencias, enCamino } from "@/lib/transferencias-servidor";
import { PantallaAlmacen, type Vista } from "@/components/almacen/pantalla-almacen";

const VISTAS: Vista[] = ["planchas", "accesorios", "sobrantes", "mover", "movimientos", "casos", "conteos"];

/**
 * El almacén: lo que hay de cada plancha y cada accesorio en cada almacén
 * (Andahuaylas, Católica, Esmeraldas…), los sobrantes, lo que hay que mover
 * para los pedidos, y los movimientos (transferencias e ingresos).
 *
 * Lo ven los tres roles. Ingresar stock, transferir, crear productos y registrar
 * sobrantes es de Administración y Logística; cambiar precios, solo de
 * Administración. El precio no lo ve el taller. Recibir una transferencia lo
 * puede hacer cualquiera: el taller recibe lo que le llega.
 */
export default async function Page({ searchParams }: PageProps<"/almacen">) {
  const perfil = await exigirAlmacen();
  const permisos = ROLES[perfil.rol];
  const params = await searchParams;
  const pedida = params.vista;
  const codigoConteo = typeof params.conteo === "string" ? params.conteo : null;
  // "ingresos" era la pestaña de antes: ahora está en Movimientos.
  const vista = pedida === "ingresos" ? "movimientos" : (VISTAS.find((v) => v === pedida) ?? "planchas");

  const verPrecios = permisos.verPrecios;
  const gestiona = permisos.gestionarStock;
  const [inventario, sobrantes, catalogo, ingresos, transferencias, faltantes, casos, conteos, conteo, porRecibir] = await Promise.all([
    cargarInventario({ verPrecios, gestionaStock: permisos.gestionarStock }),
    cargarSobrantes(),
    cargarCatalogoPlanchas(true),
    permisos.gestionarStock ? cargarIngresos() : Promise.resolve([]),
    cargarTransferencias(),
    permisos.gestionarStock ? cargarFaltantes() : Promise.resolve([]),
    gestiona ? cargarCasos() : Promise.resolve([]),
    gestiona ? cargarConteos() : Promise.resolve([]),
    gestiona && codigoConteo ? cargarConteo(codigoConteo) : Promise.resolve(null),
    gestiona ? comprasPorRecibir() : Promise.resolve([]),
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
      transferencias={transferencias}
      faltantes={faltantes}
      enCamino={enCamino(transferencias)}
      casos={casos}
      conteos={conteos}
      conteo={conteo}
      porRecibir={porRecibir}
      permisos={{
        gestionarStock: permisos.gestionarStock,
        editarPrecios: permisos.editarPrecios,
        cerrarCasos: permisos.cerrarCasos,
        verPrecios,
        recibirTransferencias: permisos.recibirTransferencias,
      }}
      odooConectado={odooConfigurado()}
    />
  );
}
