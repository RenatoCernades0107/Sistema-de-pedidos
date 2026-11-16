import { DetallePedido } from "@/components/detalle-pedido";
import { cargarLineasDePedido, cargarOdooDePedido } from "@/lib/pedido-odoo-servidor";
import { cargarSobrantesDePedido } from "@/lib/sobrantes-servidor";
import { cargarAlmacenes } from "@/lib/almacenes-servidor";
import { cargarCatalogoPlanchas } from "@/lib/cortes-servidor";
import { clienteServidor } from "@/lib/supabase-servidor";
import { tokenSeguimiento } from "@/lib/compartir-servidor";
import { perfilActual } from "@/lib/sesion";
import { aMensaje, COLUMNAS_MENSAJE } from "@/lib/chat-pedido";

/**
 * El pedido en sí sale del layout, que ya cargó la lista entera. Lo que se lee
 * aquí es lo que solo hace falta al abrirlo: sus productos y cortes, cómo va su
 * venta en Odoo y, con el piloto de sobrantes, lo que devolvió al almacén. Un
 * fallo al leerlos no tumba el detalle.
 */
export default async function Page({ params }: PageProps<"/pedidos/[codigo]">) {
  const codigo = decodeURIComponent((await params).codigo);
  const supabase = await clienteServidor();

  const [lineas, odoo, sobrantes, retazo, token, chat, almacenes, catalogo] = await Promise.all([
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
  ]);

  return (
    <DetallePedido
      codigo={codigo}
      lineas={lineas}
      odoo={odoo}
      sobrantes={sobrantes}
      retazoMin={retazo.data ?? undefined}
      almacenes={almacenes}
      catalogo={catalogo}
      tokenSeguimiento={token}
      chat={chat}
    />
  );
}

/** El chat del pedido: su id (el canal en vivo filtra por él), quién mira y lo ya escrito. */
async function cargarChat(codigo: string) {
  const supabase = await clienteServidor();
  const [perfil, { data: pedido }] = await Promise.all([
    perfilActual(),
    supabase.from("pedidos").select("id").eq("codigo", codigo).maybeSingle(),
  ]);
  if (!perfil || !pedido) return null;

  const { data, error } = await supabase
    .from("pedido_mensajes")
    .select(COLUMNAS_MENSAJE)
    .eq("pedido_id", pedido.id)
    .order("creado_en", { ascending: true });
  if (error) throw new Error(error.message);

  return { pedidoId: pedido.id, usuarioId: perfil.id, mensajes: (data ?? []).map(aMensaje) };
}
