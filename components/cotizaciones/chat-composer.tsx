"use client";

import { useState, type KeyboardEvent } from "react";
import { ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useChat } from "@/app/(app)/cotizaciones/chat-store";

export function ChatComposer() {
  const { enviando, enviar } = useChat();
  const [texto, setTexto] = useState("");

  const enviarTexto = () => {
    const limpio = texto.trim();
    if (!limpio || enviando) return;
    setTexto("");
    enviar(limpio);
  };

  const alTeclear = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      enviarTexto();
    }
  };

  return (
    <div className="border-t p-3">
      <div className="mx-auto flex max-w-2xl items-end gap-2">
        <Textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={alTeclear}
          placeholder="Cotízame 5 piezas de acrílico transparente 3mm 30x50cm…"
          disabled={enviando}
          rows={1}
          className="max-h-40"
        />
        <Button size="icon" onClick={enviarTexto} disabled={enviando || !texto.trim()} aria-label="Enviar mensaje">
          <ArrowUp />
        </Button>
      </div>
    </div>
  );
}
