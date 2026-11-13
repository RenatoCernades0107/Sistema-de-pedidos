"use client";

import type { KeyboardEvent } from "react";
import { ArrowUp, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ReferenciaCara } from "@/lib/cad/caras";
import { ChipCara } from "./chip-cara";

/**
 * Donde se escribe. Enter envía y Shift+Enter baja de línea, como en el
 * asistente de cotizaciones. Mientras el asistente contesta, el botón de enviar
 * es el de detener.
 */
export function ChatCompositor({
  texto,
  onTexto,
  onEnviar,
  onDetener,
  enviando,
  deshabilitado = false,
  caras = [],
  onQuitarCara,
}: {
  texto: string;
  onTexto: (texto: string) => void;
  onEnviar: () => void;
  onDetener: () => void;
  enviando: boolean;
  /** El asistente no está disponible: no hay a quién escribirle. */
  deshabilitado?: boolean;
  /** Las caras señaladas en el visor que irán con el mensaje. */
  caras?: ReferenciaCara[];
  onQuitarCara?: (clave: string) => void;
}) {
  const alTeclear = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // `isComposing`: el Enter que confirma una tilde o un carácter compuesto no envía.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!enviando) onEnviar();
    }
  };

  return (
    <div className="border-t p-3">
      {caras.length > 0 && (
        <ul className="mx-auto mb-2 flex max-w-2xl flex-wrap gap-1.5" aria-label="Caras que irán con el mensaje">
          {caras.map((c) => (
            <li key={c.clave} className="max-w-full">
              <ChipCara
                cara={c}
                alQuitar={onQuitarCara ? () => onQuitarCara(c.clave) : undefined}
                className="border-amber-500/40 bg-amber-500/10"
              />
            </li>
          ))}
        </ul>
      )}
      <div className="mx-auto flex max-w-2xl items-end gap-2">
        <Textarea
          value={texto}
          onChange={(e) => onTexto(e.target.value)}
          onKeyDown={alTeclear}
          placeholder={
            caras.length ? "¿Qué quieres hacer con las caras señaladas?" : "Describe el producto o el cambio que quieres…"
          }
          aria-label="Mensaje para el asistente de diseños"
          disabled={deshabilitado}
          rows={1}
          className="max-h-40 min-h-9"
        />
        {enviando ? (
          <Button size="icon" variant="outline" onClick={onDetener} aria-label="Detener la respuesta">
            <Square className="fill-current" />
          </Button>
        ) : (
          <Button
            size="icon"
            onClick={onEnviar}
            disabled={deshabilitado || !texto.trim()}
            aria-label="Enviar mensaje"
          >
            <ArrowUp />
          </Button>
        )}
      </div>
    </div>
  );
}
