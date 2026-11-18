"use client";

/**
 * De qué sale un corte: la sugerencia del sistema, un formato de plancha nueva
 * o un sobrante del almacén. Cada opción enseña lo que cuesta, cuánto se
 * desperdicia y cuánto hay, para que quien arma el corte decida con eso.
 *
 * Lo usan el corte a medida y el producto terminado.
 */

import { useEffect, useState } from "react";
import { Check, CircleAlert, Loader2, Sparkles } from "lucide-react";
import type { RespuestaStock } from "@/app/api/cortes/stock/route";
import {
  desperdicioFisicoPct,
  mismaEleccion,
  piezasEnSobrante,
  type CalculoCorte,
  type EleccionPlancha,
} from "@/lib/cortes/calcular";
import { planchasNuevas } from "@/lib/cortes/guardado";
import { money } from "@/lib/formato";
import { cn } from "@/lib/utils";

/* ── Stock ─────────────────────────────────────────────────────────────────── */

type Stock = Record<string, number | null>;
type PorAlmacen = RespuestaStock["porAlmacen"];

/**
 * El stock de unos formatos, en una sola consulta a Odoo. Espera a que se deje
 * de escribir: mientras cambian las piezas cambian los formatos que sirven, y no
 * tiene sentido preguntar por cada tecla.
 */
export function useStock(codigos: string[]) {
  const clave = [...new Set(codigos)].sort().join(",");
  const [estado, setEstado] = useState<{
    clave: string;
    stock: Stock | null;
    porAlmacen: PorAlmacen;
    error: boolean;
  } | null>(null);

  useEffect(() => {
    if (!clave) return;
    const ctrl = new AbortController();
    const temporizador = setTimeout(async () => {
      try {
        const res = await fetch(`/api/cortes/stock?codigos=${encodeURIComponent(clave)}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error();
        const json = (await res.json()) as RespuestaStock;
        setEstado({ clave, stock: json.stock, porAlmacen: json.porAlmacen ?? {}, error: false });
      } catch {
        if (!ctrl.signal.aborted) setEstado({ clave, stock: null, porAlmacen: {}, error: true });
      }
    }, 350);
    return () => {
      clearTimeout(temporizador);
      ctrl.abort();
    };
  }, [clave]);

  const alDia = estado?.clave === clave;
  return {
    /** `null` mientras Odoo no contesta por estos formatos. */
    stock: alDia ? estado.stock : null,
    /** Por código, lo que hay en cada almacén (por su nombre). */
    porAlmacen: alDia ? estado.porAlmacen : {},
    validando: !!clave && !alDia,
    fallo: alDia && estado.error,
  };
}

/* ── Las opciones ──────────────────────────────────────────────────────────── */

export interface OpcionSobrante {
  codigo: string;
  /** cm, como se guarda el sobrante. */
  largo: number;
  ancho: number;
  /** El corte con este sobrante primero. `null`: todavía no hay piezas. */
  calculo: CalculoCorte | null;
}

export function OpcionesPlancha({
  formatos,
  sobrantes,
  almacenSobrantes,
  sugerido,
  eleccion,
  alElegir,
  stock,
  porAlmacen,
  validando,
  falloStock,
  importe = "total",
}: {
  /** Todos los formatos del material, ya calculados. */
  formatos: CalculoCorte[];
  sobrantes: OpcionSobrante[];
  /** Dónde están los sobrantes: "taller", "tienda". */
  almacenSobrantes: string;
  /** En qué queda la sugerencia del sistema; `null` si no hay ninguna que sirva. */
  sugerido: CalculoCorte | null;
  eleccion: EleccionPlancha | null;
  alElegir: (e: EleccionPlancha | null) => void;
  stock: Stock | null;
  porAlmacen: PorAlmacen;
  validando: boolean;
  falloStock: boolean;
  /** Qué precio se enseña: el del corte entero o solo el de la plancha (en un terminado). */
  importe?: Importe;
}) {
  const hayDe = (codigo: string) => (stock ? (stock[codigo] ?? null) : validando ? undefined : null);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <p className="text-xs font-medium">Plancha</p>
        <p className="text-muted-foreground text-xs" aria-live="polite">
          {validando
            ? "Validando el stock en Odoo…"
            : falloStock
              ? "No se pudo validar el stock en Odoo. Puedes elegir igual."
              : "Elige la sugerencia, otro formato o un sobrante según el stock y el desperdicio."}
        </p>
      </div>

      <ul className="grid gap-2 sm:grid-cols-3" aria-label="Formatos de plancha">
        <li>
          <TarjetaSugerida
            calculo={sugerido}
            elegido={eleccion === null}
            validando={validando}
            hay={sugerido ? hayDe(sugerido.formato.codigo) : null}
            importe={importe}
            alElegir={() => alElegir(null)}
          />
        </li>
        {formatos.map((c) => (
          <li key={c.formato.codigo}>
            <TarjetaFormato
              calculo={c}
              elegido={mismaEleccion(eleccion, { tipo: "formato", codigo: c.formato.codigo })}
              validando={validando}
              hay={hayDe(c.formato.codigo)}
              porAlmacen={porAlmacen[c.formato.codigo]}
              importe={importe}
              alElegir={() => alElegir({ tipo: "formato", codigo: c.formato.codigo })}
            />
          </li>
        ))}
      </ul>

      {sobrantes.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium">
            Sobrantes <span className="text-muted-foreground font-normal">(en el {almacenSobrantes})</span>
          </p>
          <ul className="grid gap-2 sm:grid-cols-3" aria-label="Sobrantes del almacén">
            {sobrantes.map((s) => (
              <li key={s.codigo}>
                <TarjetaSobrante
                  sobrante={s}
                  almacen={almacenSobrantes}
                  elegido={mismaEleccion(eleccion, { tipo: "sobrante", codigo: s.codigo })}
                  importe={importe}
                  alElegir={() => alElegir({ tipo: "sobrante", codigo: s.codigo })}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

type Importe = "total" | "material";
const importeDe = (c: CalculoCorte, importe: Importe) => (importe === "material" ? c.material : c.total);

const claseTarjeta = (elegido: boolean, problema: boolean) =>
  cn(
    "flex h-full w-full flex-col gap-1 rounded-lg border p-3 text-left transition-colors",
    "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
    "disabled:cursor-default",
    elegido ? "border-primary/60 bg-primary/8" : "enabled:hover:border-foreground/25",
    problema && "opacity-60",
  );

const desperdicioTexto = (pct: number) => `${Math.round(pct)} % de desperdicio`;

function TarjetaSugerida({
  calculo: c,
  elegido,
  validando,
  hay,
  importe,
  alElegir,
}: {
  calculo: CalculoCorte | null;
  elegido: boolean;
  validando: boolean;
  hay: number | null | undefined;
  importe: Importe;
  alElegir: () => void;
}) {
  const conSobrante = !!c?.planchas.some((p) => p.origen.tipo === "sobrante");
  return (
    <button
      type="button"
      aria-pressed={elegido}
      onClick={alElegir}
      className={claseTarjeta(elegido, !c)}
      data-testid="opcion-sugerida"
    >
      <span className="flex items-center gap-1.5 text-sm font-medium">
        <Sparkles className="text-primary size-3.5" />
        Sugerida
      </span>
      {c ? (
        <>
          <span className="tnum text-base font-semibold">{money(importeDe(c, importe))}</span>
          <span className="text-muted-foreground tnum text-xs">
            {c.formato.ancho}×{c.formato.alto}
            {conSobrante ? " + sobrantes" : ""} · {desperdicioTexto(desperdicioFisicoPct(c))}
          </span>
          <LineaStock hay={hay} necesita={planchasNuevas(c)} />
        </>
      ) : (
        <span className="text-muted-foreground text-xs">
          {validando ? "Buscando la mejor con stock…" : "Ningún formato tiene stock suficiente: elige uno."}
        </span>
      )}
    </button>
  );
}

export function TarjetaFormato({
  calculo: c,
  elegido,
  validando,
  hay,
  porAlmacen,
  importe = "total",
  alElegir,
}: {
  calculo: CalculoCorte;
  elegido: boolean;
  validando: boolean;
  /** `undefined`: Odoo todavía no contesta. `null`: Odoo no lleva ese stock. */
  hay: number | null | undefined;
  /** Lo que hay en cada almacén, por su nombre. */
  porAlmacen?: Record<string, number>;
  importe?: Importe;
  alElegir: () => void;
}) {
  const necesita = planchasNuevas(c);

  return (
    <button
      type="button"
      aria-pressed={elegido}
      // Hasta que Odoo conteste no se elige: el check es lo que da paso.
      disabled={validando || !!c.problema}
      onClick={alElegir}
      className={claseTarjeta(elegido, !!c.problema)}
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="tnum text-sm font-medium">
          {c.formato.ancho}×{c.formato.alto}
        </span>
        <span className="text-muted-foreground font-mono text-2xs">{c.formato.codigo}</span>
      </span>

      {c.problema ? (
        <span className="text-destructive text-xs">{c.problema}</span>
      ) : (
        <>
          <span className="tnum text-base font-semibold">{money(importeDe(c, importe))}</span>
          <span className="text-muted-foreground text-xs">
            {necesita} {necesita === 1 ? "plancha" : "planchas"} · {desperdicioTexto(c.desperdicioPct)}
          </span>
        </>
      )}

      <LineaStock hay={hay} necesita={necesita} />
      {porAlmacen && Object.keys(porAlmacen).length > 0 && (
        <span className="text-muted-foreground tnum text-2xs" data-testid="stock-por-almacen">
          {Object.entries(porAlmacen)
            .map(([nombre, n]) => `${nombre} ${String(+n.toFixed(2))}`)
            .join(" · ")}
        </span>
      )}
    </button>
  );
}

function TarjetaSobrante({
  sobrante: s,
  almacen,
  elegido,
  importe,
  alElegir,
}: {
  sobrante: OpcionSobrante;
  almacen: string;
  elegido: boolean;
  importe: Importe;
  alElegir: () => void;
}) {
  const c = s.calculo;
  const enEl = c ? piezasEnSobrante(c, s.codigo) : 0;
  const nuevas = c ? planchasNuevas(c) : 0;
  return (
    <button
      type="button"
      aria-pressed={elegido}
      disabled={!c || !!c.problema}
      onClick={alElegir}
      className={claseTarjeta(elegido, !c || !!c.problema)}
      data-testid="opcion-sobrante"
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="tnum text-sm font-medium">
          {s.largo}×{s.ancho}
        </span>
        <span className="text-muted-foreground font-mono text-2xs">{s.codigo}</span>
      </span>
      {!c ? null : c.problema ? (
        <span className="text-destructive text-xs">{c.problema}</span>
      ) : (
        <>
          <span className="tnum text-base font-semibold">{money(importeDe(c, importe))}</span>
          <span className="text-muted-foreground text-xs">
            {enEl} {enEl === 1 ? "pieza" : "piezas"} aquí
            {nuevas > 0 ? ` + ${nuevas} ${nuevas === 1 ? "plancha" : "planchas"}` : ""} ·{" "}
            {desperdicioTexto(desperdicioFisicoPct(c))}
          </span>
        </>
      )}
      <span className="mt-auto flex items-center gap-1.5 pt-1 text-xs">
        <Check className="text-st-entregado size-3.5" />
        <span className="text-st-entregado font-medium">1 en el {almacen}</span>
      </span>
    </button>
  );
}

function LineaStock({ hay, necesita }: { hay: number | null | undefined; necesita: number }) {
  if (necesita === 0) {
    return (
      <span className="mt-auto flex items-center gap-1.5 pt-1 text-xs">
        <Check className="text-st-entregado size-3.5" />
        <span className="text-st-entregado font-medium">Sale de sobrantes</span>
      </span>
    );
  }
  const alcanza = typeof hay === "number" && hay >= necesita;
  return (
    <span className="mt-auto flex items-center gap-1.5 pt-1 text-xs">
      {hay === undefined ? (
        <>
          <Loader2 className="text-muted-foreground size-3.5 animate-spin" />
          <span className="text-muted-foreground">Validando stock…</span>
        </>
      ) : hay === null ? (
        <>
          <CircleAlert className="text-muted-foreground size-3.5" />
          <span className="text-muted-foreground">Odoo no lleva su stock</span>
        </>
      ) : alcanza ? (
        <>
          <Check className="text-st-entregado size-3.5" />
          <span className="text-st-entregado font-medium">Hay {hay}</span>
        </>
      ) : (
        <>
          <CircleAlert className="text-destructive size-3.5" />
          <span className="text-destructive font-medium">{hay <= 0 ? "Sin stock" : `Solo hay ${hay}`}</span>
        </>
      )}
    </span>
  );
}
