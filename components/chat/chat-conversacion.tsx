"use client";

/**
 * Una conversación completa (mensajes + compositor), la misma en `/chat/<id>` y
 * en el chat del pedido. `ChatConversacion` trae su propio estado;
 * `VistaConversacion` pinta uno que ya existe, para quien necesita el estado
 * más arriba (el pedido cuenta los no leídos aunque el panel esté cerrado).
 */

import { useRef } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { ChatInicial } from "@/lib/chat/consultas";
import { Compositor, type CompositorManejo } from "./compositor";
import { useConversacion, type Conversacion } from "./use-conversacion";
import { VistaMensajes } from "./vista-mensajes";

export interface PropsVista {
  /** En un directo no hace falta el nombre de quien habla sobre cada burbuja. */
  mostrarAutor?: boolean;
  /** Lo que se lee cuando todavía no hay mensajes. */
  vacio?: React.ReactNode;
  autoFoco?: boolean;
  placeholder?: string;
  className?: string;
}

export function VistaConversacion({
  chat,
  mostrarAutor,
  vacio,
  autoFoco,
  placeholder,
  className,
}: PropsVista & { chat: Conversacion }) {
  const compositor = useRef<CompositorManejo>(null);

  // "Editar" un mensaje que no salió: vuelve al cuadro si no pisa lo que se está escribiendo.
  const recuperar = (localId: string) => {
    if (!compositor.current?.estaVacio()) {
      toast.info("Primero envía o borra lo que estás escribiendo");
      return;
    }
    const borrador = chat.recuperar(localId);
    if (borrador) compositor.current.restaurar(borrador);
  };

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <VistaMensajes chat={chat} mostrarAutor={mostrarAutor} vacio={vacio} onRecuperar={recuperar} />
      <Compositor ref={compositor} chat={chat} autoFoco={autoFoco} placeholder={placeholder} />
    </div>
  );
}

export function ChatConversacion({
  conversacionId,
  usuarioId,
  inicial,
  activa = true,
  ...vista
}: PropsVista & {
  conversacionId: string;
  /** Quien tiene la sesión: sus mensajes van a la derecha y llevan los vistos. */
  usuarioId: string;
  /** La primera página, si ya la leyó el servidor. */
  inicial?: ChatInicial | null;
  /** Está en pantalla: lo que llega se marca como visto. */
  activa?: boolean;
}) {
  const chat = useConversacion({ conversacionId, usuarioId, inicial, activa });
  return <VistaConversacion chat={chat} {...vista} />;
}
