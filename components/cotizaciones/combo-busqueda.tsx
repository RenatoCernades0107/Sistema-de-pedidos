"use client";

import { useState, type ReactNode, type Ref } from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Opcion {
  /** Identidad para cmdk. Única dentro de la lista. */
  valor: string;
  contenido: ReactNode;
  alElegir: () => void;
}

/**
 * Un input con su lista de resultados debajo, para buscar en Odoo.
 *
 * Sobre `cmdk` para tener gratis el teclado (↑ ↓ Enter, con vuelta al principio)
 * y los roles de combobox, pero sin su filtro: filtra y ordena el servidor, así
 * que aquí la lista se pinta tal como llega.
 *
 * Dos detalles de mostrador:
 *   - Al llegar resultados nuevos queda marcado el primero. Como el servidor pone
 *     arriba el código exacto, escribir un código y dar Enter basta.
 *   - Un Enter sobre resultados que todavía son de la consulta anterior no elige
 *     nada: se le pasa a `alEnterSinRespuesta`, que decide (el lector de códigos
 *     de barras escribe y da Enter más rápido de lo que contesta la red).
 */
export function ComboBusqueda({
  etiqueta,
  placeholder,
  consulta,
  alEscribir,
  opciones,
  titulo,
  extra = [],
  cargando,
  error,
  vacio,
  fresco,
  alEnterSinRespuesta,
  inputRef,
  autoFocus,
  className,
  enLinea,
}: {
  /** La lista ocupa su lugar en el flujo en vez de flotar sobre lo de abajo. */
  enLinea?: boolean;
  etiqueta: string;
  placeholder: string;
  consulta: string;
  alEscribir: (q: string) => void;
  opciones: Opcion[];
  /** Encabezado de la lista ("Recientes", "Resultados"…). */
  titulo?: string;
  /** Opciones fijas al final, como "Crear cliente". */
  extra?: Opcion[];
  cargando: boolean;
  error: string | null;
  vacio: string;
  /** Si los resultados que hay son de lo que está escrito ahora. */
  fresco: boolean;
  alEnterSinRespuesta?: () => void;
  inputRef?: Ref<HTMLInputElement>;
  autoFocus?: boolean;
  className?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  /* Qué opción está marcada, y para qué lista. Si la lista cambió, se marca la
     primera: así no hace falta un efecto que la resetee. */
  const [marcada, setMarcada] = useState<{ lista: string; valor: string } | null>(null);

  const todas = [...opciones, ...extra];
  const lista = todas.map((o) => o.valor).join("|");
  const valor =
    marcada?.lista === lista && todas.some((o) => o.valor === marcada.valor)
      ? marcada.valor
      : (todas[0]?.valor ?? "");

  return (
    <CommandPrimitive
      shouldFilter={false}
      loop
      value={valor}
      onValueChange={(v) => setMarcada({ lista, valor: v })}
      label={etiqueta}
      className={cn("relative", className)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setAbierto(false);
          return;
        }
        if (e.key === "Enter" && !fresco) {
          e.preventDefault();
          alEnterSinRespuesta?.();
        }
      }}
    >
      <div className="relative">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <CommandPrimitive.Input
          ref={inputRef}
          value={consulta}
          onValueChange={(q) => {
            alEscribir(q);
            setAbierto(true);
          }}
          onFocus={() => setAbierto(true)}
          onBlur={() => setAbierto(false)}
          onClick={() => setAbierto(true)}
          placeholder={placeholder}
          aria-label={etiqueta}
          autoFocus={autoFocus}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className={cn(
            "border-input h-10 w-full min-w-0 rounded-lg border bg-transparent pr-9 pl-9 text-base transition-colors outline-none md:text-sm",
            "placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3 dark:bg-input/30",
          )}
        />
        {cargando && (
          <Loader2
            className="text-muted-foreground absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin"
            aria-label="Buscando"
          />
        )}
      </div>

      {abierto && (
        <CommandPrimitive.List
          // El foco se queda en el input: si el clic se lo llevara, la lista se
          // cerraría antes de que el clic llegue a la opción.
          onMouseDown={(e) => e.preventDefault()}
          className={cn(
            "bg-popover text-popover-foreground mt-1 max-h-[min(22rem,60dvh)] w-full overflow-y-auto overscroll-contain rounded-lg border p-1 shadow-lg",
            // En un contenedor con scroll (un diálogo), una lista flotante queda
            // recortada: en línea empuja el contenido y el diálogo crece.
            enLinea ? "relative" : "absolute top-full z-40",
          )}
        >
          {error && <p className="text-destructive px-2 py-2 text-sm">{error}</p>}

          {opciones.length > 0 && (
            <CommandPrimitive.Group
              heading={titulo}
              // Mientras llega la respuesta a lo que se acaba de escribir, lo de
              // antes se queda (una lista que parpadea vacía cansa), pero atenuado.
              aria-busy={!fresco}
              className="transition-opacity aria-busy:opacity-50 **:[[cmdk-group-heading]]:text-muted-foreground **:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:py-1.5 **:[[cmdk-group-heading]]:text-xs **:[[cmdk-group-heading]]:font-medium"
            >
              {opciones.map((o) => (
                <Item key={o.valor} opcion={o} />
              ))}
            </CommandPrimitive.Group>
          )}

          {opciones.length === 0 && !error && (
            <p className="text-muted-foreground px-2 py-3 text-sm">{cargando ? "Buscando…" : vacio}</p>
          )}

          {extra.length > 0 && (
            <CommandPrimitive.Group className={cn(opciones.length > 0 && "mt-1 border-t pt-1")}>
              {extra.map((o) => (
                <Item key={o.valor} opcion={o} />
              ))}
            </CommandPrimitive.Group>
          )}
        </CommandPrimitive.List>
      )}
    </CommandPrimitive>
  );
}

function Item({ opcion }: { opcion: Opcion }) {
  return (
    <CommandPrimitive.Item
      value={opcion.valor}
      onSelect={opcion.alElegir}
      className="data-[selected=true]:bg-muted flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm outline-none select-none"
    >
      {opcion.contenido}
    </CommandPrimitive.Item>
  );
}
