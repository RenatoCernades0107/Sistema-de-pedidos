"use client";

/**
 * Los archivos del pedido: la galería, la subida y el borrado.
 *
 * Vive fuera de `detalle-pedido.tsx` porque es lo único de esa pantalla que habla
 * con Storage, y porque el detalle ya es bastante largo.
 *
 * Qué archivos ve cada rol lo decide la RLS, no esto: `adjuntos_lectura` no le
 * devuelve al taller ni la factura ni la guía. El filtro de aquí es para que la
 * pantalla no prometa lo que la base no va a dar.
 */

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  FileText,
  ImageIcon,
  Loader2,
  Paperclip,
  Receipt,
  ScrollText,
  Trash2,
  Upload,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { subirAdjuntos } from "@/lib/adjuntos-navegador";
import { ACEPTA } from "@/lib/adjuntos";
import { eliminarAdjunto, urlAdjunto } from "@/app/(app)/adjuntos-acciones";
import { ADJUNTOS, type Adjunto, type Pedido, type TipoAdjunto } from "@/lib/dominio";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ICONO_ADJUNTO = {
  diseno: FileText,
  factura: Receipt,
  guia: ScrollText,
  foto_entrega: ImageIcon,
} as const;

export function AdjuntosPedido({ pedido: p }: { pedido: Pedido }) {
  const { permisos } = useStore();
  const entrada = useRef<HTMLInputElement>(null);
  const [tipo, setTipo] = useState<TipoAdjunto>("diseno");
  const [porBorrar, setPorBorrar] = useState<Adjunto | null>(null);
  const [trabajando, iniciar] = useTransition();

  const visibles: Adjunto[] = permisos.verEnvioCompleto
    ? p.adjuntos
    : p.adjuntos.filter((a) => a.tipo === "diseno" || a.tipo === "foto_entrega");

  const elegidos = (e: React.ChangeEvent<HTMLInputElement>) => {
    const archivos = Array.from(e.target.files ?? []);
    /* El input se vacía siempre: sin esto, elegir el mismo archivo dos veces
       seguidas no dispara `change` y parece que la app se colgó. */
    e.target.value = "";
    if (archivos.length === 0) return;

    iniciar(async () => {
      const { subidos, errores } = await subirAdjuntos(p.codigo, tipo, archivos);

      if (subidos > 0) {
        toast.success(subidos === 1 ? "Archivo subido" : `${subidos} archivos subidos`, {
          description: `${ADJUNTOS[tipo]} · ${p.codigo}`,
        });
      }
      // Uno por archivo que no entró: con seis elegidos y dos caídos, saber cuáles
      // es lo único que sirve para reintentar.
      for (const error of errores) toast.error("No se subió", { description: error });
    });
  };

  const abrir = (a: Adjunto) =>
    iniciar(async () => {
      const resultado = await urlAdjunto(a.id);
      if ("error" in resultado) {
        toast.error("No se pudo abrir", { description: resultado.error });
        return;
      }
      window.open(resultado.url, "_blank", "noopener,noreferrer");
    });

  const borrar = (a: Adjunto) =>
    iniciar(async () => {
      const resultado = await eliminarAdjunto(a.id);
      setPorBorrar(null);
      if (resultado.ok) toast.success(`Se borró ${a.nombre}`);
      else toast.error("No se borró", { description: resultado.error });
    });

  return (
    <div className="flex flex-col gap-3">
      {visibles.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
          <Paperclip className="mx-auto mb-2 size-4 opacity-50" />
          Sin archivos todavía
        </div>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {visibles.map((a) => {
            const Icono = ICONO_ADJUNTO[a.tipo];
            return (
              <li key={a.id}>
                <div className="bg-muted/40 focus-within:border-ring/40 hover:border-ring/40 flex items-center gap-2.5 rounded-lg border py-2 pr-1.5 pl-2.5 transition-colors">
                  <button
                    type="button"
                    onClick={() => abrir(a)}
                    aria-label={`Abrir ${a.nombre}`}
                    className="focus-visible:ring-ring flex min-w-0 items-center gap-2.5 rounded text-left focus-visible:ring-2 focus-visible:outline-none"
                  >
                    <span className="bg-card grid size-7 shrink-0 place-items-center rounded-md border">
                      <Icono className="text-muted-foreground size-3.5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block max-w-[16ch] truncate text-xs font-medium">
                        {a.nombre}
                      </span>
                      <span className="text-muted-foreground block text-2xs">
                        {ADJUNTOS[a.tipo]} · {a.peso}
                      </span>
                    </span>
                  </button>

                  {permisos.adjuntarArchivos && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive size-7 shrink-0"
                      aria-label={`Borrar ${a.nombre}`}
                      onClick={() => setPorBorrar(a)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {permisos.adjuntarArchivos && (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={tipo} onValueChange={(v) => v && setTipo(v as TipoAdjunto)}>
            <SelectTrigger size="sm" className="w-44" aria-label="Tipo de archivo">
              <SelectValue>{ADJUNTOS[tipo]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(ADJUNTOS) as TipoAdjunto[]).map((t) => (
                <SelectItem key={t} value={t}>
                  {ADJUNTOS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <input
            ref={entrada}
            type="file"
            multiple
            accept={ACEPTA}
            className="sr-only"
            aria-label="Archivos del pedido"
            onChange={elegidos}
          />

          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={trabajando}
            onClick={() => entrada.current?.click()}
          >
            {trabajando ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Upload className="size-3.5" />
            )}
            {trabajando ? "Subiendo…" : "Subir"}
          </Button>
        </div>
      )}

      <AlertDialog open={porBorrar !== null} onOpenChange={(v) => !v && setPorBorrar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar este archivo?</AlertDialogTitle>
            <AlertDialogDescription>
              {porBorrar?.nombre} se va del pedido {p.codigo} y del almacenamiento. No se
              puede deshacer, pero queda el rastro de quién lo borró.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={trabajando}
              onClick={() => porBorrar && borrar(porBorrar)}
            >
              Borrar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
