import { Scissors } from "lucide-react";
import { fraccionEnPalabras } from "@/lib/cortes/guardado";
import type { PiezaDeTerminado } from "@/lib/terminados/piezas";
import { cn } from "@/lib/utils";
import { LeyendaPlano, PlanoCorte, type PlanchaDibujable } from "@/components/cortes/plano-corte";

const n = (x: number) => String(+x.toFixed(2));

/** "2 planchas completas y media plancha", "un cuarto de plancha". */
export function planchasDeTerminadoTexto(planchas: Pick<PlanchaDibujable, "cobro">[]): string {
  const completas = planchas.filter((p) => p.cobro.factor >= 1).length;
  const partes = planchas.filter((p) => p.cobro.factor < 1).map((p) => fraccionEnPalabras(p.cobro.nombre));
  const lista = [
    completas ? `${completas} ${completas === 1 ? "plancha completa" : "planchas completas"}` : null,
    ...partes,
  ].filter((x): x is string => !!x);
  return lista.length > 1 ? `${lista.slice(0, -1).join(", ")} y ${lista.at(-1)}` : (lista[0] ?? "");
}

/**
 * Las piezas que se cortan para un producto terminado y cómo van en la plancha.
 * La usan el editor (con el cálculo en vivo) y la ficha guardada.
 */
export function CortesTerminado({
  piezas,
  formato,
  planchas,
  className,
  compacto = false,
}: {
  piezas: PiezaDeTerminado[];
  formato: { codigo: string; ancho: number; alto: number };
  planchas: (PlanchaDibujable & { piezas: number })[];
  className?: string;
  /** Planos pequeños, de a tres por fila: para el editor. */
  compacto?: boolean;
}) {
  const total = piezas.reduce((s, p) => s + p.cantidad, 0);
  const hayFraccion = planchas.some((p) => p.cobro.factor < 1);

  return (
    <div className={cn("flex flex-col gap-3", className)} data-testid="cortes-terminado">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <Scissors className="text-muted-foreground size-3.5" aria-hidden />
        <span className="font-medium">
          {total} {total === 1 ? "pieza" : "piezas"}
        </span>
        <span className="text-muted-foreground">
          en {planchasDeTerminadoTexto(planchas)} de {n(formato.ancho)}×{n(formato.alto)} cm{" "}
          <span className="font-mono">{formato.codigo}</span>
        </span>
      </p>

      {/* El número de cada fila es el que lleva su pieza en el plano. */}
      <ol className="flex flex-col gap-1 text-sm" aria-label="Piezas del producto">
        {piezas.map((p, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="bg-primary/15 tnum grid size-5 shrink-0 place-items-center rounded-md text-xs font-semibold">
              {i + 1}
            </span>
            <span className="min-w-0 flex-1">{p.nombre}</span>
            <span className="tnum">
              {p.cantidad} × {n(p.ancho)}×{n(p.alto)} cm
            </span>
          </li>
        ))}
      </ol>

      <div className={cn("grid gap-3", compacto ? "grid-cols-2 sm:grid-cols-3" : "sm:grid-cols-2")}>
        {planchas.map((p, i) => (
          <figure key={i} className="flex flex-col gap-1">
            <PlanoCorte
              plancha={p}
              compacto={compacto}
              titulo={`Plancha ${i + 1} de ${planchas.length}: ${p.piezas} piezas en ${n(p.ancho)}×${n(p.alto)} cm`}
            />
            <figcaption className="text-muted-foreground text-xs">
              Plancha {i + 1} · {p.piezas} {p.piezas === 1 ? "pieza" : "piezas"}
              {p.cobro.factor < 1 && ` · ${fraccionEnPalabras(p.cobro.nombre)} (${n(p.cobro.ancho)}×${n(p.cobro.alto)})`}
            </figcaption>
          </figure>
        ))}
      </div>
      <LeyendaPlano conSobrante={hayFraccion} />
    </div>
  );
}
