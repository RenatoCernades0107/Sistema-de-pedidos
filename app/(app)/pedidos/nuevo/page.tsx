import { after } from "next/server";
import { notFound, redirect } from "next/navigation";
import { exigirCrearPedido } from "@/lib/sesion";
import { ROLES } from "@/lib/dominio";
import { cargarCotizacion } from "@/lib/cotizaciones-servidor";
import { referenciaDe, sumaLineas } from "@/lib/cotizaciones";
import { cargarCatalogoPlanchas, cargarConfigCortes } from "@/lib/cortes-servidor";
import { calentarCatalogos } from "@/lib/odoo/catalogos";
import { odooConfigurado } from "@/lib/odoo/rpc";
import { AvisoOdoo } from "@/components/cotizaciones/aviso-odoo";
import { NuevoPedidoForm, type DesdeCotizacion } from "@/components/nuevo-pedido-form";

/**
 * `/pedidos/nuevo` y, con `?cotizacion=<id>`, el mismo formulario con lo
 * cotizado ya puesto. El vínculo lo vuelve a comprobar `crear_pedido` al
 * registrar; esto solo evita abrir un formulario que no podría guardarse.
 */
export default async function Page({ searchParams }: PageProps<"/pedidos/nuevo">) {
  const perfil = await exigirCrearPedido();
  const { cotizacion: idCotizacion } = await searchParams;

  // Los pedidos se arman con el cliente y los productos de Odoo.
  if (!ROLES[perfil.rol].gestionarCotizaciones || !odooConfigurado()) {
    return (
      <div className="px-4 py-5 md:px-6 md:py-6">
        <h1 className="mb-4 text-xl font-semibold tracking-tight">Nuevo pedido</h1>
        <AvisoOdoo className="max-w-3xl" />
      </div>
    );
  }

  let desde: DesdeCotizacion | undefined;
  if (typeof idCotizacion === "string") {
    const c = await cargarCotizacion(idCotizacion);
    if (!c) notFound();
    // Una cotización da un solo pedido: si ya lo tiene, se va a él.
    if (c.pedido) redirect(`/pedidos/${c.pedido.codigo}`);
    // Sin orden en Odoo no hay nada que confirmar: primero hay que reintentar.
    if (c.sincronizacion !== "sincronizada") redirect(`/cotizaciones/${c.id}`);

    desde = {
      id: c.id,
      referencia: referenciaDe(c),
      cliente: { nombre: c.cliente.nombre, documento: c.cliente.documento, telefono: c.cliente.telefono },
      lineas: c.lineas,
      total: c.montoTotal ?? sumaLineas(c.lineas),
      totalEnOdoo: c.montoTotal !== null,
    };
  }

  // Mientras la página llega al navegador, el servidor va cargando los catálogos
  // de Odoo: así la primera búsqueda no espera la carga entera.
  after(() => calentarCatalogos());
  const [catalogo, config] = await Promise.all([cargarCatalogoPlanchas(true), cargarConfigCortes()]);

  return <NuevoPedidoForm catalogo={catalogo} config={config} desdeCotizacion={desde} />;
}
