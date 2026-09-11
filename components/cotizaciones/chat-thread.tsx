"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useChat } from "@/app/(app)/cotizaciones/chat-store";
import { DocumentosCotizacion } from "./documentos-cotizacion";
import { AdjuntosMensaje } from "./adjuntos-mensaje";

export function ChatThread() {
  const {
    mensajes,
    cargandoMensajes,
    enviando,
    activeChatId,
    error,
    reintentar,
    pendingQuotation,
    creandoCotizacion,
    crearCotizacionOdoo,
  } = useChat();
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
              "flex max-w-[85%] flex-col gap-1.5",
              m.role === "user" ? "self-end" : "self-start",
            )}
          >
            {m.adjuntos.length > 0 && <AdjuntosMensaje chatId={activeChatId} adjuntos={m.adjuntos} />}
            {/* Un turno puede ser solo archivos: sin texto no hay burbuja que
                dibujar, o quedaría una vacía debajo de las fichas. */}
            {m.text && (
              <div
                className={cn(
                  "rounded-xl px-3.5 py-2 text-sm whitespace-pre-wrap",
                  m.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted",
                )}
              >
                {m.text}
              </div>
            )}
          </div>
        ))}

        {enviando && (
          <div className="bg-muted text-muted-foreground self-start rounded-xl px-3.5 py-2 text-sm">
            Escribiendo…
          </div>
        )}

        {pendingQuotation && !enviando && (
          <div className="self-start">
            <Button size="sm" onClick={crearCotizacionOdoo} disabled={creandoCotizacion}>
              {creandoCotizacion ? "Creando cotización…" : "Crear cotización en Odoo"}
            </Button>
          </div>
        )}

        {/* Al final del hilo y no junto al mensaje que anunció la cotización:
            los mensajes son una lista plana sin id a la que anclarse, y la
            cotización ya creada se puede descargar en cualquier momento del
            chat, no solo en ese turno. */}
        <DocumentosCotizacion />

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
