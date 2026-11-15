"use client";

import { useRef, type KeyboardEvent, type Ref } from "react";
import { ArrowUp, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ReferenciaCara } from "@/lib/cad/caras";
import { partirMenciones } from "./chip-cara";

/**
 * Donde se escribe. Enter envía y Shift+Enter baja de línea, como en el
 * asistente de cotizaciones. Mientras el asistente contesta, el botón de enviar
 * es el de detener.
 *
 * Las caras señaladas en el visor se escriben en el texto como `@cara1`; una
 * capa detrás del cuadro las resalta.
 */
export function ChatCompositor({
  texto,
  onTexto,
  onEnviar,
  onDetener,
  enviando,
  deshabilitado = false,
  caras = [],
  textareaRef,
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
  textareaRef?: Ref<HTMLTextAreaElement>;
}) {
  const capa = useRef<HTMLDivElement>(null);
  const aliases = new Set(caras.flatMap((c) => (c.alias ? [c.alias] : [])));

  const alTeclear = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // `isComposing`: el Enter que confirma una tilde o un carácter compuesto no envía.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!enviando) onEnviar();
    }
  };

  return (
    <div className="p-3">
      <div className="mx-auto flex max-w-2xl items-end gap-2">
        <div className="relative min-w-0 flex-1">
          {aliases.size > 0 && (
            <div
              ref={capa}
              aria-hidden
              className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg border border-transparent px-2.5 py-2 text-base break-words whitespace-pre-wrap text-transparent md:text-sm"
            >
              {partirMenciones(texto).map((trozo, i) =>
                typeof trozo === "string" || !aliases.has(trozo.alias) ? (
                  <span key={i}>{typeof trozo === "string" ? trozo : trozo.texto}</span>
                ) : (
                  <mark key={i} className="rounded-sm bg-amber-400/35 text-transparent">
                    {trozo.texto}
                  </mark>
                ),
              )}
              {/* Un salto final como el del textarea, para que las alturas coincidan. */}
              {"\u200b"}
            </div>
          )}
          <Textarea
            ref={textareaRef}
            value={texto}
            onChange={(e) => onTexto(e.target.value)}
            onKeyDown={alTeclear}
            onScroll={(e) => {
              if (capa.current) capa.current.scrollTop = e.currentTarget.scrollTop;
            }}
            placeholder={
              caras.length ? "¿Qué quieres hacer con las caras señaladas?" : "Describe el producto o el cambio que quieres…"
            }
            aria-label="Mensaje para el asistente de diseños"
            disabled={deshabilitado}
            rows={1}
            className="relative max-h-40 min-h-9 bg-transparent"
          />
        </div>
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
