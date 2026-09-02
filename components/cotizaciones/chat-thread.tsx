"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { useChat } from "@/app/(app)/cotizaciones/chat-store";

export function ChatThread() {
  const { mensajes, cargandoMensajes, enviando, activeChatId, error, reintentar } = useChat();
  const finRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    finRef.current?.scrollIntoView({ block: "end" });
  }, [mensajes.length, enviando, error]);

  if (cargandoMensajes) {
    return (
      <div className="text-muted-foreground flex flex-1 items-center justify-center text-sm">
        Cargando conversación…
      </div>
    );
  }

  if (!activeChatId && mensajes.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 text-center">
        <p className="font-medium">Nueva cotización</p>
        <p className="text-muted-foreground max-w-sm text-sm">
          Describe lo que necesita el cliente: producto, medidas, cantidad y color.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      <div className="mx-auto flex max-w-2xl flex-col gap-3">
        {mensajes.map((m, i) => (
          <div
            key={i}
            className={cn(
              "max-w-[85%] rounded-xl px-3.5 py-2 text-sm whitespace-pre-wrap",
              m.role === "user"
                ? "bg-primary text-primary-foreground self-end"
                : "bg-muted self-start",
            )}
          >
            {m.text}
          </div>
        ))}

        {enviando && (
          <div className="bg-muted text-muted-foreground self-start rounded-xl px-3.5 py-2 text-sm">
            Escribiendo…
          </div>
        )}

        {error && (
          <div className="border-destructive/30 bg-destructive/10 text-destructive flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2 text-sm">
            <span>{error}</span>
            <button
              type="button"
              onClick={reintentar}
              className="shrink-0 font-medium underline underline-offset-2"
            >
              Reintentar
            </button>
          </div>
        )}

        <div ref={finRef} />
      </div>
    </div>
  );
}
