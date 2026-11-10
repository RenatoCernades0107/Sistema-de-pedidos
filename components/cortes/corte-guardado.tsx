import { Scissors } from "lucide-react";
import { MODALIDADES } from "@/lib/cortes/calcular";
import {
  fraccionEnPalabras,
  materialDeCorte,
  planchasTexto,
  totalPiezas,
  type CorteGuardado,
} from "@/lib/cortes/guardado";
import { money } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { LeyendaPlano, PlanoCorte } from "./plano-corte";

const n = (x: number) => String(+x.toFixed(2));

/**
 * Un corte ya guardado, tal como se calculó: qué piezas son, de qué planchas
 * salen y cómo van acomodadas.
 *
 * Es lo que ve Administración en la cotización y lo que ve el taller en el
 * pedido. El taller no ve dinero: `conPrecios` quita el desglose.
 */
export function CorteGuardadoVista({
  corte: c,
  conPrecios,
  className,
}: {
  corte: CorteGuardado;
  conPrecios: boolean;
  className?: string;
}) {
  const piezas = totalPiezas(c.piezas);
  const hayFraccion = c.planchas.some((p) => p.cobro.factor < 1);

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="bg-brand-soft text-foreground inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium">
          <Scissors className="size-3" />
          {MODALIDADES[c.modalidad]}
        </span>
        <span className="text-sm font-medium">{materialDeCorte(c)}</span>
        <span className="text-muted-foreground text-xs">
          {piezas} {piezas === 1 ? "pieza" : "piezas"} · {planchasTexto(c)}{" "}
          <span className="font-mono">{c.formato.codigo}</span>
        </span>
      </div>

      {/* El número de cada medida es el que lleva su pieza en el plano. */}
      <ol className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm" aria-label="Piezas del corte">
        {c.piezas.map((p, i) => (
          <li key={i} className="flex items-center gap-1.5">
            <span className="bg-primary/15 tnum grid size-5 shrink-0 place-items-center rounded-md text-xs font-semibold">
              {i + 1}
            </span>
            <span className="tnum">
              {p.cantidad} × {n(p.ancho)}×{n(p.alto)} cm
            </span>
          </li>
        ))}
      </ol>

      <div className="grid gap-3 sm:grid-cols-2">
        {c.planchas.map((p, i) => (
          <figure key={i} className="flex flex-col gap-1">
            <PlanoCorte
              plancha={p}
              titulo={`Plancha ${i + 1} de ${c.planchas.length}: ${p.piezas} piezas en ${n(p.ancho)}×${n(p.alto)} cm`}
            />
            <figcaption className="text-muted-foreground text-xs">
              Plancha {i + 1} · {p.piezas} {p.piezas === 1 ? "pieza" : "piezas"}
              {p.cobro.factor < 1 && (
                <>
                  {" "}
                  · cortar primero {fraccionEnPalabras(p.cobro.nombre)} ({n(p.cobro.ancho)}×{n(p.cobro.alto)})
                </>
              )}
            </figcaption>
          </figure>
        ))}
      </div>
      <LeyendaPlano conSobrante={hayFraccion} />

      {conPrecios && (
        <dl className="bg-muted/30 flex flex-col gap-1 rounded-lg border px-3 py-2.5 text-sm">
          {c.desglose.map((d, i) => (
            <div key={i} className={cn("flex items-baseline justify-between gap-4", d.esTotal && "border-t pt-1.5")}>
              <dt className={d.esTotal ? "font-medium" : "text-muted-foreground"}>{d.etiqueta}</dt>
              <dd className={cn("tnum shrink-0", d.esTotal && "font-semibold")}>{money(d.monto)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
