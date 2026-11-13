"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Box, Check, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import {
  crearDiseno,
  eliminarDiseno,
  renombrarDiseno,
} from "@/app/(app)/disenos/acciones";
import type { DisenoCad, PlantillaCad } from "@/lib/cad/tipos";
import { momentoEnLima } from "@/lib/fecha";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Los diseños guardados. Cada uno abre su pantalla partida (chat + render); uno
 * nuevo se crea vacío y la plantilla se elige dentro, a mano o por el chat.
 */
export function ListaDisenos({
  disenos,
  plantillas,
}: {
  disenos: DisenoCad[];
  /** Para mostrar el nombre de la plantilla; vacío si el motor no respondió. */
  plantillas: PlantillaCad[];
}) {
  const router = useRouter();
  const [creando, empezarCreacion] = useTransition();
  const [ocupado, empezar] = useTransition();
  const [editando, setEditando] = useState<{ id: string; nombre: string } | null>(null);

  const nombrePlantilla = (codigo: string | null) =>
    codigo === null
      ? "Sin plantilla todavía"
      : (plantillas.find((p) => p.codigo === codigo)?.nombre ?? codigo);

  function nuevo() {
    empezarCreacion(async () => {
      try {
        const { id } = await crearDiseno();
        router.push(`/disenos/${id}`);
      } catch {
        toast.error("No se pudo crear el diseño. Intenta de nuevo.");
      }
    });
  }

  function renombrar() {
    if (!editando) return;
    const { id, nombre } = editando;
    const limpio = nombre.trim();
    if (!limpio) return;
    empezar(async () => {
      try {
        await renombrarDiseno(id, limpio);
        setEditando(null);
        router.refresh();
      } catch {
        toast.error("No se pudo cambiar el nombre.");
      }
    });
  }

  function eliminar(id: string) {
    empezar(async () => {
      try {
        await eliminarDiseno(id);
        router.refresh();
      } catch {
        toast.error("No se pudo eliminar el diseño.");
      }
    });
  }

  return (
    <div className="px-4 py-5 md:px-6 md:py-6">
      <header className="mb-5 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight">Diseños</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            Piezas diseñadas con el asistente: render 3D, despiece y archivos de corte.
          </p>
        </div>
        <Button className="gap-1.5" onClick={nuevo} disabled={creando}>
          {creando ? <Loader2 className="animate-spin" /> : <Plus />}
          Nuevo diseño
        </Button>
      </header>

      {disenos.length === 0 ? (
        <div className="grid min-h-[40vh] place-items-center rounded-lg border border-dashed p-6 text-center">
          <div className="max-w-sm">
            <Box className="text-muted-foreground mx-auto size-6" aria-hidden />
            <p className="mt-2 text-sm font-medium">Todavía no hay diseños</p>
            <p className="text-muted-foreground mt-1 text-sm">
              Crea uno y dile al asistente qué necesitas: una caja, un display, un porta afiches…
            </p>
          </div>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {disenos.map((d) => {
            const enEdicion = editando?.id === d.id;
            return (
              <li
                key={d.id}
                className="bg-card hover:border-primary/40 group relative flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors"
              >
                <Box className="text-muted-foreground size-4 shrink-0" aria-hidden />
                {enEdicion ? (
                  <form
                    className="flex min-w-0 flex-1 items-center gap-1.5"
                    onSubmit={(e) => {
                      e.preventDefault();
                      renombrar();
                    }}
                  >
                    <Input
                      autoFocus
                      aria-label="Nombre del diseño"
                      value={editando.nombre}
                      maxLength={120}
                      onChange={(e) => setEditando({ id: d.id, nombre: e.target.value })}
                      onKeyDown={(e) => e.key === "Escape" && setEditando(null)}
                    />
                    <Button type="submit" size="icon-sm" disabled={ocupado || !editando.nombre.trim()}>
                      <Check />
                      <span className="sr-only">Guardar nombre</span>
                    </Button>
                    <Button type="button" variant="ghost" size="icon-sm" onClick={() => setEditando(null)}>
                      <X />
                      <span className="sr-only">Cancelar</span>
                    </Button>
                  </form>
                ) : (
                  <>
                    <div className="min-w-0 flex-1">
                      {/* El enlace cubre la fila entera; los botones van por encima. */}
                      <Link
                        href={`/disenos/${d.id}`}
                        className="block truncate text-sm font-medium outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring"
                      >
                        {d.nombre}
                      </Link>
                      <p className="text-muted-foreground truncate text-xs">
                        {nombrePlantilla(d.plantilla)} · versión {d.version} · {momentoEnLima(d.actualizado_en)}
                      </p>
                    </div>
                    <div className="relative z-10 flex shrink-0 gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setEditando({ id: d.id, nombre: d.nombre })}
                      >
                        <Pencil />
                        <span className="sr-only">Cambiar el nombre de {d.nombre}</span>
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger render={<Button variant="ghost" size="icon-sm" />}>
                          <Trash2 />
                          <span className="sr-only">Eliminar {d.nombre}</span>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>¿Eliminar este diseño?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Se borra «{d.nombre}» con todas sus versiones y su conversación. No se
                              puede deshacer.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction variant="destructive" onClick={() => eliminar(d.id)}>
                              Eliminar
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
