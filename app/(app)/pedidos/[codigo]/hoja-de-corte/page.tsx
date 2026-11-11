import { HojaCorte } from "@/components/hoja-corte";
import { cargarLineasDePedido } from "@/lib/pedido-odoo-servidor";

/**
 * La hoja de corte imprimible. El pedido sale del layout, como en el detalle; las
 * líneas, de `lineas_de_pedido()`, que a quien no es Administración se las da sin
 * precios. La hoja no enseña precios a nadie.
 */
export default async function Page({ params }: PageProps<"/pedidos/[codigo]/hoja-de-corte">) {
  const codigo = decodeURIComponent((await params).codigo);
  const lineas = await cargarLineasDePedido(codigo);
  return <HojaCorte codigo={codigo} lineas={lineas} />;
}
