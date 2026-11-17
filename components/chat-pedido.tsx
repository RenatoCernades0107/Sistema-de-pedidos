"use client";

/**
 * El chat del pedido: el equipo habla del pedido sin salir de él.
 *
 * Es una conversación más del chat del equipo (tipo `pedido`, una por pedido, de
 * los tres roles): mismos mensajes, archivos, referencias @ y vistos que en
 * `/chat`, y también se abre desde ahí.
 *
 * Empieza cerrado: un botón en la esquina lo abre como panel lateral derecho.
 * El estado de la conversación vive aquí arriba, montado siempre y en vivo,
 * para que la bolita roja del botón cuente los mensajes sin leer de verdad (los
 * que esta persona no vio) aunque el panel esté cerrado. Solo con el panel
 * abierto lo que llega se marca como visto.
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

  return (
    <>
      <Button
        type="button"
        onClick={() => setAbierto(true)}
        className={cn(
          "fixed right-4 bottom-20 z-20 h-11 gap-2 rounded-full px-4 shadow-lg md:right-6 md:bottom-6 print:hidden",
          abierto && "hidden",
          className,
        )}
        aria-label={`Abrir el chat del pedido${sinLeer ? ` (${sinLeer} sin leer)` : ""}`}
      >
        <MessageCircle className="size-4" />
        Chat
        {sinLeer > 0 && (
          <span className="absolute -top-1.5 -right-1.5 grid" aria-hidden>
            <span className="bg-destructive col-start-1 row-start-1 size-full animate-ping rounded-full opacity-60 motion-reduce:hidden" />
            <span className="bg-destructive ring-background tnum col-start-1 row-start-1 grid h-5 min-w-5 place-items-center rounded-full px-1 text-2xs font-semibold text-white ring-2">
              {sinLeer > 99 ? "99+" : sinLeer}
            </span>
          </span>
        )}
      </Button>

      <Sheet open={abierto} onOpenChange={setAbierto}>
        <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
          <SheetHeader className="flex-row items-start gap-2 border-b">
            <div className="min-w-0 flex-1">
              <SheetTitle>Chat del pedido {codigo}</SheetTitle>
              <SheetDescription>Lo ven Administración, Logística y el taller.</SheetDescription>
            </div>
            <Button
              render={<Link href={`/chat/${conversacionId}`} />}
              nativeButton={false}
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground mr-8"
              aria-label="Abrir en el chat del equipo"
              title="Abrir en el chat del equipo"
            >
              <ExternalLink />
            </Button>
          </SheetHeader>
          {abierto && <VistaConversacion chat={chat} vacio={VACIO} autoFoco />}
        </SheetContent>
      </Sheet>
    </>
  );
}
