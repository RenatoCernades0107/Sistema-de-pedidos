"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Box, ExternalLink, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { crearDiseno, guardarVersion } from "@/app/(app)/disenos/acciones";
import { tinteDeColor } from "@/lib/cad/colores";
import type { ParametrosCad, ResultadoGeneracion } from "@/lib/cad/tipos";
import { cn } from "@/lib/utils";
import { ListaPiezas, ListaValidaciones } from "@/components/disenos/lista-piezas";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

// three necesita `window`: el visor no se prerenderiza (como en /disenos).
const Visor3D = dynamic(() => import("@/components/disenos/visor-3d"), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-none" />,
});

/** Cuánto se espera tras el último cambio de medida antes de pedir el modelo. */
const ESPERA_MS = 400;

type Estado =
  | { tipo: "cargando" }
  | { tipo: "listo"; resultado: ResultadoGeneracion }
  | { tipo: "fallo"; mensaje: string }
  /** La sesión no puede usar el motor (401): se usa la estimación de siempre. */
  | { tipo: "sin_acceso" };

/**
 * El modelo 3D y el despiece real de un producto terminado que una plantilla
 * del motor CAD cubre. Pide el modelo por `/api/cad/generar`, como /disenos.
 * Si no puede —sin permiso, motor caído, medida que la plantilla no admite—
 * avisa con `alDisponible(false)` para que el editor muestre la estimación de
 * `piezasDeTerminado()`.
 */
export function ModeloCadTerminado({
  plantilla,
  parametros,
  nombre,
  color,
  alDisponible,
  className,
}: {
  plantilla: string;
  parametros: ParametrosCad;
  /** Para el nombre del diseño al abrirlo en /disenos. */
  nombre: string;
  color?: string | null;
  alDisponible?: (si: boolean) => void;
  className?: string;
}) {
  const [estado, setEstado] = useState<Estado>({ tipo: "cargando" });
  const [piezaActiva, setPiezaActiva] = useState<string | null>(null);
  const [abriendo, iniciarApertura] = useTransition();
  const router = useRouter();
  const clave = JSON.stringify([plantilla, parametros]);

  useEffect(() => {
    const control = new AbortController();
    const espera = setTimeout(async () => {
      setEstado({ tipo: "cargando" });
      try {
        const [p, params] = JSON.parse(clave) as [string, ParametrosCad];
        const r = await fetch("/api/cad/generar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plantilla: p, parametros: params }),
          signal: control.signal,
        });
        if (r.status === 401) {
          setEstado({ tipo: "sin_acceso" });
          alDisponible?.(false);
          return;
        }
        const cuerpo = await r.json().catch(() => null);
        if (!r.ok) {
          setEstado({ tipo: "fallo", mensaje: cuerpo?.error ?? "No se pudo generar el modelo." });
          alDisponible?.(false);
          return;
        }
        setEstado({ tipo: "listo", resultado: cuerpo as ResultadoGeneracion });
        alDisponible?.(true);
      } catch (e) {
        if (control.signal.aborted) return;
        console.error("[terminados] modelo CAD", e);
        setEstado({ tipo: "fallo", mensaje: "No se pudo conectar con el motor de diseños." });
        alDisponible?.(false);
      }
    }, ESPERA_MS);
    return () => {
      clearTimeout(espera);
      control.abort();
    };
  }, [clave, alDisponible]);

  if (estado.tipo === "sin_acceso") return null;

  const abrirEnDisenos = () =>
    iniciarApertura(async () => {
      // Se abre la pestaña ya, dentro del clic: si no, el navegador la bloquea.
      const pestana = window.open("about:blank", "_blank");
      try {
        const { id } = await crearDiseno();
        await guardarVersion(id, plantilla, parametros);
        const destino = `/disenos/${id}`;
        if (pestana) pestana.location.href = destino;
        else router.push(destino);
        toast.success(`Diseño creado para ${nombre}.`);
      } catch (e) {
        pestana?.close();
        toast.error(e instanceof Error ? e.message : "No se pudo crear el diseño.");
      }
    });

  const resultado = estado.tipo === "listo" ? estado.resultado : null;

  return (
    <section className={cn("flex flex-col gap-3", className)} aria-label="Modelo 3D del producto">
      <div className="flex flex-wrap items-center gap-2">
        <Box className="text-muted-foreground size-4" aria-hidden />
        <p className="flex-1 text-xs font-medium">
          Modelo y despiece del motor de diseños
          {resultado && (
            <span className="text-muted-foreground tnum font-normal">
              {" "}
              · {Math.round(resultado.dimensiones.x)} × {Math.round(resultado.dimensiones.y)} ×{" "}
              {Math.round(resultado.dimensiones.z)} mm
            </span>
          )}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={abrirEnDisenos} disabled={abriendo}>
          {abriendo ? <LoaderCircle className="animate-spin" aria-hidden /> : <ExternalLink aria-hidden />}
          Abrir en Diseños
        </Button>
      </div>

      {estado.tipo === "fallo" ? (
        <p className="text-muted-foreground text-xs" role="status">
          {estado.mensaje} Se muestra la estimación por forma.
        </p>
      ) : (
        <>
          <div className="bg-muted/30 relative h-72 overflow-hidden rounded-md border">
            {resultado ? (
              <Visor3D
                glbBase64={resultado.glb_base64}
                dimensiones={resultado.dimensiones}
                idsPiezas={resultado.piezas.map((p) => p.id)}
                piezaActiva={piezaActiva}
                alCambiarPieza={setPiezaActiva}
                tinte={tinteDeColor(color)}
                className="h-full w-full"
              />
            ) : (
              <Skeleton className="h-full w-full rounded-none" />
            )}
            {estado.tipo === "cargando" && resultado === null && (
              <span className="sr-only" role="status">
                Generando el modelo…
              </span>
            )}
          </div>
          {resultado && (
            <>
              {resultado.validaciones.length > 0 && (
                <ListaValidaciones
                  validaciones={resultado.validaciones}
                  piezas={resultado.piezas}
                  piezaActiva={piezaActiva}
                  alCambiarPieza={setPiezaActiva}
                />
              )}
              <ListaPiezas
                piezas={resultado.piezas}
                validaciones={resultado.validaciones}
                piezaActiva={piezaActiva}
                alCambiarPieza={setPiezaActiva}
              />
            </>
          )}
        </>
      )}
    </section>
  );
}
