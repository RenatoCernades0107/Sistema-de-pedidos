import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Un bloque numerado de un formulario largo (nuevo pedido, nueva cotización).
 *
 * Con `completa`, el número se vuelve un check: de un vistazo se ve qué falta
 * sin tener que bajar hasta el botón de registrar.
 */
export function Seccion({
  n,
  titulo,
  nota,
  completa,
  refSeccion,
  className,
  children,
}: {
  n: number;
  titulo: string;
  nota?: React.ReactNode;
  completa?: boolean;
  refSeccion?: React.Ref<HTMLElement>;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      ref={refSeccion}
      // Sin overflow-hidden: la lista de resultados de un buscador flota fuera de
      // la sección y quedaría recortada. Las esquinas del encabezado van aparte.
      className={cn("bg-card shadow-card scroll-mt-20 rounded-xl border", className)}
    >
      <header className="from-primary/[0.07] flex items-center gap-2.5 rounded-t-xl border-b bg-gradient-to-r to-transparent px-4 py-3">
        <span
          className={cn(
            "text-2xs grid size-6 shrink-0 place-items-center rounded-full font-semibold transition-colors",
            completa ? "bg-st-entregado text-white" : "bg-primary text-primary-foreground",
          )}
        >
          {completa ? <Check className="size-3.5" strokeWidth={3} aria-label="Completa" /> : n}
        </span>
        <h2 className="text-sm font-semibold">{titulo}</h2>
        {nota && <span className="text-muted-foreground ml-auto text-xs">{nota}</span>}
      </header>
      <div className="flex flex-col gap-4 p-4">{children}</div>
    </section>
  );
}
