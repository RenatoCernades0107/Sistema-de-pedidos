"use client";

import { useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type Ref } from "react";
import { ArrowUp, FileText, Loader2, Paperclip, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ReferenciaCara } from "@/lib/cad/caras";
import { TIPOS_ADJUNTO, pesoTexto } from "@/lib/cad/adjuntos";
import { cn } from "@/lib/utils";
import { partirMenciones } from "./chip-cara";
import type { AdjuntoLocal } from "./adjuntos-navegador";

/**
 * Donde se escribe. Enter envía y Shift+Enter baja de línea, como en el
 * asistente de cotizaciones. Mientras el asistente contesta, el botón de enviar
 * es el de detener.
 *
 * Las caras señaladas en el visor se escriben en el texto como `@cara1`; una
 * capa detrás del cuadro las resalta.
 *
 * Con el clip (o pegando, o soltando archivos encima) se adjuntan imágenes y
 * PDF para que el asistente los lea. Se puede enviar solo un archivo.
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
  adjuntos = [],
  onAgregarArchivos,
  onQuitarAdjunto,
  subiendo = false,
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
  /** Los archivos elegidos que irán con el mensaje. */
  adjuntos?: AdjuntoLocal[];
  onAgregarArchivos?: (archivos: File[]) => void;
  onQuitarAdjunto?: (id: string) => void;
  /** Los adjuntos se están subiendo: todavía no se puede detener ni enviar. */
  subiendo?: boolean;
}) {
  const capa = useRef<HTMLDivElement>(null);
  const entrada = useRef<HTMLInputElement>(null);
  const [encima, setEncima] = useState(false);
  const admiteArchivos = !!onAgregarArchivos && !deshabilitado;
  const puedeEnviar = !deshabilitado && (!!texto.trim() || adjuntos.length > 0);
  const aliases = new Set(caras.flatMap((c) => (c.alias ? [c.alias] : [])));

  const alTeclear = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // `isComposing`: el Enter que confirma una tilde o un carácter compuesto no envía.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!enviando) onEnviar();
    }
  };

  // Pegar una captura (Ctrl+V) la adjunta; el texto pegado sigue como siempre.
  const alPegar = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!admiteArchivos) return;
    const archivos = Array.from(e.clipboardData.files);
    if (archivos.length === 0) return;
    e.preventDefault();
    onAgregarArchivos?.(archivos);
  };

  const conArchivos = (e: DragEvent) => admiteArchivos && e.dataTransfer.types.includes("Files");
  const alSoltar = (e: DragEvent<HTMLDivElement>) => {
    setEncima(false);
    if (!conArchivos(e)) return;
    e.preventDefault();
    onAgregarArchivos?.(Array.from(e.dataTransfer.files));
  };

  return (
    <div
      className={cn("p-3 transition-colors", encima && "bg-primary/5")}
      onDragOver={(e) => {
        if (!conArchivos(e)) return;
        e.preventDefault();
        setEncima(true);
      }}
      onDragLeave={() => setEncima(false)}
      onDrop={alSoltar}
    >
      {adjuntos.length > 0 && (
        <ul className="mx-auto mb-2 flex max-w-2xl flex-wrap gap-2" aria-label="Archivos adjuntos">
          {adjuntos.map((a) => (
            <li key={a.id}>
              <div className="bg-muted/40 flex items-center gap-2 rounded-lg border py-1.5 pr-1.5 pl-2 text-xs">
                <span className="bg-card grid size-6 shrink-0 place-items-center overflow-hidden rounded border">
                  {a.vistaPrevia ? (
                    // eslint-disable-next-line @next/next/no-img-element -- vista previa local de un blob, no un recurso a optimizar
                    <img src={a.vistaPrevia} alt="" className="size-full object-cover" />
                  ) : (
                    <FileText className="text-muted-foreground size-3.5" />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block max-w-[16ch] truncate font-medium">{a.archivo.name}</span>
                  <span className="text-muted-foreground block text-2xs">{pesoTexto(a.archivo.size)}</span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground hover:text-destructive shrink-0"
                  aria-label={`Quitar ${a.archivo.name}`}
                  disabled={enviando}
                  onClick={() => onQuitarAdjunto?.(a.id)}
                >
                  <X />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="mx-auto flex max-w-2xl items-end gap-2">
        {onAgregarArchivos && (
          <>
            <input
              ref={entrada}
              type="file"
              multiple
              accept={TIPOS_ADJUNTO.join(",")}
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => {
                const archivos = Array.from(e.target.files ?? []);
                // Sin esto, elegir el mismo archivo dos veces seguidas no dispara `change`.
                e.target.value = "";
                if (archivos.length) onAgregarArchivos(archivos);
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={!admiteArchivos || enviando}
              onClick={() => entrada.current?.click()}
              aria-label="Adjuntar imágenes o PDF"
              title="Adjuntar imágenes o PDF"
            >
              <Paperclip />
            </Button>
          </>
        )}
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
            onPaste={alPegar}
            onScroll={(e) => {
              if (capa.current) capa.current.scrollTop = e.currentTarget.scrollTop;
            }}
            placeholder={
              caras.length
                ? "¿Qué quieres hacer con las caras señaladas?"
                : adjuntos.length
                  ? "¿Qué quieres hacer con estos archivos?"
                  : "Describe el producto o el cambio que quieres…"
            }
            aria-label="Mensaje para el asistente de diseños"
            disabled={deshabilitado}
            rows={1}
            className="relative max-h-40 min-h-9 bg-transparent"
          />
        </div>
        {subiendo ? (
          <Button size="icon" variant="outline" disabled aria-label="Subiendo archivos…">
            <Loader2 className="animate-spin" />
          </Button>
        ) : enviando ? (
          <Button size="icon" variant="outline" onClick={onDetener} aria-label="Detener la respuesta">
            <Square className="fill-current" />
          </Button>
        ) : (
          <Button
            size="icon"
            onClick={onEnviar}
            disabled={!puedeEnviar}
            aria-label="Enviar mensaje"
          >
            <ArrowUp />
          </Button>
        )}
      </div>
    </div>
  );
}
