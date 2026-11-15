import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * La cabecera de un formulario largo: el enlace para volver, el título y, a la
 * derecha, un dato de apoyo. Sobria, igual que la de las listas: el color se
 * queda en los botones.
 */
export function CabeceraFormulario({
  volverA,
  volverTexto,
  eyebrow,
  titulo,
  subtitulo,
  lateral,
  className,
}: {
  volverA: string;
  volverTexto: string;
  eyebrow?: React.ReactNode;
  titulo: string;
  subtitulo?: React.ReactNode;
  /** Lo que va a la derecha del título: el código que se generará, un atajo… */
  lateral?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("max-w-3xl pb-5", className)}>
      <Link
        href={volverA}
        className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring/50 -ml-1.5 inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        <ArrowLeft className="size-3.5" />
        {volverTexto}
      </Link>
      <div className="mt-2 flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="min-w-0">
          {eyebrow && <p className="eyebrow flex items-center gap-1.5">{eyebrow}</p>}
          <h1 className="text-xl font-semibold tracking-tight text-balance">{titulo}</h1>
          {subtitulo && <p className="text-muted-foreground mt-0.5 text-sm">{subtitulo}</p>}
        </div>
        {lateral && <div className="ml-auto">{lateral}</div>}
      </div>
    </header>
  );
}
