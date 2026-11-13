"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, LoaderCircle } from "lucide-react";
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

export type EstadoModeloCad =
  /** El producto no tiene plantilla del motor CAD. */
  | { tipo: "sin_plantilla" }
  | { tipo: "cargando" }
  | { tipo: "listo"; resultado: ResultadoGeneracion }
  | { tipo: "fallo"; mensaje: string }
  /** La sesión no puede usar el motor (401): se usa la estimación de siempre. */
  | { tipo: "sin_acceso" };

/**
 * Pide al motor CAD el modelo 3D y el despiece real de un producto terminado,
 * por `/api/cad/generar`, como /disenos. Sin plantilla, no pide nada.
 *
 * Va separado de las vistas para que el editor muestre el visor en una columna
 * y las piezas en otra, compartiendo la pieza resaltada.
 */
export function useModeloCad(plantilla: string | null, parametros: ParametrosCad | null): EstadoModeloCad {
  const clave = plantilla && parametros ? JSON.stringify([plantilla, parametros]) : null;
  const [estado, setEstado] = useState<{ clave: string | null; valor: EstadoModeloCad }>({
    clave: null,
    valor: { tipo: "sin_plantilla" },
  });

  useEffect(() => {
    if (!clave) return;
    const control = new AbortController();
    const espera = setTimeout(async () => {
      const poner = (valor: EstadoModeloCad) => setEstado({ clave, valor });
      try {
        const [p, params] = JSON.parse(clave) as [string, ParametrosCad];
        const r = await fetch("/api/cad/generar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plantilla: p, parametros: params }),
          signal: control.signal,
        });
        if (r.status === 401) return poner({ tipo: "sin_acceso" });
        const cuerpo = await r.json().catch(() => null);
        if (!r.ok) return poner({ tipo: "fallo", mensaje: cuerpo?.error ?? "No se pudo generar el modelo." });
        poner({ tipo: "listo", resultado: cuerpo as ResultadoGeneracion });
      } catch (e) {
        if (control.signal.aborted) return;
        console.error("[terminados] modelo CAD", e);
        poner({ tipo: "fallo", mensaje: "No se pudo conectar con el motor de diseños." });
      }
    }, ESPERA_MS);
    return () => {
      clearTimeout(espera);
      control.abort();
    };
  }, [clave]);

  if (!clave) return { tipo: "sin_plantilla" };
  // Mientras llega el modelo de las medidas nuevas, se sigue mostrando el anterior.
  if (estado.clave !== clave) return estado.valor.tipo === "listo" ? estado.valor : { tipo: "cargando" };
  return estado.valor;
}

/** El visor 3D, con sus medidas y el botón para seguir el diseño en /disenos. Llena el alto que le den. */
export function VisorModeloCad({
  plantilla,
  parametros,
  resultado,
  nombre,
  color,
  piezaActiva,
  alCambiarPieza,
  className,
}: {
  plantilla: string;
  parametros: ParametrosCad;
  /** `null` mientras se genera. */
  resultado: ResultadoGeneracion | null;
  /** Para el nombre del diseño al abrirlo en /disenos. */
  nombre: string;
  color?: string | null;
  piezaActiva: string | null;
  alCambiarPieza: (id: string | null) => void;
  className?: string;
}) {
  const [abriendo, iniciarApertura] = useTransition();
  const router = useRouter();

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

  return (
    <section className={cn("flex min-h-0 flex-col gap-3", className)} aria-label="Modelo 3D del producto">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm font-medium">
          Modelo 3D
          {resultado && (
            <span className="text-muted-foreground tnum font-normal">
              {" "}
              · {Math.round(resultado.dimensiones.x)} × {Math.round(resultado.dimensiones.y)} ×{" "}
              {Math.round(resultado.dimensiones.z)} mm
            </span>
          )}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={abrirEnDisenos}
          disabled={abriendo}
          className="hover:border-primary/50 hover:bg-primary/10 hover:text-primary cursor-pointer"
        >
          {abriendo ? <LoaderCircle className="animate-spin" aria-hidden /> : <ExternalLink aria-hidden />}
          Abrir en Diseños
        </Button>
      </div>
      <div className="bg-background relative min-h-72 flex-1 overflow-hidden rounded-lg border">
        {resultado ? (
          <Visor3D
            glbBase64={resultado.glb_base64}
            dimensiones={resultado.dimensiones}
            idsPiezas={resultado.piezas.map((p) => p.id)}
            piezaActiva={piezaActiva}
            alCambiarPieza={alCambiarPieza}
            tinte={tinteDeColor(color)}
            className="h-full w-full"
          />
        ) : (
          <>
            <Skeleton className="h-full w-full rounded-none" />
            <span className="sr-only" role="status">
              Generando el modelo…
            </span>
          </>
        )}
      </div>
    </section>
  );
}

/** El despiece del motor: avisos y tabla de piezas, enlazados con el visor por la pieza resaltada. */
export function PiezasModeloCad({
  resultado,
  piezaActiva,
  alCambiarPieza,
}: {
  resultado: ResultadoGeneracion;
  piezaActiva: string | null;
  alCambiarPieza: (id: string | null) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {resultado.validaciones.length > 0 && (
        <ListaValidaciones
          validaciones={resultado.validaciones}
          piezas={resultado.piezas}
          piezaActiva={piezaActiva}
          alCambiarPieza={alCambiarPieza}
        />
      )}
      <ListaPiezas
        piezas={resultado.piezas}
        validaciones={resultado.validaciones}
        piezaActiva={piezaActiva}
        alCambiarPieza={alCambiarPieza}
      />
    </div>
  );
}
