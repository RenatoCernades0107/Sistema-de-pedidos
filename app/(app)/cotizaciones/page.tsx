import { exigirCotizaciones } from "@/lib/sesion";
import { ROLES } from "@/lib/dominio";
import { cargarCotizaciones } from "@/lib/cotizaciones-servidor";
import { odooConfigurado } from "@/lib/odoo/rpc";
import { ListaCotizaciones } from "@/components/cotizaciones/lista-cotizaciones";
import { ListaBorradores } from "@/components/borradores/lista-borradores";
import { cargarBorradores } from "@/lib/borradores-servidor";

/**
 * Las cotizaciones del sistema. Las que se registran aquí y las que crea el
 * asistente (`/cotizaciones/asistente`) terminan en la misma lista: las dos
 * tienen su `sale.order` en Odoo.
 */
export default async function Page() {
  const perfil = await exigirCotizaciones();
  const [cotizaciones, borradores] = await Promise.all([cargarCotizaciones(), cargarBorradores("cotizacion")]);
  return (
    <ListaCotizaciones
      cotizaciones={cotizaciones}
      puedeAsistente={ROLES[perfil.rol].usarAgenteCotizacion}
      odooListo={odooConfigurado()}
      borradores={<ListaBorradores borradores={borradores} nombre="cotización" />}
    />
  );
}
