import { exigirChat } from "@/lib/sesion";
import { EstructuraChat } from "@/components/chat/estructura-chat";

/**
 * La lista de conversaciones vive aquí y no en cada página: al pasar de una
 * conversación a otra solo cambia la columna de la derecha.
 */
export default async function Layout({ children }: LayoutProps<"/chat">) {
  const perfil = await exigirChat();
  return (
    <EstructuraChat usuarioId={perfil.id} esAdmin={perfil.rol === "administracion"}>
      {children}
    </EstructuraChat>
  );
}
