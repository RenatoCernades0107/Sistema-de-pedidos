"use client";

/**
 * Donde se escribe: el texto con referencias @, adjuntar fotos, videos y PDF (o
 * sacar una foto con la cámara en el celular, o pegar una captura), la vista
 * previa de lo elegido y enviar.
 *
 * Al enviar, el borrador se entrega a la conversación y el cuadro queda libre
 * enseguida: el mensaje sale en la lista con su avance. Si no llega a enviarse y
 * el cuadro sigue vacío, el borrador vuelve aquí tal cual; si ya se empezó otro,
 * el que falló se queda en la lista con "Reintentar".
 */

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { Camera, FileText, Paperclip, SendHorizontal, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ACEPTA_CHAT, MAX_ADJUNTOS, esImagen, esVideo, type Referencia } from "@/lib/chat/tipos";
import { mimeDeArchivo, pesoTexto, validarArchivoChat } from "@/lib/chat/logica";
import { CampoConReferencias } from "@/components/chat/referencias";
import { Button } from "@/components/ui/button";
import type { ArchivoBorrador, Borrador, Conversacion } from "./use-conversacion";

export interface CompositorManejo {
  /** Devuelve al cuadro un borrador que no se envió. `false` si ya hay algo escrito. */
  restaurar: (b: Borrador) => boolean;
  /** No hay nada escrito ni elegido: se puede restaurar sin pisar nada. */
  estaVacio: () => boolean;
}

export function Compositor({
  chat,
  autoFoco,
  placeholder,
  ref,
}: {
  chat: Conversacion;
  autoFoco?: boolean;
  placeholder?: string;
  ref?: Ref<CompositorManejo>;
}) {
  const [texto, setTexto] = useState("");
  const [referencias, setReferencias] = useState<Referencia[]>([]);
  const [archivos, setArchivos] = useState<ArchivoBorrador[]>([]);
  const entrada = useRef<HTMLInputElement>(null);
  const camara = useRef<HTMLInputElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);

  // El valor vigente, para leerlo al desmontar y al restaurar sin depender del render.
  const actual = useRef({ texto, archivos });
  useEffect(() => {
    actual.current = { texto, archivos };
  }, [texto, archivos]);

  // Las vistas previas que siguen en el cuadro al irse ya no las muestra nadie.
  useEffect(
    () => () => {
      for (const a of actual.current.archivos) if (a.vistaPrevia) URL.revokeObjectURL(a.vistaPrevia);
    },
    [],
  );

  const agregar = useCallback((elegidos: File[]) => {
    if (elegidos.length === 0) return;
    const problemas: string[] = [];
    const aceptados: ArchivoBorrador[] = [];
    for (const archivo of elegidos) {
      const problema = validarArchivoChat(archivo);
      const mime = mimeDeArchivo(archivo);
      if (problema || !mime) {
        problemas.push(problema ?? `“${archivo.name}” no se puede enviar.`);
        continue;
      }
      aceptados.push({
        id: crypto.randomUUID(),
        archivo,
        mime,
        vistaPrevia: esImagen(mime) || esVideo(mime) ? URL.createObjectURL(archivo) : null,
      });
    }

    const espacio = MAX_ADJUNTOS - actual.current.archivos.length;
    const entran = aceptados.slice(0, Math.max(0, espacio));
    for (const sobra of aceptados.slice(entran.length)) if (sobra.vistaPrevia) URL.revokeObjectURL(sobra.vistaPrevia);
    if (entran.length < aceptados.length) problemas.push(`Hasta ${MAX_ADJUNTOS} archivos por mensaje.`);

    if (problemas.length === 1) toast.error(problemas[0]);
    else if (problemas.length > 1) {
      toast.error(`${problemas.length} archivos no se agregaron`, { description: problemas.join("\n") });
    }
    if (entran.length) setArchivos((previos) => [...previos, ...entran]);
  }, []);

  const quitar = (id: string) => {
    setArchivos((previos) => {
      const sale = previos.find((a) => a.id === id);
      if (sale?.vistaPrevia) URL.revokeObjectURL(sale.vistaPrevia);
      return previos.filter((a) => a.id !== id);
    });
  };

  const elegir = (e: React.ChangeEvent<HTMLInputElement>) => {
    const elegidos = Array.from(e.target.files ?? []);
    // Sin esto, elegir el mismo archivo dos veces seguidas no dispara `change`.
    e.target.value = "";
    agregar(elegidos);
  };

  const estaVacio = useCallback(() => !actual.current.texto.trim() && actual.current.archivos.length === 0, []);

  const restaurar = useCallback((b: Borrador) => {
    if (!estaVacio()) return false;
    setTexto(b.texto);
    setReferencias(b.referencias);
    setArchivos(b.archivos);
    campo.current?.focus();
    return true;
  }, [estaVacio]);

  useImperativeHandle(ref, () => ({ restaurar, estaVacio }), [restaurar, estaVacio]);

  const enviar = async () => {
    const limpio = texto.trim();
    if (!limpio && archivos.length === 0) return;
    const borrador: Borrador = { texto: limpio, referencias, archivos };
    // Las vistas previas pasan al mensaje en pantalla: se vacía sin liberarlas.
    setTexto("");
    setReferencias([]);
    setArchivos([]);
    campo.current?.focus();

    const { ok, localId } = await chat.enviar(borrador);
    if (ok) return;
    const recuperado = estaVacio() ? chat.recuperar(localId) : null;
    if (recuperado) {
      restaurar(recuperado);
      toast.error("No se envió el mensaje", { description: "Volvió al cuadro de texto: inténtalo otra vez." });
    } else {
      toast.error("No se envió el mensaje", { description: "Quedó en la conversación para reintentarlo." });
    }
  };

  const hayAlgo = texto.trim().length > 0 || archivos.length > 0;

  return (
    <div className="border-t p-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] sm:p-3">
      {archivos.length > 0 && (
        <ul className="mb-2 flex gap-2 overflow-x-auto pb-1">
          {archivos.map((a) => (
            <li key={a.id} className="relative shrink-0">
              <div className="bg-muted relative grid size-16 place-items-center overflow-hidden rounded-lg border">
                {a.vistaPrevia && esImagen(a.mime) ? (
                  // eslint-disable-next-line @next/next/no-img-element -- vista previa local de un blob
                  <img src={a.vistaPrevia} alt="" className="size-full object-cover" />
                ) : a.vistaPrevia && esVideo(a.mime) ? (
                  <video src={a.vistaPrevia} muted playsInline preload="metadata" className="size-full object-cover" />
                ) : (
                  <FileText className="text-muted-foreground size-5" />
                )}
                <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1 text-[0.6rem] text-white">
                  {pesoTexto(a.archivo.size)}
                </span>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="icon-xs"
                className="absolute -top-1.5 -right-1.5 rounded-full border shadow-sm"
                aria-label={`Quitar ${a.archivo.name}`}
                onClick={() => quitar(a.id)}
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="flex items-end gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          void enviar();
        }}
      >
        <input
          ref={entrada}
          type="file"
          multiple
          accept={ACEPTA_CHAT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={elegir}
        />
        {/* `capture` abre la cámara trasera directo en el celular; en escritorio no hace nada. */}
        <input
          ref={camara}
          type="file"
          accept="image/*,video/*"
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={elegir}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-muted-foreground size-9 shrink-0"
          onClick={() => entrada.current?.click()}
          aria-label="Adjuntar fotos, videos o PDF"
        >
          <Paperclip />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-muted-foreground size-9 shrink-0 pointer-fine:hidden"
          onClick={() => camara.current?.click()}
          aria-label="Sacar una foto o un video"
        >
          <Camera />
        </Button>
        <CampoConReferencias
          ref={campo}
          valor={texto}
          referencias={referencias}
          onCambio={(t, r) => {
            setTexto(t);
            setReferencias(r);
          }}
          onEnviar={() => void enviar()}
          onPegarArchivos={agregar}
          placeholder={placeholder}
          autoFocus={autoFoco}
          className="min-w-0 flex-1"
        />
        <Button
          type="submit"
          size="icon"
          className={cn("size-9 shrink-0", !hayAlgo && "opacity-60")}
          disabled={!hayAlgo}
          aria-label="Enviar"
        >
          <SendHorizontal />
        </Button>
      </form>
    </div>
  );
}
