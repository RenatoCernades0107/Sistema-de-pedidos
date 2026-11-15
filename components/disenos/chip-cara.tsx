"use client";

import { Square, SquareDashed, X } from "lucide-react";
import { PATRON_ALIAS, type ReferenciaCara } from "@/lib/cad/caras";
import { cn } from "@/lib/utils";

/**
 * Una cara señalada en el visor, como ficha: encima del cuadro de texto (con
 * ✕ para quitarla) y en el mensaje ya enviado (solo lectura).
 */
export function ChipCara({
  cara,
  alQuitar,
  className,
}: {
  cara: ReferenciaCara;
  alQuitar?: () => void;
  className?: string;
}) {
  const Icono = cara.tipo === "cara" ? Square : SquareDashed;
  const detalle = `${cara.ancho_mm} × ${cara.alto_mm} mm`;
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
        className,
      )}
      title={`${cara.etiqueta} · ${detalle}`}
    >
      <Icono className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{cara.etiqueta}</span>
      {alQuitar && (
        <button
          type="button"
          onClick={alQuitar}
          aria-label={`Quitar ${cara.etiqueta}`}
          className="hover:bg-foreground/10 -mr-1 rounded-full p-0.5"
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  );
}

/** Un `@caraN` del texto de un mensaje. */
export interface Mencion {
  alias: string;
  texto: string;
}

/** Parte un texto en trozos y menciones `@caraN`, en orden. */
export function partirMenciones(texto: string): (string | Mencion)[] {
  const trozos: (string | Mencion)[] = [];
  let desde = 0;
  for (const m of texto.matchAll(PATRON_ALIAS)) {
    if (m.index > desde) trozos.push(texto.slice(desde, m.index));
    trozos.push({ alias: m[1], texto: m[0] });
    desde = m.index + m[0].length;
  }
  if (desde < texto.length) trozos.push(texto.slice(desde));
  return trozos;
}

/**
 * El texto de un mensaje con sus `@caraN` como pastillas: al pasar el ratón se
 * ve qué cara es. Un `@caraN` sin cara detrás se deja como texto.
 */
export function TextoConCaras({ texto, caras }: { texto: string; caras: readonly ReferenciaCara[] }) {
  return (
    <>
      {partirMenciones(texto).map((trozo, i) => {
        if (typeof trozo === "string") return trozo;
        const cara = caras.find((c) => c.alias === trozo.alias);
        if (!cara) return trozo.texto;
        const Icono = cara.tipo === "cara" ? Square : SquareDashed;
        return (
          <span
            key={i}
            title={`${cara.etiqueta} · ${cara.ancho_mm} × ${cara.alto_mm} mm`}
            className="inline-flex items-center gap-0.5 rounded-md bg-white/20 px-1 align-baseline font-medium ring-1 ring-amber-300/70"
          >
            <Icono className="size-3 shrink-0" aria-hidden />
            {trozo.texto}
          </span>
        );
      })}
    </>
  );
}
