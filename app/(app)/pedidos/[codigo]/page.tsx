import { DetallePedido } from "@/components/detalle-pedido";
import { cargarLineasDePedido, cargarOdooDePedido } from "@/lib/pedido-odoo-servidor";
import { cargarSobrantesDePedido } from "@/lib/sobrantes-servidor";
import { clienteServidor } from "@/lib/supabase-servidor";
import { tokenSeguimiento } from "@/lib/compartir-servidor";
import { perfilActual } from "@/lib/sesion";
import { leerChatInicial } from "@/lib/chat/consultas";

/**
 * El pedido en sí sale del layout, que ya cargó la lista entera. Lo que se lee
 * aquí es lo que solo hace falta al abrirlo: sus productos y cortes, cómo va su
 * venta en Odoo y, con el piloto de sobrantes, lo que devolvió al almacén. Un
 * fallo al leerlos no tumba el detalle.
 */
export default async function Page({ params, searchParams }: PageProps<"/pedidos/[codigo]">) {
  const codigo = decodeURIComponent((await params).codigo);
  // Los avisos de menciones en el chat del pedido llevan aquí con `?chat=1`.
  const abrirChat = (await searchParams).chat === "1";
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
      chat={chat && { ...chat, abrir: abrirChat }}
    />
  );
}

/**
 * El chat del pedido: su conversación (se crea la primera vez que alguien abre
 * el pedido), quién mira y la primera página de mensajes. Si la primera página
 * falla, el chat sale igual y la pide desde el navegador.
 */
async function cargarChat(codigo: string) {
  const supabase = await clienteServidor();
  const [perfil, { data: pedido }] = await Promise.all([
    perfilActual(),
    supabase.from("pedidos").select("id").eq("codigo", codigo).maybeSingle(),
  ]);
  if (!perfil || !pedido) return null;

  const { data: conversacionId, error } = await supabase.rpc("conversacion_de_pedido", { p_pedido_id: pedido.id });
  if (error || !conversacionId) throw new Error(error?.message ?? "Sin conversación");

  const inicial = await leerChatInicial(supabase, conversacionId).catch((e) => {
    console.error("[pedidos] chat, primera página", e);
    return null;
  });
  return { conversacionId, usuarioId: perfil.id, inicial };
}
