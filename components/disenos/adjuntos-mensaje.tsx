"use client";

/**
 * Los archivos que la persona adjuntó a un mensaje del chat de diseños, encima
 * de su burbuja: las imágenes en miniatura y los PDF como fichas. Al tocarlos
 * se abren en otra pestaña. El bucket es privado: van con URL firmada.
 */

import { FileText, ImageOff } from "lucide-react";
import { useUrlFirmada } from "@/components/chat/urls-firmadas";
import { BUCKET_CAD_ADJUNTOS, esImagenAdjunto, pesoTexto, type AdjuntoCad } from "@/lib/cad/adjuntos";

function Adjunto({ adjunto }: { adjunto: AdjuntoCad }) {
  const url = useUrlFirmada(adjunto.ruta, BUCKET_CAD_ADJUNTOS);
  const imagen = esImagenAdjunto(adjunto.mime);
  const enlace = url ? { href: url, target: "_blank", rel: "noopener noreferrer" } : {};

  if (imagen) {
    return (
      <a
        {...enlace}
        title={adjunto.nombre}
        aria-label={`Abrir ${adjunto.nombre}`}
        className="bg-muted grid size-24 place-items-center overflow-hidden rounded-lg border"
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage, de vida corta
          <img src={url} alt={adjunto.nombre} className="size-full object-cover" />
        ) : url === null ? (
          <ImageOff className="text-muted-foreground size-5" aria-hidden />
        ) : (
          <span className="bg-muted size-full animate-pulse" />
        )}
      </a>
    );
  }

  return (
    <a
      {...enlace}
      title={adjunto.nombre}
      className="bg-card hover:bg-muted/60 flex max-w-60 items-center gap-2 rounded-lg border py-1.5 pr-3 pl-2 text-xs transition-colors"
    >
      <span className="grid size-7 shrink-0 place-items-center rounded bg-red-500/10 text-red-600 dark:text-red-400">
        <FileText className="size-4" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block truncate font-medium">{adjunto.nombre}</span>
        <span className="text-muted-foreground block text-2xs">
          PDF · {pesoTexto(adjunto.tamano)}
          {url === null ? " · no disponible" : ""}
        </span>
      </span>
    </a>
  );
}

export function AdjuntosMensaje({ adjuntos }: { adjuntos: AdjuntoCad[] }) {
  if (adjuntos.length === 0) return null;
  return (
    <ul className="flex flex-wrap justify-end gap-1.5" aria-label="Archivos adjuntos">
      {adjuntos.map((a) => (
        <li key={a.ruta}>
          <Adjunto adjunto={a} />
        </li>
      ))}
    </ul>
  );
}
