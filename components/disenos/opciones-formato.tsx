"use client";

/**
 * El formato de plancha de un grupo del diseño: la sugerencia del sistema (según
 * la política de Configuración) u otro formato del catálogo. Cada opción enseña
 * cuántas planchas lleva, cuánto se desperdicia, lo que cuesta (solo con precios,
 * es decir, para Administración) y el stock de Odoo.
 *
 * Es la misma elección del corte a medida y del producto terminado del
 * catálogo (`components/cortes/opciones-plancha.tsx`), pero sobre el acomodo real
 * de las piezas del diseño.
 */

import { useMemo } from "react";
import { Sparkles } from "lucide-react";
import { costoDiseno } from "@/lib/cad/costo";
import type { PlanchasDeGrupo } from "@/lib/cad/materiales";
import { money } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { claseTarjeta, desperdicioTexto, LineaStock, useStock } from "@/components/cortes/opciones-plancha";
import { useDiseno } from "./diseno-contexto";

const n = (x: number, d = 0) => x.toLocaleString("es-PE", { maximumFractionDigits: d });

export function OpcionesFormato({ grupo: g }: { grupo: PlanchasDeGrupo }) {
  const { costos, formatosElegidos, elegirFormato, cargando } = useDiseno();
  const codigoDe = useMemo(() => new Map(g.grupo.formatos.map((f) => [f.id, f.codigo])), [g.grupo]);
  const stock = useStock(g.alternativas.map((r) => codigoDe.get(r.formatoId) ?? "").filter(Boolean));

  if (g.alternativas.length < 2 || !g.acomodo) return null;
  // La sugerida es la primera de la lista, la elija o no quien arma el diseño.
  const sugerida = g.alternativas[0].formatoId;
  const actual = g.acomodo.formatoId;
  const aMano = formatosElegidos[g.clave];

  return (
    <div className="flex flex-col gap-2" data-testid="opciones-formato">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <p className="text-xs font-medium">Formato de plancha</p>
        <p className="text-muted-foreground text-xs" aria-live="polite">
          {stock.validando
            ? "Validando el stock en Odoo…"
            : stock.fallo
              ? "No se pudo validar el stock en Odoo. Puedes elegir igual."
              : "Elige la sugerencia u otro formato según el stock y el desperdicio."}
        </p>
      </div>
      <ul className="grid gap-2 sm:grid-cols-3" aria-label="Formatos de plancha">
        {g.alternativas.map((r) => {
          const codigo = codigoDe.get(r.formatoId) ?? "";
          const esSugerida = r.formatoId === sugerida;
          const elegido = r.formatoId === actual;
          const sirve = r.noCaben.length === 0;
          const costo = costos
            ? costoDiseno({ piezas: g.piezas, grupo: g.grupo, acomodo: r, precios: costos.precios, config: costos.config })
            : null;
          const necesita = Math.ceil(r.planchas.length);
          const hay = stock.stock ? (stock.stock[codigo] ?? null) : stock.validando ? undefined : null;
          return (
            <li key={r.formatoId}>
              <button
                type="button"
                aria-pressed={elegido}
                disabled={cargando || !sirve}
                // Elegir la sugerida es no fijar ningún formato: sigue a las piezas.
                onClick={() => elegirFormato(g.clave, esSugerida ? null : r.formatoId)}
                className={cn(claseTarjeta(elegido, !sirve))}
                data-testid={esSugerida ? "opcion-sugerida" : "opcion-formato"}
              >
                {esSugerida && (
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <Sparkles className="text-primary size-3.5" />
                    Sugerida
                  </span>
                )}
                <span className="flex items-baseline justify-between gap-2">
                  <span className="tnum text-sm font-medium">
                    {n(r.anchoMm / 10, 1)}×{n(r.altoMm / 10, 1)}
                  </span>
                  <span className="text-muted-foreground font-mono text-2xs">{codigo}</span>
                </span>
                {sirve ? (
                  <>
                    {costo && <span className="tnum text-base font-semibold">{money(costo.material)}</span>}
                    <span className="text-muted-foreground text-xs">
                      {necesita} {necesita === 1 ? "plancha" : "planchas"} · {desperdicioTexto(r.mermaPct)}
                    </span>
                  </>
                ) : (
                  <span className="text-destructive text-xs">
                    {r.noCaben.length === 1 ? "1 pieza no entra" : `${r.noCaben.length} piezas no entran`}
                  </span>
                )}
                {sirve && <LineaStock hay={hay} necesita={necesita} />}
              </button>
            </li>
          );
        })}
      </ul>
      {aMano && aMano !== sugerida && !g.formatoElegido && (
        <p className="text-muted-foreground text-xs" role="status">
          El formato que elegiste ya no sirve para estas piezas: se usa la sugerencia.
        </p>
      )}
    </div>
  );
}
