"use client";

/**
 * El chat del pedido: el equipo habla del pedido sin salir de él.
 *
 * Los mensajes se leen y escriben directo con la sesión del navegador; la RLS de
 * `pedido_mensajes` deja a los tres roles leer y escribir, y el trigger firma cada
 * mensaje con quien tiene la sesión (nadie puede escribir a nombre de otro).
 *
 * Llegan al momento por Supabase Realtime. Si el canal no conecta (la tabla no
 * está publicada, la red corta los websockets), se vuelve a leer cada tanto
 * mientras la pestaña está a la vista: el chat llega tarde, pero llega.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, MessageCircle, SendHorizontal } from "lucide-react";
import { toast } from "sonner";
import { clienteNavegador } from "@/lib/supabase-cliente";
import { ROLES } from "@/lib/dominio";
import { aMensaje, COLUMNAS_MENSAJE, type FilaMensaje, type MensajePedido } from "@/lib/chat-pedido";
import { momentoEnLima } from "@/lib/fecha";
import { fechaCompleta } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const MAX_TEXTO = 2000;
/** Cada cuánto se relee si Realtime no conecta. */
const RELECTURA_MS = 15_000;

const ordenar = (lista: MensajePedido[]) =>
  [...lista].sort((a, b) => a.creadoEn.localeCompare(b.creadoEn));

/** Une sin repetir: el mismo mensaje puede llegar por el insert y por Realtime. */
const unir = (previos: MensajePedido[], nuevos: MensajePedido[]) => {
  const ids = new Set(previos.map((m) => m.id));
  const faltan = nuevos.filter((m) => !ids.has(m.id));
  return faltan.length ? ordenar([...previos, ...faltan]) : previos;
};

function useChatPedido(pedidoId: string, iniciales: MensajePedido[]) {
  const [mensajes, setMensajes] = useState(() => ordenar(iniciales));
  const [enVivo, setEnVivo] = useState(false);

  const releer = useCallback(async () => {
    const { data } = await clienteNavegador()
      .from("pedido_mensajes")
      .select(COLUMNAS_MENSAJE)
      .eq("pedido_id", pedidoId)
      .order("creado_en", { ascending: true });
    if (data) setMensajes((previos) => unir(previos, data.map(aMensaje)));
  }, [pedidoId]);

  useEffect(() => {
    const supabase = clienteNavegador();
    const canal = supabase
      .channel(`pedido-mensajes-${pedidoId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "pedido_mensajes", filter: `pedido_id=eq.${pedidoId}` },
        (cambio) => setMensajes((previos) => unir(previos, [aMensaje(cambio.new as FilaMensaje)])),
      )
      .subscribe((estado) => setEnVivo(estado === "SUBSCRIBED"));

    return () => {
      void supabase.removeChannel(canal);
    };
  }, [pedidoId]);

  // El respaldo: sin canal en vivo, releer mientras la pestaña se ve.
  useEffect(() => {
    if (enVivo) return;
    const intervalo = setInterval(() => {
      if (document.visibilityState === "visible") void releer();
    }, RELECTURA_MS);
    return () => clearInterval(intervalo);
  }, [enVivo, releer]);

  // Al volver a la pestaña puede haber mensajes que el canal no entregó.
  useEffect(() => {
    const alVolver = () => {
      if (document.visibilityState === "visible") void releer();
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => document.removeEventListener("visibilitychange", alVolver);
  }, [releer]);

  const enviar = useCallback(
    async (texto: string) => {
      const { data, error } = await clienteNavegador()
        .from("pedido_mensajes")
        .insert({ pedido_id: pedidoId, texto })
        .select(COLUMNAS_MENSAJE)
        .single();
      if (error || !data) {
        toast.error("No se envió el mensaje", { description: "Revisa tu conexión e inténtalo otra vez." });
        return false;
      }
      setMensajes((previos) => unir(previos, [aMensaje(data)]));
      return true;
    },
    [pedidoId],
  );

  return { mensajes, enviar };
}

/**
 * En pantallas anchas, una columna fija al costado del pedido. En las demás, un
 * botón flotante que abre el chat como panel lateral.
 */
export function ChatPedido({
  pedidoId,
  codigo,
  usuarioId,
  iniciales,
  className,
}: {
  pedidoId: string;
  codigo: string;
  /** Quien tiene la sesión: sus mensajes van a la derecha. */
  usuarioId: string;
  iniciales: MensajePedido[];
  className?: string;
}) {
  const chat = useChatPedido(pedidoId, iniciales);
  const [abierto, setAbierto] = useState(false);
  /* Lo que llegó con el panel cerrado, para el globo del botón. */
  const [vistos, setVistos] = useState(chat.mensajes.length);
  const sinLeer = abierto ? 0 : Math.max(0, chat.mensajes.length - vistos);

  const abrir = (v: boolean) => {
    setAbierto(v);
    setVistos(chat.mensajes.length);
  };

  return (
    <>
      <section
        className={cn("bg-card hidden flex-col overflow-hidden rounded-xl border 2xl:flex", className)}
        aria-label={`Chat del pedido ${codigo}`}
      >
        <header className="flex items-center gap-2 border-b px-4 py-2.5">
          <MessageCircle className="text-muted-foreground size-4" />
          <h2 className="text-sm font-medium">Chat del pedido</h2>
          <span className="text-muted-foreground ml-auto text-xs">{chat.mensajes.length || ""}</span>
        </header>
        <VistaChat mensajes={chat.mensajes} usuarioId={usuarioId} enviar={chat.enviar} />
      </section>

      <Button
        type="button"
        onClick={() => abrir(true)}
        className="fixed right-4 bottom-20 z-20 h-11 gap-2 rounded-full px-4 shadow-lg md:bottom-6 2xl:hidden print:hidden"
        aria-label={`Abrir el chat del pedido${sinLeer ? ` (${sinLeer} sin leer)` : ""}`}
      >
        <MessageCircle className="size-4" />
        Chat
        {sinLeer > 0 && (
          <span className="bg-destructive tnum grid min-w-5 place-items-center rounded-full px-1 text-2xs font-semibold text-white">
            {sinLeer}
          </span>
        )}
      </Button>

      <Sheet open={abierto} onOpenChange={abrir}>
        <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md 2xl:hidden">
          <SheetHeader className="border-b">
            <SheetTitle>Chat del pedido {codigo}</SheetTitle>
            <SheetDescription>Lo ven Administración, Logística y el taller.</SheetDescription>
          </SheetHeader>
          <VistaChat mensajes={chat.mensajes} usuarioId={usuarioId} enviar={chat.enviar} autoFoco />
        </SheetContent>
      </Sheet>
    </>
  );
}

function VistaChat({
  mensajes,
  usuarioId,
  enviar,
  autoFoco,
}: {
  mensajes: MensajePedido[];
  usuarioId: string;
  enviar: (texto: string) => Promise<boolean>;
  autoFoco?: boolean;
}) {
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const lista = useRef<HTMLOListElement>(null);

  // Siempre al último mensaje, como cualquier chat.
  useEffect(() => {
    const el = lista.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [mensajes.length]);

  const mandar = async () => {
    const limpio = texto.trim();
    if (!limpio || enviando) return;
    setEnviando(true);
    const ok = await enviar(limpio);
    setEnviando(false);
    if (ok) setTexto("");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ol ref={lista} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4" aria-live="polite">
        {mensajes.length === 0 && (
          <li className="text-muted-foreground m-auto max-w-56 text-center text-sm">
            Todavía no hay mensajes. Escribe aquí lo que el equipo tenga que saber de este pedido.
          </li>
        )}
        {mensajes.map((m, i) => {
          const mio = m.autorId === usuarioId;
          const momento = momentoEnLima(m.creadoEn);
          const anterior = mensajes[i - 1];
          const nuevoDia = !anterior || momentoEnLima(anterior.creadoEn).slice(0, 10) !== momento.slice(0, 10);
          const mismoAutor = !nuevoDia && anterior?.autorId === m.autorId;
          return (
            <li key={m.id} className="flex flex-col">
              {nuevoDia && (
                <p className="text-muted-foreground mb-2 self-center text-2xs">{fechaCompleta(momento.slice(0, 10))}</p>
              )}
              <div className={cn("flex max-w-[85%] flex-col", mio ? "items-end self-end" : "items-start self-start")}>
                {!mio && !mismoAutor && (
                  <p className="text-muted-foreground mb-0.5 px-1 text-2xs">
                    <span className="text-foreground font-medium">{m.autor}</span>
                    {m.rol && ` · ${ROLES[m.rol].nombre}`}
                  </p>
                )}
                <div
                  className={cn(
                    "rounded-2xl px-3 py-1.5 text-sm break-words whitespace-pre-wrap",
                    mio ? "bg-primary text-primary-foreground rounded-br-md" : "bg-muted rounded-bl-md",
                  )}
                >
                  {m.texto}
                </div>
                <p className="text-muted-foreground tnum mt-0.5 px-1 text-2xs">{momento.slice(11, 16)}</p>
              </div>
            </li>
          );
        })}
      </ol>

      <form
        className="flex items-end gap-2 border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void mandar();
        }}
      >
        <Textarea
          rows={1}
          value={texto}
          autoFocus={autoFoco}
          maxLength={MAX_TEXTO}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            // Enter envía; Shift + Enter baja de línea.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void mandar();
            }
          }}
          placeholder="Escribe un mensaje…"
          aria-label="Mensaje"
          className="max-h-32 min-h-9 resize-none"
        />
        <Button type="submit" size="icon" className="size-9 shrink-0" disabled={!texto.trim() || enviando} aria-label="Enviar">
          {enviando ? <Loader2 className="animate-spin" /> : <SendHorizontal />}
        </Button>
      </form>
    </div>
  );
}
