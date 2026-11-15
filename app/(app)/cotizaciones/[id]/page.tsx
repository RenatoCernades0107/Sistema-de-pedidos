import { notFound } from "next/navigation";
import { exigirCotizaciones } from "@/lib/sesion";
import { ROLES } from "@/lib/dominio";
import { cargarConfigCotizaciones, cargarCotizacion } from "@/lib/cotizaciones-servidor";
import { enlaceOdoo } from "@/lib/odoo/rpc";
import { DetalleCotizacion } from "@/components/cotizaciones/detalle-cotizacion";

export default async function Page({ params }: PageProps<"/cotizaciones/[id]">) {
  const perfil = await exigirCotizaciones();
  const { id } = await params;
  const [cotizacion, config] = await Promise.all([cargarCotizacion(id), cargarConfigCotizaciones()]);
  if (!cotizacion) notFound();

  return (
    <DetalleCotizacion
      cotizacion={cotizacion}
      enlaceOdoo={cotizacion.odooOrderId ? enlaceOdoo("sale.order", cotizacion.odooOrderId) : null}
      puedeAsistente={ROLES[perfil.rol].usarAgenteCotizacion}
      puedeCrearPedido={ROLES[perfil.rol].crearPedido}
      validezDias={config.validezDias}
    />
  );
}
