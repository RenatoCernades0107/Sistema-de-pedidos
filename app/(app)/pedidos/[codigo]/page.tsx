import { DetallePedido } from "@/components/detalle-pedido";
import { cargarLineasDePedido, cargarOdooDePedido } from "@/lib/pedido-odoo-servidor";
import { cargarSobrantesDePedido } from "@/lib/sobrantes-servidor";
import { clienteServidor } from "@/lib/supabase-servidor";

/**
 * El pedido en sí sale del layout, que ya cargó la lista entera. Lo que se lee
 * aquí es lo que solo hace falta al abrirlo: sus productos y cortes, cómo va su
 * venta en Odoo y, con el piloto de sobrantes, lo que devolvió al almacén. Un
 * fallo al leerlos no tumba el detalle.
 */
export default async function Page({ params }: PageProps<"/pedidos/[codigo]">) {
  const codigo = decodeURIComponent((await params).codigo);
  const supabase = await clienteServidor();

  const [lineas, odoo, sobrantes, retazo] = await Promise.all([
    cargarLineasDePedido(codigo).catch((e) => {
      console.error("[pedidos] líneas", e);
      return null;
    }),
    cargarOdooDePedido(codigo).catch((e) => {
      console.error("[pedidos] odoo", e);
      return null;
    }),
    cargarSobrantesDePedido(codigo).catch((e) => {
      console.error("[pedidos] sobrantes", e);
      return [];
    }),
    supabase.rpc("retazo_minimo"),
  ]);

  return (
    <DetallePedido
      codigo={codigo}
      lineas={lineas}
      odoo={odoo}
      sobrantes={sobrantes}
      retazoMin={retazo.data ?? undefined}
    />
  );
}
