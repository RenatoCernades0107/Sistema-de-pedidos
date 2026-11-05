import { notFound, redirect } from "next/navigation";
import { exigirCrearPedido } from "@/lib/sesion";
import { ROLES } from "@/lib/dominio";
import { cargarCotizacion } from "@/lib/cotizaciones-servidor";
import { detalleDesdeLineas, referenciaDe, sumaLineas } from "@/lib/cotizaciones";
import { NuevoPedidoForm, type DesdeCotizacion } from "@/components/nuevo-pedido-form";

/**
 * `/pedidos/nuevo` y, con `?cotizacion=<id>`, el mismo formulario llenado con lo
 * cotizado. El vínculo lo vuelve a comprobar `crear_pedido` al registrar; esto
 * solo evita abrir un formulario que no podría guardarse.
 */
export default async function Page({ searchParams }: PageProps<"/pedidos/nuevo">) {
  const perfil = await exigirCrearPedido();
  const { cotizacion: idCotizacion } = await searchParams;

  if (typeof idCotizacion !== "string" || !ROLES[perfil.rol].gestionarCotizaciones) {
    return <NuevoPedidoForm />;
  }

  const c = await cargarCotizacion(idCotizacion);
  if (!c) notFound();
  // Una cotización da un solo pedido: si ya lo tiene, se va a él.
  if (c.pedido) redirect(`/pedidos/${c.pedido.codigo}`);
  // Sin orden en Odoo no hay nada que confirmar: primero hay que reintentar.
  if (c.sincronizacion !== "sincronizada") redirect(`/cotizaciones/${c.id}`);

  const desde: DesdeCotizacion = {
    id: c.id,
    referencia: referenciaDe(c),
    cliente: c.cliente.nombre,
    telefono: c.cliente.telefono,
    montoTotal: c.montoTotal ?? sumaLineas(c.lineas),
    detalle: detalleDesdeLineas(c.lineas),
  };

  return <NuevoPedidoForm desdeCotizacion={desde} />;
}
