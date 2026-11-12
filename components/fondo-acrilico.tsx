import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * Planchas translúcidas superpuestas que flotan: un guiño al material, sin
 * imágenes. Es el fondo del login y de las cabeceras de los formularios.
 *
 * Los ids de los degradados salen de `useId`: con dos de estos en la misma
 * página, un id fijo haría que el segundo pintara con los del primero.
 */
export function FondoAcrilico({
  className,
  variante = "panel",
}: {
  className?: string;
  /**
   * `panel`: alto, para el lateral del login. `banda`: ancho y bajo, para la
   * cabecera de un formulario; ahí las planchas se reparten a lo largo.
   */
  variante?: "panel" | "banda";
}) {
  const id = useId().replace(/:/g, "");
  const fondo = `${id}-fondo`;
  const plancha = `${id}-plancha`;
  const amarilla = `${id}-amarilla`;
  const brillo = `${id}-brillo`;

  return (
    <svg
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 size-full", className)}
      viewBox={variante === "banda" ? "0 0 1200 260" : "0 0 600 800"}
      preserveAspectRatio={variante === "banda" ? "xMaxYMid slice" : "xMidYMid slice"}
    >
      <defs>
        <linearGradient id={fondo} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#004c8f" />
          <stop offset="1" stopColor="#00284d" />
        </linearGradient>
        <linearGradient id={plancha} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.14" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.02" />
        </linearGradient>
        <linearGradient id={amarilla} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffc200" stopOpacity="0.55" />
          <stop offset="1" stopColor="#ffc200" stopOpacity="0.08" />
        </linearGradient>
        <linearGradient id={brillo} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.09" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      {variante === "banda" ? (
        <>
          <rect width="1200" height="260" fill={`url(#${fondo})`} />
          <g transform="rotate(-16 950 130)">
            <rect className="plancha" x="780" y="-90" width="260" height="300" rx="18" fill={`url(#${plancha})`} stroke="#fff" strokeOpacity="0.18" />
            <rect className="plancha plancha-2" x="890" y="-30" width="260" height="300" rx="18" fill={`url(#${plancha})`} stroke="#fff" strokeOpacity="0.12" />
            <rect className="plancha plancha-3" x="1010" y="40" width="180" height="200" rx="16" fill={`url(#${amarilla})`} stroke="#ffc200" strokeOpacity="0.5" />
          </g>
          <g transform="rotate(12 500 260)">
            <rect className="plancha plancha-4" x="420" y="170" width="300" height="200" rx="18" fill={`url(#${plancha})`} stroke="#fff" strokeOpacity="0.1" />
          </g>
          <g transform="rotate(20 600 130)">
            <rect className="brillo-login" x="0" y="-600" width="160" height="1600" fill={`url(#${brillo})`} />
          </g>
        </>
      ) : (
        <>
          <rect width="600" height="800" fill={`url(#${fondo})`} />
          <g transform="rotate(-18 450 200)">
            <rect className="plancha" x="330" y="-60" width="300" height="380" rx="18" fill={`url(#${plancha})`} stroke="#fff" strokeOpacity="0.18" />
            <rect className="plancha plancha-2" x="390" y="10" width="300" height="380" rx="18" fill={`url(#${plancha})`} stroke="#fff" strokeOpacity="0.12" />
            <rect className="plancha plancha-3" x="455" y="90" width="210" height="260" rx="16" fill={`url(#${amarilla})`} stroke="#ffc200" strokeOpacity="0.5" />
          </g>
          <g transform="rotate(14 120 700)">
            <rect className="plancha plancha-4" x="-80" y="600" width="320" height="260" rx="18" fill={`url(#${plancha})`} stroke="#fff" strokeOpacity="0.12" />
          </g>
          <g transform="rotate(20 300 400)">
            <rect className="brillo-login" x="0" y="-400" width="160" height="1600" fill={`url(#${brillo})`} />
          </g>
        </>
      )}
    </svg>
  );
}
