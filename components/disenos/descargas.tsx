"use client";

import { useState } from "react";
import { Box, Download, LayoutGrid, Loader2 } from "lucide-react";
import { aPlanchasMotor } from "@/lib/cad/acomodo";
import { toast } from "sonner";
import { nombreArchivo } from "@/lib/cad/esquema";
import { Button } from "@/components/ui/button";
import { useDiseno } from "./diseno-contexto";

type Formato = "dxf" | "step" | "dxf-planchas";

/** Hace que el navegador guarde unos bytes como si se hubiera pulsado un enlace de descarga. */
function guardar(blob: Blob, nombre: string) {
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombre;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  // En el siguiente ciclo: Safari cancela la descarga si la URL se revoca antes.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Las descargas del diseño vigente: el DXF del despiece para la cortadora y el
 * STEP del conjunto armado.
 *
 * Con algún `error` de validación el DXF no se ofrece: es el archivo que va a
 * producción, y el contrato del motor dice que así no se exporta. El STEP sí,
 * porque sirve para revisar el modelo, no para cortar.
 */
export function Descargas() {
  const { resultado, cargando, acomodo, problemasMaterial, corte } = useDiseno();
  const [bajando, setBajando] = useState<Formato | null>(null);

  if (!resultado) return null;

  const errores = resultado.validaciones.filter((v) => v.nivel === "error").length;
  const bloqueado = errores > 0;

  async function descargar(formato: Formato) {
    if (!resultado || bajando) return;
    setBajando(formato);
    try {
      const res = await fetch(`/api/cad/${formato}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plantilla: resultado.plantilla,
          parametros: resultado.parametros,
          ...(formato === "dxf-planchas" && acomodo
            ? { planchas: aPlanchasMotor(acomodo), opciones: { kerf_mm: corte.kerfMm } }
            : {}),
        }),
      });
      if (!res.ok) {
        const cuerpo = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(cuerpo.error ?? "No se pudo generar el archivo.");
        return;
      }
      const nombre = nombreArchivo(resultado.plantilla, resultado.dimensiones, "dxf");
      guardar(
        await res.blob(),
        formato === "dxf-planchas"
          ? nombre.replace(/\.dxf$/, "-planchas.dxf")
          : nombreArchivo(resultado.plantilla, resultado.dimensiones, formato),
      );
    } catch {
      toast.error("No se pudo descargar el archivo. Revisa tu conexión.");
    } finally {
      setBajando(null);
    }
  }

  // El DXF por plancha necesita un material elegido en el que entre todo.
  const sinPlanchas = !acomodo || acomodo.noCaben.length > 0 || problemasMaterial.length > 0;

  // Mientras se regenera, lo que hay en pantalla ya no es lo que se bajaría.
  const ocupado = cargando || bajando !== null;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      {bloqueado && (
        <p className="text-destructive text-xs" role="status">
          {errores === 1 ? "Hay 1 error" : `Hay ${errores} errores`}: corrígelo antes de mandar a
          producción.
        </p>
      )}
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => descargar("step")}
        disabled={ocupado}
        title="El conjunto armado, para abrirlo en otro programa de CAD"
      >
        {bajando === "step" ? <Loader2 className="animate-spin" /> : <Box />}
        STEP
      </Button>
      <Button
        size="sm"
        className="gap-1.5"
        onClick={() => descargar("dxf")}
        disabled={ocupado || bloqueado}
        title={
          bloqueado
            ? "El diseño tiene errores: no se puede exportar a producción"
            : "El despiece acostado, en mm, para la cortadora"
        }
      >
        {bajando === "dxf" ? <Loader2 className="animate-spin" /> : <Download />}
        DXF de corte
      </Button>
      {acomodo && (
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => descargar("dxf-planchas")}
          disabled={ocupado || bloqueado || sinPlanchas}
          title={
            sinPlanchas
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
