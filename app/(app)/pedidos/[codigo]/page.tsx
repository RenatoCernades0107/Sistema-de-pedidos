import { DetallePedido } from "@/components/detalle-pedido";
import { cargarLineasDePedido, cargarOdooDePedido } from "@/lib/pedido-odoo-servidor";

/**
 * El pedido en sí sale del layout, que ya cargó la lista entera. Lo que se lee
 * aquí es lo que solo hace falta al abrirlo: sus productos y cortes, y cómo va
 * su venta en Odoo. Un fallo al leerlos no tumba el detalle.
 */
export default async function Page({ params }: PageProps<"/pedidos/[codigo]">) {
  const codigo = decodeURIComponent((await params).codigo);

  const [lineas, odoo] = await Promise.all([
    cargarLineasDePedido(codigo).catch((e) => {
      console.error("[pedidos] líneas", e);
      return null;
    }),
    cargarOdooDePedido(codigo).catch((e) => {
      console.error("[pedidos] odoo", e);
      return null;
    }),
  ]);

  return <DetallePedido codigo={codigo} lineas={lineas} odoo={odoo} />;
}
