import { DetallePedido } from "@/components/detalle-pedido";
import { cargarLineasDePedido, cargarOdooDePedido } from "@/lib/pedido-odoo-servidor";
import { cargarSobrantesDePedido } from "@/lib/sobrantes-servidor";
import { cargarAlmacenes } from "@/lib/almacenes-servidor";
import { faltantesDePedido } from "@/lib/faltantes-servidor";
import { cargarCatalogoPlanchas } from "@/lib/cortes-servidor";
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

  const [lineas, odoo, sobrantes, retazo, token, chat, almacenes, catalogo, faltantes] = await Promise.all([
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
    // Al pasar a Listo se dice a qué almacén se fue cada sobrante, y de qué material es.
    cargarAlmacenes().catch((e) => {
      console.error("[pedidos] almacenes", e);
      return [];
    }),
    cargarCatalogoPlanchas(true).catch((e) => {
      console.error("[pedidos] catálogo", e);
      return [];
    }),
    // Lo que le falta donde se produce o se despacha (lo ve quien ve el pedido).
    faltantesDeCodigo(codigo).catch((e) => {
      console.error("[pedidos] faltantes", e);
      return [];
    }),
  ]);

  return (
    <DetallePedido
      codigo={codigo}
      lineas={lineas}
      odoo={odoo}
      sobrantes={sobrantes}
      faltantes={faltantes}
      retazoMin={retazo.data ?? undefined}
      almacenes={almacenes}
      catalogo={catalogo}
      tokenSeguimiento={token}
      chat={chat && { ...chat, abrir: abrirChat }}
    />
  );
}

/** Lo que le falta al pedido donde se produce o se despacha. */
async function faltantesDeCodigo(codigo: string) {
  const supabase = await clienteServidor();
  const { data } = await supabase.from("pedidos").select("id").eq("codigo", codigo).maybeSingle();
  return data ? faltantesDePedido(data.id) : [];
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
