"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUp, FileText, Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useChat } from "@/app/(app)/cotizaciones/chat-store";

/** Adjuntos elegidos en el navegador, todavía sin mandar. */
interface AdjuntoLocal {
  id: string;
  archivo: File;
  previewUrl: string | null;
}

/** Los mismos topes que impone la Quote Agent API (ver `docs/API_agent.md`).
 * Comprobarlos aquí no sustituye a los suyos — el servidor no se fía del
 * navegador —, es para no gastar una subida entera en un archivo que va a
 * rebotar. */
const MAX_ADJUNTOS = 10;
const MAX_BYTES = 4 * 1024 * 1024;

/** Lo que Gemini sabe leer; el resto se rechaza en vez de mandarse y ser
 * ignorado en silencio. */
const TIPOS_ACEPTADOS = ["application/pdf", "image/png", "image/jpeg", "image/webp"];

const esTipoAceptado = (archivo: File) => TIPOS_ACEPTADOS.includes(archivo.type);

/** El archivo en base64, sin el prefijo `data:` que le pone el FileReader. */
async function aBase64(archivo: File): Promise<string> {
  const bytes = new Uint8Array(await archivo.arrayBuffer());
  let binario = "";
  // De a trozos: pasarle el array entero a String.fromCharCode revienta la
  // pila de argumentos con archivos de unos pocos MB.
  const TROZO = 8192;
  for (let i = 0; i < bytes.length; i += TROZO) {
    binario += String.fromCharCode(...bytes.subarray(i, i + TROZO));
  }
  return btoa(binario);
}

/** 860160 → "840 KB". */
function pesoTexto(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  return kb < 1024 ? `${Math.round(kb)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

export function ChatComposer() {
  const { enviando, enviar } = useChat();
  const [texto, setTexto] = useState("");
  const [adjuntos, setAdjuntos] = useState<AdjuntoLocal[]>([]);
  const [leyendo, setLeyendo] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);

  // Ref con el valor vigente para poder leerlo al desmontar sin que el efecto
  // de cleanup tenga que depender de `adjuntos` (si dependiera, su cleanup
  // correría en cada cambio y revocaría las miniaturas que siguen en pantalla).
  const adjuntosRef = useRef<AdjuntoLocal[]>([]);
  useEffect(() => {
    adjuntosRef.current = adjuntos;
  }, [adjuntos]);

  // Los object URL de las miniaturas viven en el navegador hasta que se
  // revocan a mano; sin este cleanup al desmontar el composer, se quedan
  // colgados aunque el chip haya desaparecido de la pantalla.
  useEffect(() => {
    return () => {
      for (const a of adjuntosRef.current) if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
    };
  }, []);

  const limpiarAdjuntos = () => {
    setAdjuntos((prev) => {
      for (const a of prev) if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
      return [];
    });
  };

  const elegirArchivos = (e: React.ChangeEvent<HTMLInputElement>) => {
    const elegidos = Array.from(e.target.files ?? []);
    // Sin esto, elegir el mismo archivo dos veces seguidas no dispara `change`.
    e.target.value = "";
    if (elegidos.length === 0) return;

    const aceptados: File[] = [];
    let rechazadosPorTipo = 0;
    for (const archivo of elegidos) {
      if (esTipoAceptado(archivo)) aceptados.push(archivo);
      else rechazadosPorTipo++;
    }
    if (rechazadosPorTipo > 0) {
      toast.error(
        rechazadosPorTipo === 1
          ? "Un archivo no se agregó: solo PDF, PNG, JPEG o WebP"
          : `${rechazadosPorTipo} archivos no se agregaron: solo PDF, PNG, JPEG o WebP`,
      );
    }
    if (aceptados.length === 0) return;

    setAdjuntos((prev) => {
      const yaPesan = prev.reduce((suma, a) => suma + a.archivo.size, 0);
      const nuevoPeso = aceptados.reduce((suma, a) => suma + a.size, yaPesan);
      if (nuevoPeso > MAX_BYTES) {
        toast.error("Los archivos pesan demasiado", {
          description: `El máximo por mensaje es ${MAX_BYTES / 1024 / 1024} MB en total.`,
        });
        return prev;
      }

      const espacio = MAX_ADJUNTOS - prev.length;
      if (espacio <= 0) {
        toast.error(`Ya hay ${MAX_ADJUNTOS} archivos adjuntos, el máximo`);
        return prev;
      }
      const admitidos = aceptados.slice(0, espacio);
      if (admitidos.length < aceptados.length) {
        toast.error(`Solo se agregaron ${admitidos.length} archivos: se llegó al máximo de ${MAX_ADJUNTOS}`);
      }
      const nuevos: AdjuntoLocal[] = admitidos.map((archivo) => ({
        id: crypto.randomUUID(),
        archivo,
        previewUrl: archivo.type.startsWith("image/") ? URL.createObjectURL(archivo) : null,
      }));
      return [...prev, ...nuevos];
    });
  };

  const quitarAdjunto = (id: string) => {
    setAdjuntos((prev) => {
      const salida = prev.find((a) => a.id === id);
      if (salida?.previewUrl) URL.revokeObjectURL(salida.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  };

  const enviarTexto = () => {
    const limpio = texto.trim();
    // Un archivo sin texto es un turno válido ("aquí está el plano"); lo único
    // que no se puede mandar es un mensaje sin nada.
    if ((!limpio && adjuntos.length === 0) || enviando || leyendo) return;

    if (adjuntos.length === 0) {
      setTexto("");
      enviar(limpio);
      return;
    }

    // Leer los archivos es asíncrono, así que el composer no se vacía hasta
    // tenerlos: si la lectura falla, lo escrito y lo elegido siguen ahí.
    setLeyendo(true);
    void (async () => {
      try {
        const listos = await Promise.all(
          adjuntos.map(async (a) => ({
            filename: a.archivo.name,
            contentType: a.archivo.type,
            contentBase64: await aBase64(a.archivo),
          })),
        );
        setTexto("");
        limpiarAdjuntos();
        enviar(limpio, listos);
      } catch {
        toast.error("No se pudieron leer los archivos", {
          description: "Vuelve a elegirlos e inténtalo de nuevo.",
        });
      } finally {
        setLeyendo(false);
      }
    })();
  };

  const alTeclear = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      enviarTexto();
    }
  };

  return (
    <div className="border-t p-3">
      <div className="mx-auto flex max-w-2xl flex-col gap-2">
        {adjuntos.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {adjuntos.map((a) => (
              <li key={a.id}>
                <div className="bg-muted/40 flex items-center gap-2 rounded-lg border py-1.5 pr-1.5 pl-2 text-xs">
                  <span className="bg-card grid size-6 shrink-0 place-items-center overflow-hidden rounded border">
                    {a.previewUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- vista previa local de un blob, no un recurso a optimizar
                      <img src={a.previewUrl} alt="" className="size-full object-cover" />
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
                    onClick={() => quitarAdjunto(a.id)}
                  >
                    <X />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-end gap-2">
          <input
            ref={entrada}
            type="file"
            multiple
            accept="application/pdf,image/png,image/jpeg,image/webp"
            className="sr-only"
            aria-label="Adjuntar archivos"
            onChange={elegirArchivos}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={enviando || leyendo}
            onClick={() => entrada.current?.click()}
            aria-label="Adjuntar archivos"
          >
            <Paperclip />
          </Button>
          <Textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={alTeclear}
            placeholder="Cotízame 5 piezas de acrílico transparente 3mm 30x50cm…"
            disabled={enviando || leyendo}
            rows={1}
            className="max-h-40"
          />
          <Button
            size="icon"
            onClick={enviarTexto}
            disabled={enviando || leyendo || (!texto.trim() && adjuntos.length === 0)}
            aria-label="Enviar mensaje"
          >
            <ArrowUp />
          </Button>
        </div>
      </div>
    </div>
  );
}
