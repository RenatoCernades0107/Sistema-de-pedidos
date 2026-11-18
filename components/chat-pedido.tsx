"use client";

/**
 * El chat del pedido: el equipo habla del pedido sin salir de él.
 *
 * Es una conversación más del chat del equipo (tipo `pedido`, una por pedido, de
 * los tres roles): mismos mensajes, archivos, referencias @ y vistos que en
 * `/chat`, y también se abre desde ahí.
 *
 * En pantalla ancha comparte la columna derecha con los ítems: dos pestañas,
 * «Ítems» y «Chat». En las angostas, los ítems quedan como están y un botón
 * flotante abre el chat como panel lateral. El estado de la conversación vive
 * aquí arriba, montado siempre y en vivo, para que la bolita roja cuente los
 * mensajes sin leer de verdad (los que esta persona no vio) aunque el chat no
 * esté a la vista. Solo con el chat a la vista lo que llega se marca como visto.
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

/** El mismo corte que `lg:` de Tailwind (64rem): desde ahí el chat va en pestaña. */
const ANCHO_PESTANA = "(min-width: 64rem)";

function useEsAncho() {
  return useSyncExternalStore(
    (aviso) => {
      const consulta = window.matchMedia(ANCHO_PESTANA);
      consulta.addEventListener("change", aviso);
      return () => consulta.removeEventListener("change", aviso);
    },
    () => window.matchMedia(ANCHO_PESTANA).matches,
    () => false,
  );
}

/** El número de no leídos en rojo, con un pulso suave (sin él si se pidió menos movimiento). */
function Bolita({ n, className }: { n: number; className?: string }) {
  if (n <= 0) return null;
  return (
    <span className={cn("grid", className)} aria-hidden>
      <span className="bg-destructive col-start-1 row-start-1 size-full animate-ping rounded-full opacity-60 motion-reduce:hidden" />
      <span className="bg-destructive ring-background tnum col-start-1 row-start-1 grid h-5 min-w-5 place-items-center rounded-full px-1 text-2xs font-semibold text-white ring-2">
        {n > 99 ? "99+" : n}
      </span>
    </span>
  );
}

const VACIO = "Todavía no hay mensajes. Escribe aquí lo que el equipo tenga que saber de este pedido.";

export function ChatPedido({
  conversacionId,
  codigo,
  usuarioId,
  inicial,
  enChat,
  alCambiar,
  etiquetaItems,
  className,
  children,
}: {
  conversacionId: string;
  codigo: string;
  /** Quien tiene la sesión: sus mensajes van a la derecha. */
  usuarioId: string;
  inicial: ChatInicial | null;
  /** La pestaña Chat está elegida (`?chat=1`, también lo que traen los avisos de menciones). */
  enChat: boolean;
  alCambiar: (enChat: boolean) => void;
  /** Cómo se llama la otra pestaña: «Ítems (3)». */
  etiquetaItems: string;
  className?: string;
  /** Lo que va en la pestaña Ítems (y, en pantalla angosta, siempre). */
  children: React.ReactNode;
}) {
  const ancho = useEsAncho();
  // En pantalla angosta, el panel lateral. Llegar con `?chat=1` lo abre.
  const [abierto, setAbierto] = useState(enChat);
  const visible = ancho ? enChat : abierto;
  const chat = useConversacion({ conversacionId, usuarioId, inicial, activa: visible });
  const sinLeer = chat.sinLeer;
  const etiquetaChat = `Chat${sinLeer ? ` (${sinLeer} sin leer)` : ""}`;

  const pestana = (activa: boolean, alElegir: () => void, etiqueta: string, contenido: React.ReactNode) => (
    <button
      type="button"
      role="tab"
      aria-selected={activa}
      aria-label={etiqueta}
      onClick={alElegir}
      className={cn(
        "relative flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors",
        "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
        activa ? "bg-card text-foreground font-medium shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {contenido}
    </button>
  );

  return (
    <>
      {/* Pantalla ancha: una tarjeta con las dos pestañas. */}
      <section
        className={cn("bg-card hidden min-h-0 flex-col overflow-hidden rounded-xl border lg:flex", className)}
        aria-label="Ítems y chat del pedido"
      >
        <div role="tablist" aria-label="Qué ver" className="bg-muted/60 m-1.5 flex gap-1 rounded-lg p-1">
          {pestana(!enChat, () => alCambiar(false), etiquetaItems, etiquetaItems)}
          {pestana(
            enChat,
            () => alCambiar(true),
            etiquetaChat,
            <>
              <MessageCircle className="size-3.5" aria-hidden />
              Chat
              <Bolita n={sinLeer} className="absolute -top-1.5 -right-1" />
            </>,
          )}
        </div>
        {ancho && enChat ? (
          <div className="flex min-h-0 flex-1 flex-col border-t">
            <div className="text-muted-foreground flex items-center gap-2 px-3 py-1.5 text-xs">
              <span className="min-w-0 flex-1 truncate">Lo ven Administración, Logística y el taller.</span>
              <Button
                render={<Link href={`/chat/${conversacionId}`} />}
                nativeButton={false}
                variant="ghost"
                size="icon-xs"
                aria-label="Abrir en el chat del equipo"
                title="Abrir en el chat del equipo"
              >
                <ExternalLink />
              </Button>
            </div>
            <VistaConversacion chat={chat} vacio={VACIO} autoFoco />
          </div>
        ) : (
          ancho && <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5">{children}</div>
        )}
      </section>

      {/* Pantalla angosta: los ítems como siempre y el chat en un botón flotante. */}
      {!ancho && (
        <>
          <div className={cn("lg:hidden", className)}>{children}</div>
          <Button
            type="button"
            onClick={() => setAbierto(true)}
            className={cn(
              "fixed right-4 bottom-20 z-20 h-11 gap-2 rounded-full px-4 shadow-lg md:bottom-6 print:hidden",
              abierto && "hidden",
            )}
            aria-label={`Abrir el chat del pedido${sinLeer ? ` (${sinLeer} sin leer)` : ""}`}
          >
            <MessageCircle className="size-4" />
            Chat
            <Bolita n={sinLeer} className="absolute -top-1.5 -right-1.5" />
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
      )}
    </>
  );
}
