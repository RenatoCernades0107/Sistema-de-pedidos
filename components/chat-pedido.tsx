"use client";

/**
 * El chat del pedido: el equipo habla del pedido sin salir de él.
 *
 * Es una conversación más del chat del equipo (tipo `pedido`, una por pedido, de
 * los tres roles): mismos mensajes, archivos, referencias @ y vistos que en
 * `/chat`, y también se abre desde ahí.
 *
 * En pantallas anchas va incrustado al pie de la columna derecha del pedido y
 * ocupa la altura que sobra; en las demás, un botón flotante lo abre como panel
 * lateral. El estado de la conversación vive
 * aquí arriba, montado siempre, para que el globo del botón cuente los mensajes
 * sin leer de verdad (los que esta persona no vio) aunque el panel esté cerrado.
 */

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ExternalLink, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatInicial } from "@/lib/chat/consultas";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { VistaConversacion } from "@/components/chat/chat-conversacion";
import { useConversacion } from "@/components/chat/use-conversacion";

/** El mismo corte que `lg:` de Tailwind (64rem). */
const ANCHO_COLUMNA = "(min-width: 64rem)";

function useEsAncho() {
  return useSyncExternalStore(
    (aviso) => {
      const consulta = window.matchMedia(ANCHO_COLUMNA);
      consulta.addEventListener("change", aviso);
      return () => consulta.removeEventListener("change", aviso);
    },
    () => window.matchMedia(ANCHO_COLUMNA).matches,
    () => false,
  );
}

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
  const ancho = useEsAncho();
  const [abierto, setAbierto] = useState(abrirAlEntrar);
  const chat = useConversacion({ conversacionId, usuarioId, inicial, activa: ancho || abierto });
  const sinLeer = chat.sinLeer;

  return (
    <>
      <section
        className={cn("bg-card hidden flex-col overflow-hidden rounded-xl border lg:flex", className)}
        aria-label={`Chat del pedido ${codigo}`}
      >
        <header className="flex items-center gap-2 border-b py-1.5 pr-2 pl-4">
          <MessageCircle className="text-muted-foreground size-4" />
          <h2 className="text-sm font-medium">Chat del pedido</h2>
          <Button
            render={<Link href={`/chat/${conversacionId}`} />}
            nativeButton={false}
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground ml-auto"
            aria-label="Abrir en el chat del equipo"
          >
            <ExternalLink />
          </Button>
        </header>
        {/* Una sola vista a la vez: dos compositores sobre el mismo chat se pisarían el foco. */}
        {ancho && <VistaConversacion chat={chat} vacio={VACIO} autoFoco={abrirAlEntrar} />}
      </section>

      <Button
        type="button"
        onClick={() => setAbierto(true)}
        className="fixed right-4 bottom-20 z-20 h-11 gap-2 rounded-full px-4 shadow-lg md:bottom-6 lg:hidden print:hidden"
        aria-label={`Abrir el chat del pedido${sinLeer ? ` (${sinLeer} sin leer)` : ""}`}
      >
        <MessageCircle className="size-4" />
        Chat
        {sinLeer > 0 && (
          <span className="bg-destructive tnum grid min-w-5 place-items-center rounded-full px-1 text-2xs font-semibold text-white">
            {sinLeer > 99 ? "99+" : sinLeer}
          </span>
        )}
      </Button>

      <Sheet open={abierto && !ancho} onOpenChange={setAbierto}>
        <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md lg:hidden">
          <SheetHeader className="border-b">
            <SheetTitle>Chat del pedido {codigo}</SheetTitle>
            <SheetDescription>Lo ven Administración, Logística y el taller.</SheetDescription>
          </SheetHeader>
          {!ancho && <VistaConversacion chat={chat} vacio={VACIO} autoFoco />}
        </SheetContent>
      </Sheet>
    </>
  );
}
