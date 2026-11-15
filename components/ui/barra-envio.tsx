import { CircleAlert, Loader2 } from "lucide-react";
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
        "bg-card sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 -mx-4 mt-6 border-t px-4 py-3 md:bottom-0 md:-mx-6 md:px-6",
        "shadow-[0_-6px_16px_-12px_oklch(0_0_0/0.18)]",
        className,
      )}
    >
      <div className="flex max-w-3xl items-center gap-x-5 gap-y-2">
        <dl className="flex min-w-0 flex-1 flex-wrap items-end gap-x-5 gap-y-1">
          {resumen.map((r, i) => {
            const ultimo = i === resumen.length - 1;
            return (
              <div key={r.etiqueta} className="min-w-0">
                <dt className="eyebrow">{r.etiqueta}</dt>
                <dd
                  className={cn("tnum leading-tight font-semibold", ultimo ? "text-lg" : "text-sm")}
                  aria-live={ultimo ? "polite" : undefined}
                  data-testid={r.testId}
                >
                  {r.valor}
                </dd>
              </div>
            );
          })}
          {problema && (
            <p className="flex basis-full items-center gap-1.5 text-muted-foreground truncate text-xs" role="status">
              <CircleAlert className="size-3.5 shrink-0" />
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
          className="h-10 shrink-0 px-4 font-semibold"
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
