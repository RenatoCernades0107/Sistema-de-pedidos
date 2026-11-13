"use client";

import { useState } from "react";
import { LayoutGrid, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { ReferenciaDiseno } from "@/lib/cad/referencia";
import { Button } from "@/components/ui/button";

/**
 * El DXF por plancha del motor CAD para una línea que viene de un diseño: las
 * piezas reales (no sus rectángulos) en las planchas que se guardaron con esa
 * versión. Lo usa la hoja de corte del pedido.
 */
export function DescargarDxfDiseno({ referencia, nombre }: { referencia: ReferenciaDiseno; nombre: string }) {
  const [bajando, setBajando] = useState(false);

  async function descargar() {
    setBajando(true);
    try {
      const res = await fetch("/api/cad/dxf-diseno", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(referencia),
      });
      if (!res.ok) {
        const cuerpo = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(cuerpo.error ?? "No se pudo generar el DXF del diseño.");
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      const enlace = document.createElement("a");
      enlace.href = url;
      enlace.download = `${nombre.replace(/[^\p{L}\p{N}._-]+/gu, "-")}-v${referencia.version}.dxf`;
      document.body.appendChild(enlace);
      enlace.click();
      enlace.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      toast.error("No se pudo descargar el DXF. Revisa tu conexión.");
    } finally {
      setBajando(false);
    }
  }

  return (
    <Button
      size="sm"
      variant="outline"
      className="gap-1.5 print:hidden"
      onClick={descargar}
      disabled={bajando}
      title="Las piezas del diseño CAD acomodadas en cada plancha, con su contorno real"
    >
      {bajando ? <Loader2 className="animate-spin" /> : <LayoutGrid />}
      DXF del diseño (v{referencia.version})
    </Button>
  );
}
