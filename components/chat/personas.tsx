"use client";

/**
 * Elegir personas del equipo: a quién escribirle un directo, a quién meter en un
 * canal. Sale de `directorio_usuarios()` (`usuarios` solo deja leer el perfil
 * propio), que se pide una vez por sesión de la pestaña.
 */

import { useEffect, useState } from "react";
import { Check, Loader2, Search } from "lucide-react";
import { ROLES } from "@/lib/dominio";
import { cn } from "@/lib/utils";
import { clienteNavegador } from "@/lib/supabase-cliente";
import { normalizar } from "@/lib/chat/logica";
import type { UsuarioDirectorio } from "@/lib/chat/tipos";
import { Input } from "@/components/ui/input";

let directorio: Promise<UsuarioDirectorio[]> | null = null;

function leerDirectorio(): Promise<UsuarioDirectorio[]> {
  directorio ??= Promise.resolve(clienteNavegador().rpc("directorio_usuarios")).then(({ data, error }) => {
    if (error) {
      // Que el próximo intento vuelva a preguntar.
      directorio = null;
      throw new Error(error.message);
    }
    return data ?? [];
  });
  return directorio;
}

export function useDirectorio() {
  const [personas, setPersonas] = useState<UsuarioDirectorio[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let vivo = true;
    leerDirectorio()
      .then((p) => vivo && setPersonas(p))
      .catch(() => vivo && setError(true));
    return () => {
      vivo = false;
    };
  }, []);
  return { personas, error };
}

/** Las iniciales para el círculo: "Carla Ruiz" → "CR". */
export const iniciales = (nombre: string) =>
  nombre
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("") || "?";

export function Avatar({ nombre, className }: { nombre: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "bg-primary/10 text-primary grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold",
        className,
      )}
    >
      {iniciales(nombre)}
    </span>
  );
}

/**
 * La lista con buscador. Con `multiple` cada fila marca y desmarca; sin él, tocar
 * una fila es elegirla (`onElegir`).
 */
export function SelectorPersonas({
  excluir = [],
  elegidos = [],
  multiple,
  onElegir,
  ocupado,
}: {
  /** Quienes no se ofrecen: uno mismo, los que ya están en el canal. */
  excluir?: string[];
  elegidos?: string[];
  multiple?: boolean;
  onElegir: (persona: UsuarioDirectorio) => void;
  /** El id de la persona cuya elección está en curso (abriendo el directo). */
  ocupado?: string | null;
}) {
  const { personas, error } = useDirectorio();
  const [filtro, setFiltro] = useState("");
  const buscado = normalizar(filtro);
  const visibles = (personas ?? []).filter(
    (p) =>
      !excluir.includes(p.id) &&
      (!buscado || normalizar(p.nombre).includes(buscado) || normalizar(p.usuario).includes(buscado)),
  );

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="relative">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
        <Input
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          placeholder="Buscar por nombre…"
          aria-label="Buscar persona"
          className="pl-8"
          autoFocus
        />
      </div>
      <ul className="-mx-1 flex max-h-72 min-h-0 flex-col overflow-y-auto">
        {!personas && !error && (
          <li className="text-muted-foreground flex items-center gap-2 p-3 text-sm">
            <Loader2 className="size-4 animate-spin" /> Cargando…
          </li>
        )}
        {error && <li className="text-destructive p-3 text-sm">No se pudo leer el equipo.</li>}
        {personas && visibles.length === 0 && (
          <li className="text-muted-foreground p-3 text-sm">Nadie con ese nombre.</li>
        )}
        {visibles.map((p) => {
          const marcado = elegidos.includes(p.id);
          return (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onElegir(p)}
                disabled={!!ocupado}
                aria-pressed={multiple ? marcado : undefined}
                className="hover:bg-accent focus-visible:bg-accent flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left outline-none disabled:opacity-60"
              >
                <Avatar nombre={p.nombre} className="size-8" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{p.nombre}</span>
                  <span className="text-muted-foreground block text-xs">{ROLES[p.rol].nombre}</span>
                </span>
                {ocupado === p.id && <Loader2 className="size-4 animate-spin" />}
                {multiple && (
                  <span
                    className={cn(
                      "grid size-5 place-items-center rounded-full border",
                      marcado && "bg-primary border-primary text-primary-foreground",
                    )}
                  >
                    {marcado && <Check className="size-3" />}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
