"use client";

/**
 * Lo propio de un diseño libre (hecho con código por el asistente) en el panel
 * de la derecha: la insignia de borrador/aprobado, el código de solo lectura,
 * el botón «Aprobar» y las descargas, con el DXF (suelto o por plancha) bloqueado
 * hasta la aprobación.
 *
 * `panel-diseno.tsx` los pinta en vez del formulario y de `Descargas` cuando la
 * plantilla vigente es `libre`.
 */

import { useState } from "react";
import { BadgeCheck, Box, Code, Download, LayoutGrid, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { aprobarDisenoLibre } from "@/app/(app)/disenos/acciones";
import { aPlanchasMotor } from "@/lib/cad/acomodo";
import { PLANTILLA_LIBRE, type ResultadoGeneracion, type VersionLibreCad } from "@/lib/cad/tipos";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDiseno } from "./diseno-contexto";

/** El resultado de `/api/cad/libre` trae, además, la versión libre. */
export function versionLibre(resultado: ResultadoGeneracion | null): VersionLibreCad | null {
  const libre = (resultado as (ResultadoGeneracion & { libre?: VersionLibreCad }) | null)?.libre;
  return libre && typeof libre.codigo === "string" ? libre : null;
}

/** Si el diseño vigente es libre. */
export function useEsLibre(): boolean {
  return useDiseno().plantilla === PLANTILLA_LIBRE;
}

export function InsigniaLibre() {
  const { resultado } = useDiseno();
  const libre = versionLibre(resultado);
  const aprobado = libre?.estado === "aprobado";
  return (
    <Badge variant={aprobado ? "secondary" : "outline"} className={aprobado ? "" : "border-st-observado text-st-observado"}>
      {aprobado ? "Diseño personalizado — aprobado" : "Diseño personalizado — borrador"}
    </Badge>
  );
}

/** El contenido de la pestaña de parámetros para un diseño libre. */
export function DisenoLibre() {
  const { resultado, disenoId, aplicar, cargando } = useDiseno();
  const [aprobando, setAprobando] = useState(false);
  const libre = versionLibre(resultado);

  if (!libre) {
    return <p className="text-muted-foreground text-sm">{cargando ? "Cargando el diseño personalizado…" : "No se pudo cargar el diseño personalizado."}</p>;
  }

  async function aprobar() {
    if (!libre) return;
    setAprobando(true);
    try {
      await aprobarDisenoLibre(disenoId, libre.version);
      toast.success("Diseño aprobado: ya se puede bajar el DXF.");
      await aplicar(PLANTILLA_LIBRE, {}, { guardar: false });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo aprobar el diseño.");
    } finally {
      setAprobando(false);
    }
  }

  const errores = resultado?.validaciones.filter((v) => v.nivel === "error").length ?? 0;

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <InsigniaLibre />
        <span className="text-muted-foreground text-xs">Versión {libre.version}</span>
      </div>
      <p className="text-muted-foreground">
        Este diseño no sale de una plantilla: lo escribió el asistente con código. No tiene parámetros que editar; para
        cambiarlo, pídeselo en el chat.
        {libre.estado === "borrador" &&
          " Antes de mandarlo a producción, Administración tiene que revisarlo y aprobarlo."}
      </p>
      {libre.estado === "borrador" && (
        <Button size="sm" className="gap-1.5" onClick={() => void aprobar()} disabled={aprobando || cargando || errores > 0}>
          {aprobando ? <Loader2 className="animate-spin" /> : <BadgeCheck />}
          Aprobar
        </Button>
      )}
      {libre.estado === "borrador" && errores > 0 && (
        <p className="text-destructive text-xs">Tiene errores de validación: corrígelos antes de aprobar.</p>
      )}
      <details className="rounded-md border">
        <summary className="flex cursor-pointer items-center gap-1.5 px-3 py-2 text-xs font-medium">
          <Code className="size-3.5" />
          Ver código
        </summary>
        <pre className="bg-muted/40 max-h-96 overflow-auto border-t p-3 font-mono text-xs leading-relaxed whitespace-pre">
          {libre.codigo}
        </pre>
      </details>
    </div>
  );
}

function guardar(blob: Blob, nombre: string) {
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombre;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Las descargas de un diseño libre: STEP siempre; DXF y DXF por plancha solo aprobado y sin errores. */
export function DescargasLibre() {
  const { resultado, cargando, disenoId, corte, acomodo, problemasMaterial } = useDiseno();
  const [bajando, setBajando] = useState<"dxf" | "step" | "dxf-planchas" | null>(null);
  const libre = versionLibre(resultado);
  if (!resultado || !libre) return null;

  const errores = resultado.validaciones.filter((v) => v.nivel === "error").length;
  const sinAprobar = libre.estado !== "aprobado";
  // El DXF por plancha necesita un material elegido en el que entre todo.
  const sinPlanchas = !acomodo || acomodo.noCaben.length > 0 || problemasMaterial.length > 0;

  async function descargar(formato: "dxf" | "step" | "dxf-planchas") {
    if (bajando) return;
    setBajando(formato);
    try {
      // El código no viaja: el servidor lo lee de la versión vigente.
      const res =
        formato === "dxf-planchas"
          ? await fetch("/api/cad/dxf-planchas", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                disenoId,
                planchas: acomodo ? aPlanchasMotor(acomodo) : [],
                opciones: { kerf_mm: corte.kerfMm },
              }),
            })
          : await fetch("/api/cad/libre/descarga", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                disenoId,
                formato,
                ...(formato === "dxf" ? { opciones: { kerf_mm: corte.kerfMm } } : {}),
              }),
            });
      if (!res.ok) {
        const cuerpo = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(cuerpo.error ?? "No se pudo generar el archivo.");
        return;
      }
      const base = `diseno-personalizado-v${libre?.version ?? ""}`;
      guardar(await res.blob(), formato === "dxf-planchas" ? `${base}-planchas.dxf` : `${base}.${formato}`);
    } catch {
      toast.error("No se pudo descargar el archivo. Revisa tu conexión.");
    } finally {
      setBajando(null);
    }
  }

  const ocupado = cargando || bajando !== null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      {(sinAprobar || errores > 0) && (
        <p className="text-muted-foreground text-xs" role="status">
          {errores > 0 ? "Corrige los errores antes de producción." : "DXF disponible al aprobarlo."}
        </p>
      )}
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => descargar("step")} disabled={ocupado}>
        {bajando === "step" ? <Loader2 className="animate-spin" /> : <Box />}
        STEP
      </Button>
      <Button
        size="sm"
        className="gap-1.5"
        onClick={() => descargar("dxf")}
        disabled={ocupado || sinAprobar || errores > 0}
        title={sinAprobar ? "Un diseño personalizado necesita aprobación antes de producción" : "El despiece para la cortadora"}
      >
        {bajando === "dxf" ? <Loader2 className="animate-spin" /> : <Download />}
        DXF
      </Button>
      {acomodo && (
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => descargar("dxf-planchas")}
          disabled={ocupado || sinAprobar || errores > 0 || sinPlanchas}
          title={
            sinAprobar
              ? "Un diseño personalizado necesita aprobación antes de producción"
              : sinPlanchas
                ? "Revisa la pestaña Planchas: el diseño no entra en el material elegido"
                : "Las piezas acomodadas en cada plancha, con su contorno"
          }
        >
          {bajando === "dxf-planchas" ? <Loader2 className="animate-spin" /> : <LayoutGrid />}
          DXF por plancha
        </Button>
      )}
    </div>
  );
}
