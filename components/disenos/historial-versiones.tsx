"use client";

/**
 * El historial de versiones de un diseño (pestaña "Historial" de `VistaDiseno`).
 *
 * Cada guardado ya es una versión: aquí se ven todas, con quién y cuándo, y se
 * puede mirar una vieja en el visor sin guardar nada, volver a ella
 * (restaurar = copiarla como versión nueva: nada se pierde) o ponerle nombre.
 * Lo pensado para el caso de "otra persona cambió mi diseño": arriba sale el
 * aviso con un botón para volver a la última versión propia.
 *
 * Las reglas (cuál es "la mía", los textos) viven en `lib/cad/historial.ts`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Check, Eye, History, Loader2, Pencil, RotateCcw, Tag, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { cargarHistorial, nombrarVersionDiseno } from "@/app/(app)/disenos/acciones";
import {
  avisoCambioAjeno,
  fechaVersion,
  nombreAutor,
  soloDe,
  textoOrigen,
  versionActual,
  type VersionHistorial,
} from "@/lib/cad/historial";
import { PLANTILLA_LIBRE } from "@/lib/cad/tipos";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useDiseno } from "./diseno-contexto";

/** Lo que se pide confirmar antes de restaurar. */
type Confirmacion = { version: VersionHistorial; titulo: string; texto: string };

/**
 * La barra de la vista previa: se ve desde cualquier pestaña mientras se mira
 * una versión vieja, para que nadie edite creyendo que está en la actual.
 */
export function BarraVistaPrevia() {
  const { vistaPrevia, volverALaActual, restaurar } = useDiseno();
  const [confirmar, setConfirmar] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  if (!vistaPrevia) return null;

  return (
    <div
      role="status"
      className="bg-st-observado/10 text-foreground flex flex-wrap items-center gap-2 border-b px-3 py-2 text-sm"
    >
      <Eye aria-hidden className="text-st-observado size-4 shrink-0" />
      <span className="min-w-0 flex-1">
        Viendo la <strong>v{vistaPrevia.version}</strong>
        {vistaPrevia.nombreVersion ? ` · ${vistaPrevia.nombreVersion}` : ""}
        <span className="text-muted-foreground"> · sin guardar, no se puede editar</span>
      </span>
      <Button size="sm" variant="default" className="gap-1.5" disabled={ocupado} onClick={() => setConfirmar(true)}>
        <RotateCcw />
        Restaurar
      </Button>
      <Button size="sm" variant="outline" disabled={ocupado} onClick={() => void volverALaActual()}>
        Volver a la actual
      </Button>
      <ConfirmarRestaurar
        abierta={confirmar}
        confirmacion={{
          version: vistaPrevia,
          titulo: `¿Volver a la v${vistaPrevia.version}?`,
          texto: "Se guarda como una versión nueva. La actual no se pierde: queda en el historial.",
        }}
        alCerrar={() => setConfirmar(false)}
        alConfirmar={async (v) => {
          setOcupado(true);
          await restaurar(v);
          setOcupado(false);
        }}
      />
    </div>
  );
}

function ConfirmarRestaurar({
  abierta,
  confirmacion,
  alCerrar,
  alConfirmar,
}: {
  abierta: boolean;
  confirmacion: Confirmacion | null;
  alCerrar: () => void;
  alConfirmar: (v: VersionHistorial) => Promise<void>;
}) {
  return (
    <AlertDialog open={abierta} onOpenChange={(o) => !o && alCerrar()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirmacion?.titulo}</AlertDialogTitle>
          <AlertDialogDescription>{confirmacion?.texto}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <Button
            onClick={() => {
              const v = confirmacion?.version;
              alCerrar();
              if (v) void alConfirmar(v);
            }}
          >
            Restaurar
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function HistorialVersiones({
  abierto,
  verAlAbrir = null,
}: {
  abierto: boolean;
  /** La versión que pidió la URL (`?version=N`): se muestra en vista previa al cargar. */
  verAlAbrir?: number | null;
}) {
  const { disenoId, versionVigente, vistaPrevia, verVersion, volverALaActual, restaurar, usuario, cargando } =
    useDiseno();
  const yo = usuario?.id ?? null;

  const [versiones, setVersiones] = useState<VersionHistorial[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [soloMias, setSoloMias] = useState(false);
  const [confirmacion, setConfirmacion] = useState<Confirmacion | null>(null);
  /** La versión a la que se le está escribiendo el nombre. */
  const [nombrando, setNombrando] = useState<{ version: number; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  /** La de `?version=N`, hasta que se haya mostrado una vez. */
  const pendiente = useRef<number | null>(null);

  // Se lee al abrir y cada vez que cambia la vigente (guardado propio, restauración, chat).
  useEffect(() => {
    if (!abierto) return;
    if (verAlAbrir !== null) pendiente.current = verAlAbrir;
    let vivo = true;
    cargarHistorial(disenoId)
      .then((v) => {
        if (!vivo) return;
        setVersiones(v);
        setError(null);
        const pedida = pendiente.current;
        pendiente.current = null;
        if (pedida === null) return;
        const vigente = versionActual(v);
        const elegida = v.find((x) => x.version === pedida);
        if (!elegida) toast.info(`La v${pedida} ya no está en el historial.`);
        else if (elegida.version !== vigente?.version) void verVersion(elegida, vigente);
      })
      .catch((e: unknown) => {
        if (vivo) setError(e instanceof Error ? e.message : "No se pudo leer el historial.");
      });
    return () => {
      vivo = false;
    };
    // `verVersion` no entra: cambia con cada render del contexto y la vista
    // previa pedida por la URL se hace una sola vez (la guarda `pendiente`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, disenoId, versionVigente, recarga, verAlAbrir]);

  const actual = useMemo(() => (versiones ? versionActual(versiones) : null), [versiones]);
  const aviso = useMemo(() => (versiones && yo ? avisoCambioAjeno(versiones, yo) : null), [versiones, yo]);
  const visibles = useMemo(
    () => (versiones ? (soloMias && yo ? soloDe(versiones, yo) : versiones) : []),
    [versiones, soloMias, yo],
  );

  const pedirRestaurar = useCallback((v: VersionHistorial, titulo?: string) => {
    setConfirmacion({
      version: v,
      titulo: titulo ?? `¿Volver a la v${v.version}?`,
      texto: "Se guarda como una versión nueva con lo de esa versión. La actual no se pierde: queda en el historial.",
    });
  }, []);

  async function guardarNombre(version: number, texto: string) {
    setOcupado(true);
    try {
      await nombrarVersionDiseno(disenoId, version, texto);
      setNombrando(null);
      setRecarga((n) => n + 1);
      toast.success(texto.trim() ? `La v${version} quedó con su nombre.` : `Se quitó el nombre de la v${version}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar el nombre.");
    } finally {
      setOcupado(false);
    }
  }

  if (error && !versiones) {
    return (
      <div className="space-y-2 text-sm">
        <p className="text-destructive">{error}</p>
        <Button size="sm" variant="outline" onClick={() => setRecarga((n) => n + 1)}>
          Reintentar
        </Button>
      </div>
    );
  }
  if (!versiones) {
    return (
      <p className="text-muted-foreground flex items-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin" /> Cargando el historial…
      </p>
    );
  }
  if (versiones.length === 0) {
    return <p className="text-muted-foreground text-sm">Todavía no hay versiones: cada vez que se guarda el diseño queda una aquí.</p>;
  }

  return (
    <div className="flex flex-col gap-3 text-sm">
      {aviso && (
        <div className="border-st-observado/40 bg-st-observado/10 rounded-lg border p-3">
          <p>
            <strong>{aviso.autor}</strong> modificó este diseño (v{aviso.version}). Tu última versión es la{" "}
            <strong>v{aviso.mia.version}</strong>.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              size="sm"
              className="gap-1.5"
              disabled={ocupado || cargando}
              onClick={() => pedirRestaurar(aviso.mia, `¿Volver a tu versión (v${aviso.mia.version})?`)}
            >
              <Undo2 />
              Volver a mi versión
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={cargando}
              onClick={() => void verVersion(aviso.mia, actual)}
            >
              <Eye />
              Ver mi versión
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <History aria-hidden className="text-muted-foreground size-4" />
        <span className="font-medium">
          {versiones.length} {versiones.length === 1 ? "versión" : "versiones"}
        </span>
        <label className="text-muted-foreground ml-auto flex cursor-pointer items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            className="accent-primary"
            checked={soloMias}
            onChange={(e) => setSoloMias(e.target.checked)}
            disabled={!yo}
          />
          Solo las mías
        </label>
      </div>

      {actual && !vistaPrevia && (
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 self-start"
          disabled={ocupado}
          onClick={() => setNombrando({ version: actual.version, texto: actual.nombreVersion ?? "" })}
        >
          <Tag />
          Guardar versión con nombre
        </Button>
      )}

      {visibles.length === 0 && <p className="text-muted-foreground">Todavía no guardaste ninguna versión de este diseño.</p>}

      <ul className="flex flex-col gap-2">
        {visibles.map((v) => {
          const esActual = v.version === actual?.version;
          const viendo = vistaPrevia?.version === v.version;
          return (
            <li
              key={v.version}
              className={cn(
                "bg-card flex gap-3 rounded-lg border p-2",
                esActual && "border-primary/50",
                viendo && "ring-st-observado ring-2",
              )}
            >
              <div className="bg-muted flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md">
                {v.miniatura ? (
                  // eslint-disable-next-line @next/next/no-img-element -- foto pública del bucket, ya chica
                  <img src={v.miniatura} alt="" className="size-full object-contain" loading="lazy" />
                ) : (
                  <Box aria-hidden className="text-muted-foreground size-6" />
                )}
              </div>

              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-semibold tabular-nums">v{v.version}</span>
                  {esActual && <Badge variant="secondary">actual</Badge>}
                  {viendo && <Badge variant="outline">viendo</Badge>}
                  {v.plantilla === PLANTILLA_LIBRE && v.estado === "borrador" && (
                    <Badge variant="outline" className="border-st-observado text-st-observado">
                      borrador
                    </Badge>
                  )}
                  {v.nombreVersion && (
                    <span className="text-primary flex min-w-0 items-center gap-1 truncate font-medium">
                      <Tag aria-hidden className="size-3 shrink-0" />
                      {v.nombreVersion}
                    </span>
                  )}
                </div>
                <p className="text-muted-foreground text-xs">
                  <span className={cn(v.creadoPor === yo && "text-foreground font-medium")}>{nombreAutor(v, yo)}</span>
                  {" · "}
                  <time dateTime={v.creadoEn} title={new Date(v.creadoEn).toLocaleString("es-PE", { timeZone: "America/Lima" })}>
                    {fechaVersion(v.creadoEn)}
                  </time>
                  {" · "}
                  {textoOrigen(v)}
                </p>

                {nombrando?.version === v.version ? (
                  <form
                    className="flex items-center gap-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void guardarNombre(v.version, nombrando.texto);
                    }}
                  >
                    <Input
                      autoFocus
                      value={nombrando.texto}
                      maxLength={80}
                      placeholder="Aprobada por el cliente"
                      aria-label={`Nombre de la v${v.version}`}
                      className="h-8"
                      onChange={(e) => setNombrando({ version: v.version, texto: e.target.value })}
                      onKeyDown={(e) => e.key === "Escape" && setNombrando(null)}
                    />
                    <Button type="submit" size="icon-sm" disabled={ocupado}>
                      {ocupado ? <Loader2 className="animate-spin" /> : <Check />}
                      <span className="sr-only">Guardar nombre</span>
                    </Button>
                    <Button type="button" size="icon-sm" variant="ghost" onClick={() => setNombrando(null)}>
                      <X />
                      <span className="sr-only">Cancelar</span>
                    </Button>
                  </form>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {viendo ? (
                      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => void volverALaActual()}>
                        Volver a la actual
                      </Button>
                    ) : esActual ? (
                      vistaPrevia && (
                        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => void volverALaActual()}>
                          <Eye />
                          Ver la actual
                        </Button>
                      )
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2"
                        disabled={cargando}
                        onClick={() => void verVersion(v, actual)}
                      >
                        <Eye />
                        Vista previa
                      </Button>
                    )}
                    {!esActual && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2"
                        disabled={ocupado}
                        onClick={() => pedirRestaurar(v)}
                      >
                        <RotateCcw />
                        Restaurar
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2"
                      disabled={ocupado}
                      onClick={() => setNombrando({ version: v.version, texto: v.nombreVersion ?? "" })}
                    >
                      <Pencil />
                      {v.nombreVersion ? "Renombrar" : "Poner nombre"}
                    </Button>
                    {v.nombreVersion && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground h-7 px-2"
                        disabled={ocupado}
                        onClick={() => void guardarNombre(v.version, "")}
                      >
                        Quitar nombre
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <ConfirmarRestaurar
        abierta={confirmacion !== null}
        confirmacion={confirmacion}
        alCerrar={() => setConfirmacion(null)}
        alConfirmar={async (v) => {
          setOcupado(true);
          await restaurar(v);
          setOcupado(false);
        }}
      />
    </div>
  );
}
