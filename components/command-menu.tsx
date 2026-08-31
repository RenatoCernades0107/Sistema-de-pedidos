"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  Hammer,
  LayoutList,
  Plus,
  Store,
  Truck,
  type LucideIcon,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { EstadoBadge } from "@/components/estado-badge";
import { useStore } from "@/lib/store";
import { VISTAS, etiquetaTipos, type Vista } from "@/lib/dominio";
import { camposBuscables, coincide } from "@/lib/busqueda";
import { porUrgencia } from "@/lib/formato";

const ICONOS: Record<Vista, LucideIcon> = {
  admin: LayoutList,
  taller: Hammer,
  tienda: Store,
  logistica: Truck,
  historial: Archive,
};

export function useCommandMenu() {
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setAbierto((v) => !v);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return { abierto, setAbierto };
}

/**
 * Buscar un pedido por código sin soltar el teclado.
 * En mostrador el cliente dicta "LCL guion 2026…" y se llega en dos segundos,
 * así que el filtro ignora tildes y separadores.
 */
export function CommandMenu({
  abierto,
  setAbierto,
}: {
  abierto: boolean;
  setAbierto: (v: boolean) => void;
}) {
  const router = useRouter();
  const { pedidos, permisos } = useStore();

  const ir = (href: string) => {
    setAbierto(false);
    router.push(href);
  };

  // El buscador no puede enseñar lo que la vista del rol esconde.
  const visibles = useMemo(
    () =>
      [...pedidos]
        .filter((p) => permisos.vistas.some((v) => VISTAS[v].filtro(p)))
        .sort(porUrgencia),
    [pedidos, permisos.vistas],
  );

  /* El filtro por defecto de cmdk puntúa carácter a carácter y se pierde con
     "LCL_2026_H4TP". Con Supabase esto pasará a ser una búsqueda en servidor. */
  const filtrar = useCallback(
    (value: string, search: string) => (coincide(value, search) ? 1 : 0),
    [],
  );

  return (
    <CommandDialog
      open={abierto}
      onOpenChange={setAbierto}
      title="Buscar"
      description={`Busca un pedido por código${
        permisos.verCliente ? " o cliente" : " o trabajo"
      }, o salta a una vista`}
      filter={filtrar}
    >
      {/* El ⌘K existe para no soltar el teclado: se escribe sin tocar nada más. */}
      <CommandInput
        autoFocus
        placeholder={
          permisos.verCliente
            ? "Código, cliente o responsable…"
            : "Código, trabajo o responsable…"
        }
      />
      <CommandList>
        <CommandEmpty>Ningún pedido coincide.</CommandEmpty>

        <CommandGroup heading="Pedidos">
          {visibles.map((p) => (
            <CommandItem
              key={p.codigo}
              value={camposBuscables(p, permisos)}
              onSelect={() => ir(`/pedidos/${p.codigo}`)}
              className="gap-3"
            >
              <span className="tnum text-primary shrink-0 text-xs font-medium">{p.codigo}</span>
              <span className="min-w-0 flex-1 truncate">
                {permisos.verCliente ? p.cliente : etiquetaTipos(p.tipos)}
              </span>
              <EstadoBadge estado={p.estado} size="sm" />
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Ir a">
          {permisos.vistas.map((v) => {
            const Icono = ICONOS[v];
            return (
              <CommandItem
                key={v}
                value={`ir ${VISTAS[v].titulo}`}
                onSelect={() => ir(`/${v}`)}
              >
                <Icono className="size-4" />
                {VISTAS[v].titulo}
              </CommandItem>
            );
          })}
          {permisos.crearPedido && (
            <CommandItem value="nuevo pedido crear" onSelect={() => ir("/pedidos/nuevo")}>
              <Plus className="size-4" />
              Nuevo pedido
            </CommandItem>
          )}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
