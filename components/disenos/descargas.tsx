"use client";

import { useState } from "react";
import { Box, Download, LayoutGrid, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { nombreArchivo } from "@/lib/cad/esquema";
import { Button } from "@/components/ui/button";
import { useDiseno } from "./diseno-contexto";
import { bajarDxfPlanchas, guardarArchivo as guardar } from "./dxf-planchas";

type Formato = "dxf" | "step" | "dxf-planchas";

/**
 * Las descargas del diseño vigente: el DXF del despiece para la cortadora y el
 * STEP del conjunto armado.
 *
 * Con algún `error` de validación el DXF no se ofrece: es el archivo que va a
 * producción, y el contrato del motor dice que así no se exporta. El STEP sí,
 * porque sirve para revisar el modelo, no para cortar.
 */
export function Descargas() {
  const { resultado, cargando, gruposPlanchas, problemasMaterial, corte, disenoId } = useDiseno();
  const [bajando, setBajando] = useState<Formato | null>(null);

  if (!resultado) return null;

  const errores = resultado.validaciones.filter((v) => v.nivel === "error").length;
  const bloqueado = errores > 0;

  async function descargar(formato: Formato) {
    if (!resultado || bajando) return;
    setBajando(formato);
    if (formato === "dxf-planchas") {
      const nombre = nombreArchivo(resultado.plantilla, resultado.dimensiones, "dxf").replace(/\.dxf$/, "-planchas.dxf");
      await bajarDxfPlanchas({ resultado, disenoId, grupos: gruposPlanchas, kerfMm: corte.kerfMm, nombre });
      setBajando(null);
      return;
    }
    try {
      const res = await fetch(`/api/cad/${formato}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plantilla: resultado.plantilla,
          parametros: resultado.parametros,
        }),
      });
      if (!res.ok) {
        const cuerpo = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(cuerpo.error ?? "No se pudo generar el archivo.");
        return;
      }
      guardar(await res.blob(), nombreArchivo(resultado.plantilla, resultado.dimensiones, formato));
    } catch {
      toast.error("No se pudo descargar el archivo. Revisa tu conexión.");
    } finally {
      setBajando(null);
    }
  }

  // El DXF por plancha necesita materiales elegidos en los que entre todo.
  const sinPlanchas =
    gruposPlanchas.length === 0 ||
    gruposPlanchas.some((g) => !g.acomodo || g.acomodo.noCaben.length > 0) ||
    problemasMaterial.length > 0;

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
      {gruposPlanchas.length > 0 && (
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
