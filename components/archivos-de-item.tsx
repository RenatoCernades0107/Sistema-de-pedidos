"use client";

import { useRef } from "react";
import { FileText, Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import { ACEPTA, validarArchivo } from "@/lib/adjuntos";
import { Button } from "@/components/ui/button";

/**
 * Los archivos de diseño de un ítem del pedido (planos, PDF, imágenes), elegidos
 * en el alta. Se quedan en memoria hasta que el pedido exista: la carpeta del
 * bucket cuelga de su uuid, y el uuid lo pone Postgres al registrarlo.
 */
export function ArchivosDeItem({
  nombre,
  archivos,
  alCambiar,
}: {
  nombre: string;
  archivos: File[];
  alCambiar: (archivos: File[]) => void;
}) {
  const entrada = useRef<HTMLInputElement>(null);

  const anadir = (elegidos: File[]) => {
    const buenos: File[] = [];
    for (const archivo of elegidos) {
      const problema = validarArchivo(archivo);
      if (problema) toast.error("Ese archivo no vale", { description: problema });
      else buenos.push(archivo);
    }
    // Por nombre y tamaño: elegir dos veces el mismo archivo es lo normal.
    alCambiar([
      ...archivos,
      ...buenos.filter((b) => !archivos.some((a) => a.name === b.name && a.size === b.size)),
    ]);
  };

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="text-muted-foreground mt-1 gap-1"
        onClick={() => entrada.current?.click()}
        title="Planos, PDF o imágenes. Hasta 10 MB cada uno."
      >
        <Paperclip />
        {archivos.length > 0 ? "Adjuntar más archivos" : "Adjuntar archivos"}
      </Button>
      <input
        ref={entrada}
        type="file"
        multiple
        accept={ACEPTA}
        className="sr-only"
        aria-label={`Adjuntar archivos a ${nombre}`}
        tabIndex={-1}
        onChange={(e) => {
          anadir(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      {archivos.length > 0 && (
        <ul className="mt-1.5 flex basis-full flex-wrap gap-1.5" aria-label={`Archivos de ${nombre}`}>
          {archivos.map((archivo) => (
            <li
              key={`${archivo.name}-${archivo.size}`}
              className="bg-muted/60 flex max-w-full items-center gap-1.5 rounded-md border py-0.5 pr-0.5 pl-2"
            >
              <FileText className="text-primary size-3.5 shrink-0" />
              <span className="min-w-0 truncate text-xs">{archivo.name}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-5 shrink-0"
                aria-label={`Quitar ${archivo.name}`}
                onClick={() => alCambiar(archivos.filter((a) => a !== archivo))}
              >
                <X className="size-3" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
