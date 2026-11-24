import { notFound } from "next/navigation";
import { exigirCotizaciones } from "@/lib/sesion";
import { ROLES } from "@/lib/dominio";
import { almacenDeDespacho, cargarConfigCotizaciones, cargarCotizacion } from "@/lib/cotizaciones-servidor";
import { cargarAlmacenes } from "@/lib/almacenes-servidor";
import { faltantesPrevistos } from "@/lib/faltantes-servidor";
import { cotizacionPorToken } from "@/lib/compartir-servidor";
import { enlaceOdoo } from "@/lib/odoo/rpc";
import { DetalleCotizacion } from "@/components/cotizaciones/detalle-cotizacion";

export default async function Page({ params }: PageProps<"/cotizaciones/[id]">) {
  const perfil = await exigirCotizaciones();
  const { id } = await params;
  const [cotizacion, config, almacenes] = await Promise.all([
    cargarCotizacion(id),
    cargarConfigCotizaciones(),
    cargarAlmacenes(),
  ]);
  if (!cotizacion) notFound();
  // El elegido o, si nadie eligió, el que da la regla (taller si algo se produce allí).
  const despacho = await almacenDeDespacho(cotizacion).catch(() => null);
  // Mientras no tiene pedido: lo que faltaría con ese despacho, para cambiarlo o mover stock a tiempo.
  const previstos =
    despacho && !cotizacion.pedido ? await faltantesPrevistos(cotizacion.lineas, despacho.id) : null;

  // Las cuentas que se pueden poner en el PDF (las mismas que verá el cliente).
  const cuentasPdf = cotizacion.tokenPublico
    ? await cotizacionPorToken(cotizacion.tokenPublico).then((r) => r?.cuentas ?? [], () => [])
    : [];

  return (
    <DetalleCotizacion
      cotizacion={cotizacion}
      enlaceOdoo={cotizacion.odooOrderId ? enlaceOdoo("sale.order", cotizacion.odooOrderId) : null}
      puedeAsistente={ROLES[perfil.rol].usarAgenteCotizacion}
      puedeCrearPedido={ROLES[perfil.rol].crearPedido}
      validezDias={config.validezDias}
      cuentasPdf={cuentasPdf}
      almacenes={almacenes}
      despachoId={despacho?.id ?? null}
      faltantes={previstos?.ok ? previstos.faltantes : null}
    />
  );
}
