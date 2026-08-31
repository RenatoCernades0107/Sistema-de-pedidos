"use client"

import * as React from "react"
import { Field } from "@base-ui/react/field"

import { cn } from "@/lib/utils"

/**
 * Va por `Field.Control` en vez de por un `<textarea>` pelado para que, dentro
 * de un `Campo`, reciba el `id` que la etiqueta señala y el `aria-describedby`
 * de la ayuda. Fuera de un `Field.Root` el contexto tiene valores por defecto y
 * el elemento se comporta como el `<textarea>` de siempre.
 */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <Field.Control
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      // Los props del `<textarea>` van en el elemento de `render`, no aquí:
      // `Field.Control` los tipa como los de un `<input>` y `rows` no lo es.
      render={<textarea {...props} />}
    />
  )
}

export { Textarea }
