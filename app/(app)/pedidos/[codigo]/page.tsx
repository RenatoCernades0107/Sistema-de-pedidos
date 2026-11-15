import { DetallePedido } from "@/components/detalle-pedido";
import { cargarLineasDePedido, cargarOdooDePedido } from "@/lib/pedido-odoo-servidor";
import { cargarSobrantesDePedido } from "@/lib/sobrantes-servidor";
import { clienteServidor } from "@/lib/supabase-servidor";
import { tokenSeguimiento } from "@/lib/compartir-servidor";
import { perfilActual } from "@/lib/sesion";

/**
 * El pedido en sí sale del layout, que ya cargó la lista entera. Lo que se lee
 * aquí es lo que solo hace falta al abrirlo: sus productos y cortes, cómo va su
 * venta en Odoo y, con el piloto de sobrantes, lo que devolvió al almacén. Un
 * fallo al leerlos no tumba el detalle.
 */
export default async function Page({ params }: PageProps<"/pedidos/[codigo]">) {
  const codigo = decodeURIComponent((await params).codigo);
  const supabase = await clienteServidor();

  const [lineas, odoo, sobrantes, retazo, token, chat] = await Promise.all([
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
    tokenSeguimiento(codigo),
    cargarChat(codigo).catch((e) => {
      console.error("[pedidos] chat", e);
      return null;
    }),
  ]);

  return (
    <DetallePedido
      codigo={codigo}
      lineas={lineas}
      odoo={odoo}
      sobrantes={sobrantes}
      retazoMin={retazo.data ?? undefined}
      tokenSeguimiento={token}
      chat={chat}
    />
  );
}

/**
 * El chat del pedido. PROVISORIO mientras se pasa al chat unificado
 * (`lib/chat/tipos.ts`, migración 20261129000100): `pedido_mensajes` ya no existe.
 */
async function cargarChat(codigo: string) {
  void codigo;
  return null;
}
