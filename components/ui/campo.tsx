"use client";

import * as React from "react";
import { Field } from "@base-ui/react/field";

import { cn } from "@/lib/utils";

/**
 * Un campo de formulario: etiqueta, control, ayuda y error.
 *
 * Lo interesante es quién reparte los `id`. Antes cada formulario tenía su
 * propia copia de este componente y la etiqueta era un `<label>` suelto, sin
 * `htmlFor` y sin nada a lo que apuntar: se veía bien, pero el control quedaba
 * sin nombre accesible y la ayuda y el error no se anunciaban al llegar a él.
 * `Field` de Base UI resuelve las tres cosas — enlaza etiqueta y control, cablea
 * `aria-describedby` con la descripción y el error, y marca `aria-invalid` — a
 * cambio de que el control sea uno suyo (`Input`, `Select`, `Checkbox`,
 * `Field.Control`), que es lo que ya usa `components/ui`.
 *
 * La validación la sigue haciendo Zod desde react-hook-form; a `Field` solo se
 * le dice el resultado con `invalid` y `match`, que es el modo que la propia
 * documentación reserva para librerías externas.
 */
export function Campo({
  label,
  requerido,
  ayuda,
  error,
  grupo,
  className,
  claseEtiqueta,
  children,
}: {
  label: React.ReactNode;
  requerido?: boolean;
  ayuda?: string;
  error?: string;
  /**
   * Para controles que no son un solo elemento enfocable — la botonera de
   * `Opciones`. Ahí un `<label>` no tiene a quién señalar, así que el conjunto
   * se nombra con `role="group"` y `aria-labelledby`.
   */
  grupo?: boolean;
  className?: string;
  /** Para las etiquetas que no llevan el tamaño de formulario, como `eyebrow`. */
  claseEtiqueta?: string;
  children: React.ReactNode;
}) {
  const idEtiqueta = React.useId();
  const idNota = React.useId();
  const nota = error ?? ayuda;

  const marca = requerido && (
    <span className="text-destructive ml-0.5" aria-hidden>
      *
    </span>
  );

  if (grupo) {
    return (
      <div
        role="group"
        aria-labelledby={idEtiqueta}
        aria-describedby={nota ? idNota : undefined}
        className={cn("flex min-w-0 flex-col gap-1.5", className)}
      >
        <span id={idEtiqueta} className={cn("text-xs font-medium", claseEtiqueta)}>
          {label}
          {marca}
          {requerido && <span className="sr-only"> (obligatorio)</span>}
        </span>
        {children}
        {nota && (
          <p
            id={idNota}
            className={cn("text-xs", error ? "text-destructive" : "text-muted-foreground")}
          >
            {nota}
          </p>
        )}
      </div>
    );
  }

  return (
    <Field.Root
      invalid={!!error}
      className={cn("flex min-w-0 flex-col gap-1.5", className)}
    >
      <Field.Label className={cn("text-xs font-medium", claseEtiqueta)}>
        {label}
        {marca}
        {requerido && <span className="sr-only"> (obligatorio)</span>}
      </Field.Label>

      {children}

      {error ? (
        <Field.Error match className="text-destructive text-xs">
          {error}
        </Field.Error>
      ) : ayuda ? (
        <Field.Description className="text-muted-foreground text-xs">
          {ayuda}
        </Field.Description>
      ) : null}
    </Field.Root>
  );
}

/**
 * Botonera de opciones. Con `valores` de un solo elemento se comporta como una
 * radio; con varios, como casillas. Es el mismo control porque para quien
 * registra es el mismo gesto: tocar lo que aplica.
 *
 * Va siempre dentro de un `Campo` con `grupo`: son botones con `aria-pressed`,
 * y sin el grupo que los nombra cada uno se anunciaría suelto, sin decir de qué
 * pregunta son respuesta.
 */
export function Opciones({
  valores,
  onToggle,
  opciones,
}: {
  valores: string[];
  onToggle: (v: string) => void;
  opciones: { valor: string; label: string }[];
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {opciones.map((o) => {
        const activo = valores.includes(o.valor);
        return (
          <button
            key={o.valor}
            type="button"
            onClick={() => onToggle(o.valor)}
            aria-pressed={activo}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-sm transition-colors",
              "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
              activo
                ? "border-primary/40 bg-primary/8 text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground hover:border-foreground/20",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
