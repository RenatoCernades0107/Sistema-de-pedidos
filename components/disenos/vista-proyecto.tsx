"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowLeft, Box, Check, CheckCheck, Loader2, Pencil, Plus, Trash2, Unlink, X } from "lucide-react";
import { toast } from "sonner";
import {
  agregarDisenoAProyecto,
  aprobarProyectoAccion,
  eliminarProyectoAccion,
  quitarDisenoDeProyecto,
  renombrarProyectoAccion,
} from "@/app/(app)/disenos/acciones";
import { textoDeResumen, type EstadoDiseno, type ResumenProyecto } from "@/lib/cad/proyectos";
import type { DisenoCad, PlantillaCad } from "@/lib/cad/tipos";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const ESTADOS: Record<EstadoDiseno, { texto: string; clase: string }> = {
  sin_version: { texto: "Sin empezar", clase: "text-muted-foreground" },
  plantilla: { texto: "Listo", clase: "" },
  borrador: { texto: "Borrador por aprobar", clase: "border-st-observado text-st-observado" },
  aprobado: { texto: "Aprobado", clase: "" },
};

/**
 * Un proyecto: los diseños de un mismo trabajo (los letreros de una lámina) como
 * tarjetas. Cada tarjeta abre su diseño, con su chat y su visor de siempre.
 * Administración aprueba de una vez los que están en borrador.
 */
export function VistaProyecto({
  proyecto,
  disenos,
  resumen,
  plantillas,
  puedeAprobar,
}: {
  proyecto: { id: string; nombre: string };
  disenos: DisenoCad[];
  resumen: ResumenProyecto;
  plantillas: PlantillaCad[];
  puedeAprobar: boolean;
}) {
  const router = useRouter();
  const [ocupado, empezar] = useTransition();
  const [agregando, empezarAgregar] = useTransition();
  const [editando, setEditando] = useState<string | null>(null);

  const nombrePlantilla = (d: DisenoCad) =>
    d.plantilla === null
      ? "Sin plantilla todavía"
      : d.plantilla === "libre"
        ? "Diseño personalizado"
        : (plantillas.find((p) => p.codigo === d.plantilla)?.nombre ?? d.plantilla);

  function agregar() {
    empezarAgregar(async () => {
      try {
        const { id } = await agregarDisenoAProyecto(proyecto.id);
        router.push(`/disenos/${id}`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "No se pudo agregar el diseño.");
      }
    });
  }

  function renombrar() {
    const nombre = editando?.trim();
    if (!nombre) return;
    empezar(async () => {
      try {
        await renombrarProyectoAccion(proyecto.id, nombre);
        setEditando(null);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "No se pudo cambiar el nombre.");
      }
    });
  }

  function aprobarTodo() {
    empezar(async () => {
      try {
        const n = await aprobarProyectoAccion(proyecto.id);
        toast.success(n === 1 ? "Se aprobó 1 diseño." : `Se aprobaron ${n} diseños.`);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "No se pudo aprobar el proyecto.");
      }
    });
  }

  function quitar(id: string) {
    empezar(async () => {
      try {
        await quitarDisenoDeProyecto(id);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "No se pudo quitar el diseño del proyecto.");
      }
    });
  }

  function eliminar() {
    empezar(async () => {
      try {
        await eliminarProyectoAccion(proyecto.id);
        router.push("/disenos");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "No se pudo borrar el proyecto.");
      }
    });
  }

  return (
    <div className="px-4 py-5 md:px-6 md:py-6">
      <Link href="/disenos" className="text-muted-foreground hover:text-foreground mb-3 inline-flex items-center gap-1 text-sm">
        <ArrowLeft className="size-4" aria-hidden />
        Diseños
      </Link>

      <header className="mb-5 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          {editando === null ? (
            <h1 className="flex items-center gap-1 text-xl font-semibold tracking-tight">
              <span className="truncate">{proyecto.nombre}</span>
              <Button variant="ghost" size="icon-sm" onClick={() => setEditando(proyecto.nombre)}>
                <Pencil />
                <span className="sr-only">Cambiar el nombre del proyecto</span>
              </Button>
            </h1>
          ) : (
            <form
              className="flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                renombrar();
              }}
            >
              <Input
                autoFocus
                aria-label="Nombre del proyecto"
                value={editando}
                maxLength={120}
                onChange={(e) => setEditando(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setEditando(null)}
              />
              <Button type="submit" size="icon-sm" disabled={ocupado || !editando.trim()}>
                <Check />
                <span className="sr-only">Guardar nombre</span>
              </Button>
              <Button type="button" variant="ghost" size="icon-sm" onClick={() => setEditando(null)}>
                <X />
                <span className="sr-only">Cancelar</span>
              </Button>
            </form>
          )}
          <p className="text-muted-foreground mt-0.5 text-sm">
            {textoDeResumen(resumen)}
            {resumen.borradores > 0 && ` · ${resumen.borradores} por aprobar`}
            {resumen.sinVersion > 0 && ` · ${resumen.sinVersion} sin empezar`}
          </p>
        </div>

        {puedeAprobar && (
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="outline" className="gap-1.5" disabled={ocupado || resumen.borradores === 0} />}>
              <CheckCheck />
              Aprobar todo
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Aprobar los diseños del proyecto?</AlertDialogTitle>
                <AlertDialogDescription>
                  Se {resumen.borradores === 1 ? "aprueba 1 diseño personalizado" : `aprueban ${resumen.borradores} diseños personalizados`} en
                  su versión actual y ya se podrá bajar su DXF para producción. Si alguien guarda una versión nueva
                  después, esa vuelve a quedar en borrador.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={aprobarTodo}>Aprobar</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        <Button className="gap-1.5" onClick={agregar} disabled={agregando}>
          {agregando ? <Loader2 className="animate-spin" /> : <Plus />}
          Agregar diseño
        </Button>
      </header>

      {disenos.length === 0 ? (
        <div className="grid min-h-[40vh] place-items-center rounded-lg border border-dashed p-6 text-center">
          <div className="max-w-sm">
            <Box className="text-muted-foreground mx-auto size-6" aria-hidden />
            <p className="mt-2 text-sm font-medium">Este proyecto no tiene diseños</p>
            <p className="text-muted-foreground mt-1 text-sm">
              Agrega uno, o abre un diseño, adjunta el plano del cliente y pídele al asistente que cree un diseño por
              cada pieza.
            </p>
          </div>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {disenos.map((d) => {
            const estado = ESTADOS[d.estado];
            return (
              <li key={d.id} className="bg-card hover:border-primary/40 group relative flex flex-col overflow-hidden rounded-lg border transition-colors">
                <span className="from-muted/40 to-muted grid h-36 place-items-center overflow-hidden bg-gradient-to-b">
                  {d.miniatura ? (
                    // eslint-disable-next-line @next/next/no-img-element -- PNG chico ya del tamaño justo; no pasa por el optimizador.
                    <img src={d.miniatura} alt="" loading="lazy" className="h-full w-full object-contain" />
                  ) : (
                    <Box className="text-muted-foreground size-6" aria-hidden />
                  )}
                </span>
                <div className="flex items-start gap-2 p-3">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/disenos/${d.id}`}
                      className="block truncate text-sm font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring"
                    >
                      {d.nombre}
                    </Link>
                    <p className="text-muted-foreground truncate text-xs">
                      {nombrePlantilla(d)}
                      {d.version > 0 && ` · versión ${d.version}`}
                    </p>
                    <Badge variant={d.estado === "borrador" ? "outline" : "secondary"} className={`mt-2 ${estado.clase}`}>
                      {estado.texto}
                    </Badge>
                  </div>
                  <AlertDialog>
                    <AlertDialogTrigger render={<Button variant="ghost" size="icon-sm" className="relative z-10" />}>
                      <Unlink />
                      <span className="sr-only">Quitar {d.nombre} del proyecto</span>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>¿Quitar del proyecto?</AlertDialogTitle>
                        <AlertDialogDescription>
                          «{d.nombre}» sigue existiendo, con todo su historial, pero queda como diseño suelto.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={() => quitar(d.id)}>Quitar</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-8 border-t pt-4">
        <AlertDialog>
          <AlertDialogTrigger render={<Button variant="ghost" size="sm" className="text-destructive gap-1.5" disabled={ocupado} />}>
            <Trash2 />
            Borrar proyecto
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Borrar el proyecto?</AlertDialogTitle>
              <AlertDialogDescription>
                Se borra «{proyecto.nombre}», pero sus {disenos.length === 1 ? "diseño queda" : `${disenos.length} diseños quedan`} como
                diseños sueltos: no se pierde nada de ellos.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={eliminar}>
                Borrar proyecto
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
