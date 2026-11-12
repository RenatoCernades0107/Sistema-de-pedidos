"use client";

import { Download } from "lucide-react";
import { exportarDxf, nombreArchivoDxf, type PlanchaParaDxf } from "@/lib/cortes/dxf";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Descarga el corte como DXF en mm para abrirlo en RDWorks (Archivo → Importar).
 * El archivo se arma en el navegador: no hace falta ir al servidor.
 */
export function DescargarDxf({
  planchas,
  kerfCm,
  nombre,
  className,
}: {
  planchas: PlanchaParaDxf[];
  /** El grosor del corte láser de la configuración, en cm. */
  kerfCm: number;
  /** Las partes del nombre del archivo: "P-0012", "Acrílico ECO"… */
  nombre: (string | number | null | undefined)[];
  className?: string;
}) {
  const descargar = () => {
    const blob = new Blob([exportarDxf(planchas, { kerfCm })], { type: "application/dxf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nombreArchivoDxf(nombre);
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Después de que el navegador empezó la descarga.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={descargar}
      disabled={planchas.length === 0}
      className={cn("gap-1.5 print:hidden", className)}
      title="Archivo en milímetros para importar en RDWorks"
    >
      <Download className="size-3.5" />
      DXF para RDWorks
    </Button>
  );
}
