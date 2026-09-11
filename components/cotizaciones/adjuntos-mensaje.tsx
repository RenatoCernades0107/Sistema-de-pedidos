"use client";

/**
 * Los archivos que acompañaron a un mensaje, dentro de su burbuja.
 *
 * Se sirven por la misma ruta que los PDFs de la cotización
 * (`app/api/cotizaciones/...`), con el prefijo `adjunto:` y el id del archivo,
 * así que valen las mismas dos acciones: verlo abre el visor del navegador y
 * descargarlo lo baja.
 *
 * Mientras el mensaje viaja, la ficha todavía no tiene id — el agente aún no lo
 * ha guardado — y se muestra apagada y sin enlaces. En cuanto responde, el id
 * real la reemplaza.
 */

import { FileText, ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Adjunto } from "@/app/(app)/cotizaciones/acciones";

/** 860160 → "840 KB". */
function pesoTexto(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  return kb < 1024 ? `${Math.round(kb)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

export function AdjuntosMensaje({ chatId, adjuntos }: { chatId: string | null; adjuntos: Adjunto[] }) {
  if (adjuntos.length === 0) return null;

  return (
    <ul className="flex flex-wrap justify-end gap-1.5">
      {adjuntos.map((a, i) => (
        <li key={a.attachmentId || `pendiente-${i}`}>
          <Ficha chatId={chatId} adjunto={a} />
        </li>
      ))}
    </ul>
  );
}

function Ficha({ chatId, adjunto }: { chatId: string | null; adjunto: Adjunto }) {
  const Icono = adjunto.contentType.startsWith("image/") ? ImageIcon : FileText;
  // Sin id todavía (mensaje en vuelo) no hay nada que pedirle al servidor.
  const url =
    chatId && adjunto.attachmentId
      ? `/api/cotizaciones/${encodeURIComponent(chatId)}/${encodeURIComponent(`adjunto:${adjunto.attachmentId}`)}`
      : null;

  const contenido = (
    <>
      <span className="bg-background/70 grid size-6 shrink-0 place-items-center rounded border">
        <Icono className="text-muted-foreground size-3.5" />
      </span>
      <span className="min-w-0 text-left">
        <span className="block max-w-[18ch] truncate text-xs font-medium">{adjunto.filename}</span>
        {adjunto.size > 0 && (
          <span className="text-muted-foreground block text-2xs">{pesoTexto(adjunto.size)}</span>
        )}
      </span>
    </>
  );

  const clases = cn(
    "bg-background/60 flex items-center gap-2 rounded-lg border px-2 py-1.5 transition-colors",
    url ? "hover:border-ring/40 focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none" : "opacity-70",
  );

  if (!url) return <div className={clases}>{contenido}</div>;

  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={clases} title={`Ver ${adjunto.filename}`}>
      {contenido}
    </a>
  );
}
