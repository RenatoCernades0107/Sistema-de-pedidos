"use client";

/**
 * El chat del pedido: el equipo habla del pedido sin salir de él.
 *
 * Es una conversación más del chat del equipo (tipo `pedido`, una por pedido, de
 * los tres roles): mismos mensajes, archivos, referencias @ y vistos que en
 * `/chat`, y también se abre desde ahí.
 *
 * Se abre como panel lateral: desde el botón del costado del pedido en pantallas
 * anchas y desde un botón flotante en las angostas. El estado de la conversación vive
 * aquí arriba, montado siempre, para que el globo del botón cuente los mensajes
 * sin leer de verdad (los que esta persona no vio) aunque el panel esté cerrado.
 */

import { useState } from "react";
import Link from "next/link";
import { ExternalLink, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatInicial } from "@/lib/chat/consultas";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { VistaConversacion } from "@/components/chat/chat-conversacion";
import { useConversacion } from "@/components/chat/use-conversacion";

const VACIO = "Todavía no hay mensajes. Escribe aquí lo que el equipo tenga que saber de este pedido.";

export function ChatPedido({
  conversacionId,
  codigo,
  usuarioId,
  inicial,
  abrirAlEntrar = false,
  className,
}: {
  conversacionId: string;
  codigo: string;
  /** Quien tiene la sesión: sus mensajes van a la derecha. */
  usuarioId: string;
  inicial: ChatInicial | null;
  /** Llegó desde un aviso (`?chat=1`): el panel se abre solo. */
  abrirAlEntrar?: boolean;
  className?: string;
}) {
  const [abierto, setAbierto] = useState(abrirAlEntrar);
  const chat = useConversacion({ conversacionId, usuarioId, inicial, activa: abierto });
  const sinLeer = chat.sinLeer;
  const etiqueta = `Abrir el chat del pedido${sinLeer ? ` (${sinLeer} sin leer)` : ""}`;
  const globo = sinLeer > 0 && (
    <span className="bg-destructive tnum grid min-w-5 place-items-center rounded-full px-1 text-2xs font-semibold text-white">
      {sinLeer > 99 ? "99+" : sinLeer}
    </span>
  );

  return (
    <>
      <div className={cn("bg-card hidden items-center gap-1 rounded-xl border p-1.5 lg:flex print:hidden", className)}>
        <Button
          type="button"
          variant="ghost"
          onClick={() => setAbierto(true)}
          className="flex-1 justify-start gap-2"
          aria-label={etiqueta}
        >
          <MessageCircle className="text-muted-foreground size-4" />
          Chat del pedido
          {globo && <span className="ml-auto">{globo}</span>}
        </Button>
        <Button
          render={<Link href={`/chat/${conversacionId}`} />}
          nativeButton={false}
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          aria-label="Abrir en el chat del equipo"
        >
          <ExternalLink />
        </Button>
      </div>

      <Button
        type="button"
        onClick={() => setAbierto(true)}
        className="fixed right-4 bottom-20 z-20 h-11 gap-2 rounded-full px-4 shadow-lg md:bottom-6 lg:hidden print:hidden"
        aria-label={etiqueta}
      >
        <MessageCircle className="size-4" />
        Chat
        {globo}
      </Button>

      <Sheet open={abierto} onOpenChange={setAbierto}>
        <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b">
            <SheetTitle>Chat del pedido {codigo}</SheetTitle>
            <SheetDescription>Lo ven Administración, Logística y el taller.</SheetDescription>
          </SheetHeader>
          {abierto && <VistaConversacion chat={chat} vacio={VACIO} autoFoco />}
        </SheetContent>
      </Sheet>
    </>
  );
}
