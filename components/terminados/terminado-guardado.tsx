import { Package } from "lucide-react";
import { money } from "@/lib/formato";
import {
  cantidadDeMaterial,
  renglonesDeTerminado,
  type MaterialUsado,
  type TerminadoGuardado,
} from "@/lib/terminados/guardado";

const n = (x: number) => String(+x.toFixed(3));

/**
 * La ficha de un producto terminado ya guardado: qué es, cómo se pidió y qué
 * material se estimó. Es lo que lee el taller para fabricarlo; con `conPrecios`,
 * también lo que ve Administración: el precio sugerido junto al cobrado.
 */
export function TerminadoGuardadoVista({
  terminado: t,
  cantidad,
  importe = null,
  usados = null,
  conPrecios,
}: {
  terminado: TerminadoGuardado;
  cantidad: number;
  importe?: number | null;
  /** Lo que logística anotó que se usó de verdad. */
  usados?: MaterialUsado[] | null;
  conPrecios: boolean;
}) {
  const renglones = renglonesDeTerminado(t);
  return (
    <div className="flex flex-col gap-2.5" data-testid="linea-terminado">
      <div className="flex items-start gap-3">
        <Package className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
            <span className="tnum">{n(cantidad)} ×</span>
            {t.productoCodigo && (
              <span className="bg-muted/60 rounded border px-1.5 py-px font-mono text-xs font-normal">
                {t.productoCodigo}
              </span>
            )}
            <span>{t.nombre}</span>
            <span className="bg-brand-soft rounded-md px-1.5 py-0.5 text-xs">
              {t.estandar ? (t.tipoNombre ?? "Producto terminado") : "Personalizado"}
            </span>
          </p>
        </div>
        {conPrecios && importe !== null && (
          <div className="shrink-0 text-right">
            <p className="tnum text-sm font-medium">{money(importe)}</p>
            <p className="text-muted-foreground tnum text-xs">
              {money(t.precioUnitario)} c/u
              {t.precioUnitario !== t.precioSugerido && ` · sugerido ${money(t.precioSugerido)}`}
            </p>
          </div>
        )}
      </div>

      {renglones.length > 0 && (
        <dl className="grid gap-x-4 gap-y-1 pl-7 text-sm sm:grid-cols-[auto_1fr]">
          {renglones.map((r) => (
            <div key={r.etiqueta} className="contents">
              <dt className="text-muted-foreground">{r.etiqueta}</dt>
              <dd className="whitespace-pre-line">{r.valor}</dd>
            </div>
          ))}
        </dl>
      )}

      {(t.materiales.length > 0 || usados) && (
        <div className="bg-muted/30 ml-7 rounded-lg border px-3 py-2 text-sm">
          <p className="text-xs font-medium">
            {usados ? "Material usado" : "Material estimado"}
            {!usados && t.reservar && <span className="text-muted-foreground font-normal"> · se reserva al confirmar</span>}
          </p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {(usados ?? t.materiales).map((m) => (
              <li key={m.productoId} className="flex flex-wrap items-baseline gap-x-2">
                {m.codigo && <span className="font-mono text-xs">{m.codigo}</span>}
                <span className="min-w-0 flex-1">{m.nombre}</span>
                <span className="tnum">{cantidadDeMaterial(m)}</span>
              </li>
            ))}
            {usados?.length === 0 && <li className="text-muted-foreground">Nada del almacén.</li>}
          </ul>
          {usados && t.materiales.length > 0 && (
            <p className="text-muted-foreground mt-1 text-xs">
              Estimado: {t.materiales.map((m) => `${cantidadDeMaterial(m)} de ${m.codigo ?? m.nombre}`).join(", ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
