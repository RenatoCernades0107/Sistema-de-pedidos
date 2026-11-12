import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { FondoAcrilico } from "@/components/fondo-acrilico";
import { cn } from "@/lib/utils";

/**
 * La banda azul de marca que abre un formulario largo, con las planchas de
 * acrílico del login flotando detrás. Ocupa todo el ancho del contenido (se come
 * el padding de la página) y deja un margen abajo para que la primera tarjeta
 * del formulario se monte encima.
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
    <header
      className={cn(
        "relative isolate -mx-4 -mt-5 overflow-hidden px-4 pt-4 pb-14 text-white md:-mx-6 md:-mt-6 md:px-6 md:pt-5",
        className,
      )}
    >
      <FondoAcrilico variante="banda" className="-z-10" />
      <div className="max-w-3xl">
        <Link
          href={volverA}
          className="-ml-1.5 inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
        >
          <ArrowLeft className="size-3.5" />
          {volverTexto}
        </Link>
        <div className="mt-3 flex flex-wrap items-end gap-x-6 gap-y-3">
          <div className="min-w-0">
            {eyebrow && (
              <p className="text-2xs flex items-center gap-1.5 font-medium tracking-[0.08em] text-[#ffc200] uppercase">
                {eyebrow}
              </p>
            )}
            <h1 className="text-2xl font-semibold tracking-tight text-balance">{titulo}</h1>
            {subtitulo && <p className="mt-1 text-sm text-white/75">{subtitulo}</p>}
          </div>
          {lateral && <div className="ml-auto">{lateral}</div>}
        </div>
      </div>
    </header>
  );
}
