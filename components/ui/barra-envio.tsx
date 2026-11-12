import { CircleAlert, Loader2 } from "lucide-react";
import { FondoAcrilico } from "@/components/fondo-acrilico";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * La barra de abajo de un formulario largo: el resumen de montos y el botón de
 * registrar, siempre a la vista mientras se baja. En el celular va encima de
 * las pestañas.
 *
 * Si falta algo, el botón sigue activo (al pulsarlo, el formulario lleva al
 * campo que falta) pero la barra ya dice qué es.
 */
export function BarraEnvio({
  resumen,
  problema,
  texto,
  textoPendiente,
  pendiente,
  form,
  onClick,
  className,
}: {
  /** Los montos: pares de etiqueta y valor; el último se destaca. */
  resumen: { etiqueta: string; valor: string; testId?: string }[];
  problema?: string | null;
  texto: string;
  textoPendiente: string;
  pendiente: boolean;
  /** El id del `<form>` que envía, si la barra queda fuera de él. */
  form?: string;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] isolate z-20 -mx-4 mt-6 overflow-hidden px-4 py-3 text-white md:bottom-0 md:-mx-6 md:px-6",
        "shadow-[0_-8px_24px_-12px_oklch(0.25_0.09_253/0.45)]",
        className,
      )}
    >
      <FondoAcrilico variante="banda" className="-z-10" />
      <div className="flex max-w-3xl items-center gap-x-5 gap-y-2">
        <dl className="flex min-w-0 flex-1 flex-wrap items-end gap-x-5 gap-y-1">
          {resumen.map((r, i) => {
            const ultimo = i === resumen.length - 1;
            return (
              <div key={r.etiqueta} className="min-w-0">
                <dt className="text-2xs font-medium tracking-[0.06em] text-white/65 uppercase">{r.etiqueta}</dt>
                <dd
                  className={cn("tnum leading-tight font-semibold", ultimo ? "text-lg text-[#ffc200]" : "text-sm")}
                  aria-live={ultimo ? "polite" : undefined}
                  data-testid={r.testId}
                >
                  {r.valor}
                </dd>
              </div>
            );
          })}
          {problema && (
            <p className="flex basis-full items-center gap-1.5 truncate text-xs text-white/85" role="status">
              <CircleAlert className="size-3.5 shrink-0 text-[#ffc200]" />
              {problema}
            </p>
          )}
        </dl>
        <Button
          type={form ? "submit" : "button"}
          form={form}
          size="lg"
          onClick={onClick}
          disabled={pendiente}
          className={cn(
            "h-10 shrink-0 bg-[#ffc200] px-4 font-semibold text-[#3b2a00] hover:bg-[#ffcf33]",
            "focus-visible:ring-white/60",
          )}
        >
          {pendiente ? (
            <>
              <Loader2 className="animate-spin" />
              {textoPendiente}
            </>
          ) : (
            texto
          )}
        </Button>
      </div>
    </div>
  );
}
