import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { exigirChat } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase-servidor";
import { leerChatInicial } from "@/lib/chat/consultas";
import { Button } from "@/components/ui/button";
import { PantallaConversacion, type InfoConversacion } from "@/components/chat/pantalla-conversacion";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Una conversación. La primera página de mensajes, quién participa y quién vio
 * qué llegan con el HTML; lo que siga, por Realtime. Si la RLS no la deja ver
 * (un directo ajeno, un canal del que salió) se dice eso y nada más.
 */
export default async function Page({ params }: PageProps<"/chat/[id]">) {
  const perfil = await exigirChat();
  const { id } = await params;
  const supabase = await clienteServidor();

  const { data: conv } = UUID.test(id)
    ? await supabase
        .from("conversaciones")
        .select("id, tipo, nombre, descripcion, pedido_id")
        .eq("id", id)
        .maybeSingle()
    : { data: null };

  if (!conv) return <SinAcceso />;

  const [inicial, codigo] = await Promise.all([
    leerChatInicial(supabase, conv.id).catch((e) => {
      // Sin la primera página, la pantalla la pide sola desde el navegador.
      console.error("[chat] primera página", e);
      return null;
    }),
    conv.pedido_id
      ? supabase
          .from("pedidos")
          .select("codigo")
          .eq("id", conv.pedido_id)
          .maybeSingle()
          .then(({ data }) => data?.codigo ?? null)
      : Promise.resolve(null),
  ]);

  const info: InfoConversacion = {
    id: conv.id,
    tipo: conv.tipo,
    nombre: conv.tipo === "pedido" ? `Pedido ${codigo ?? ""}`.trim() : (conv.nombre ?? "Mensaje directo"),
    descripcion: conv.descripcion,
    pedidoCodigo: codigo,
  };

  return (
    <PantallaConversacion
      key={conv.id}
      info={info}
      usuarioId={perfil.id}
      esAdmin={perfil.rol === "administracion"}
      inicial={inicial}
    />
  );
}

function SinAcceso() {
  return (
    <div className="m-auto flex max-w-xs flex-col items-center gap-3 p-6 text-center">
      <h2 className="font-semibold">Esta conversación no está disponible</h2>
      <p className="text-muted-foreground text-sm">No existe o ya no participas en ella.</p>
      <Button render={<Link href="/chat" />} nativeButton={false} variant="outline">
        <ArrowLeft /> Volver al chat
      </Button>
    </div>
  );
}
