"use client";

/**
 * El campo de texto del chat con referencias @.
 *
 * PROVISORIO: es el contrato que usa el compositor. La versión con el menú de @,
 * el encadenado y el resaltado de las fichas la reemplaza sin cambiar las props.
 */

import type { Ref } from "react";
import type { Referencia } from "@/lib/chat/tipos";
import { MAX_TEXTO, referenciasUsadas } from "@/lib/chat/tipos";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";

export interface PropsCampoConReferencias {
  /** El texto con las fichas `@rN`. */
  valor: string;
  /** Las referencias de las fichas del texto. */
  referencias: Referencia[];
  /** Cada cambio del texto o de las referencias (ya filtradas a las que siguen en el texto). */
  onCambio: (texto: string, referencias: Referencia[]) => void;
  /** Enter sin Shift. */
  onEnviar: () => void;
  /** Para pegar archivos (Ctrl+V de una captura) en el compositor. */
  onPegarArchivos?: (archivos: File[]) => void;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
  ref?: Ref<HTMLTextAreaElement>;
}

export function CampoConReferencias({
  valor,
  referencias,
  onCambio,
  onEnviar,
  onPegarArchivos,
  placeholder = "Escribe un mensaje… (@ para referenciar)",
  disabled,
  autoFocus,
  className,
  ref,
}: PropsCampoConReferencias) {
  return (
    <Textarea
      ref={ref}
      rows={1}
      value={valor}
      autoFocus={autoFocus}
      disabled={disabled}
      maxLength={MAX_TEXTO}
      onChange={(e) => onCambio(e.target.value, referenciasUsadas(e.target.value, referencias))}
      onPaste={(e) => {
        const archivos = [...e.clipboardData.files];
        if (archivos.length && onPegarArchivos) {
          e.preventDefault();
          onPegarArchivos(archivos);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          onEnviar();
        }
      }}
      placeholder={placeholder}
      aria-label="Mensaje"
      className={cn("max-h-40 min-h-9 resize-none", className)}
    />
  );
}
