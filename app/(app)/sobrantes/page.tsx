import { exigirSesion } from "@/lib/sesion";
import { cargarCatalogoPlanchas } from "@/lib/cortes-servidor";
import { odooConfigurado } from "@/lib/odoo/rpc";
import { cargarSobrantes } from "@/lib/sobrantes-servidor";
import { PantallaSobrantes } from "@/components/sobrantes/pantalla-sobrantes";

/**
 * Los sobrantes del almacén. La ven los tres roles: el taller es quien los mide
 * y los guarda.
 */
export default async function Page() {
  await exigirSesion();
  const [sobrantes, catalogo] = await Promise.all([cargarSobrantes(), cargarCatalogoPlanchas(true)]);
  return <PantallaSobrantes sobrantes={sobrantes} catalogo={catalogo} odooConectado={odooConfigurado()} />;
}
