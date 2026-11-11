"use client";

import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";
import { fechaCompleta } from "@/lib/formato";
import { diaEnLima } from "@/lib/fecha";
import { medidaSobrante, type Sobrante } from "@/lib/sobrantes";
import { Button } from "@/components/ui/button";

/**
 * La etiqueta de 80 × 50 mm: el QR a la izquierda y, a la derecha, lo que se lee
 * sin escanear —el código, la medida y el material—. Al imprimir sale sola, del
 * tamaño de la etiqueta y sin márgenes.
 */
export function EtiquetaSobrante({ sobrante: s, qr }: { sobrante: Sobrante; qr: string }) {
  return (
    <div className="px-4 py-5 md:px-6 md:py-6 print:p-0">
      {/* Solo esta página: la etiqueta manda el tamaño del papel. */}
      <style>{`@media print { @page { size: 80mm 50mm; margin: 0; } }`}</style>

      <div className="mb-4 flex items-center gap-2 print:hidden">
        <Button
          render={<Link href="/sobrantes" />}
          nativeButton={false}
          variant="ghost"
          size="sm"
          className="text-muted-foreground -ml-2 gap-1.5"
        >
          <ArrowLeft className="size-3.5" />
          Volver a los sobrantes
        </Button>
        <Button onClick={() => window.print()} size="sm" className="ml-auto gap-1.5">
          <Printer className="size-3.5" />
          Imprimir
        </Button>
      </div>

      <p className="text-muted-foreground mb-3 text-sm print:hidden">
        Etiqueta de 80 × 50 mm. Al imprimir, elige ese tamaño de papel o la impresora de etiquetas.
      </p>

      <article
        aria-label={`Etiqueta de ${s.codigo}`}
        className="flex h-[50mm] w-[80mm] items-center gap-[3mm] overflow-hidden rounded-md border bg-white p-[3mm] text-black print:rounded-none print:border-0"
      >
        <div
          role="img"
          aria-label={`Código QR de ${s.codigo}`}
          className="size-[34mm] shrink-0 [&_svg]:size-full"
          dangerouslySetInnerHTML={{ __html: qr }}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-[1.5mm] leading-tight">
          <p className="font-mono text-[13pt] font-bold">{s.codigo}</p>
          <p className="text-[15pt] font-bold tabular-nums">{medidaSobrante(s)} cm</p>
          <p className="line-clamp-3 text-[8pt]">{s.material}</p>
          <p className="text-[7pt]">
            {s.estandar ? "Estándar · " : ""}
            {fechaCompleta(diaEnLima(s.creadoEn))}
          </p>
        </div>
      </article>
    </div>
  );
}
