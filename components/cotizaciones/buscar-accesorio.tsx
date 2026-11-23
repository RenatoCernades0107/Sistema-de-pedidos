"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import type { CategoriaConAccesorios, RespuestaAccesorios } from "@/lib/accesorios-busqueda";
import { compactar } from "@/lib/busqueda-inteligente";
import type { ProductoOdoo } from "@/lib/odoo/tipos";
import { Combo } from "@/components/cortes/selector-material-pasos";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FilaProducto } from "./buscador-producto";
import { useProductosPorCodigo } from "./use-busqueda";

/**
 * Buscar un accesorio por su categoría (la del Almacén): primero la categoría,
 * que dice cuántos accesorios tiene, y después los de esa categoría, con un
 * filtro por si son muchos. Al tocar uno se agrega.
 */
export function BuscarAccesorio({
  abierto,
  alCambiar,
  ruta,
  sinPrecio,
  alAgregar,
}: {
  abierto: boolean;
  alCambiar: (abierto: boolean) => void;
  /** La ruta de búsqueda de la pantalla: decide si salen precios. */
  ruta: string;
  sinPrecio?: boolean;
  alAgregar: (producto: ProductoOdoo) => void;
}) {
  return (
    <Dialog open={abierto} onOpenChange={alCambiar} triggerId={null}>
      <DialogContent className="flex max-h-[92dvh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Buscar accesorio</DialogTitle>
          <DialogDescription>Elige la categoría y después el accesorio.</DialogDescription>
        </DialogHeader>
        {abierto && (
          <Pasos
            ruta={ruta}
            sinPrecio={sinPrecio}
            alAgregar={(p) => {
              alCambiar(false);
              alAgregar(p);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Pasos({
  ruta,
  sinPrecio,
  alAgregar,
}: {
  ruta: string;
  sinPrecio?: boolean;
  alAgregar: (producto: ProductoOdoo) => void;
}) {
  const categorias = useCategorias();
  const [categoriaId, setCategoriaId] = useState<string | null>(null);
  const [abierto, setAbierto] = useState(true);
  const [filtro, setFiltro] = useState("");
  const categoria = categorias.lista?.find((c) => c.id === categoriaId) ?? null;
  const codigos = useMemo(() => categoria?.codigos ?? [], [categoria]);
  const productos = useProductosPorCodigo<ProductoOdoo>(ruta, codigos);

  const palabras = filtro.split(/\s+/).map(compactar).filter(Boolean);
  const visibles = productos.resultados.filter((r) => {
    const donde = compactar(`${r.item.codigo ?? ""} ${r.item.nombre} ${r.item.barcode ?? ""}`);
    return palabras.every((p) => donde.includes(p));
  });

  if (categorias.error) return <p className="text-destructive text-sm">{categorias.error}</p>;
  if (!categorias.lista) {
    return (
      <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
        <Loader2 className="size-4 animate-spin" /> Cargando categorías…
      </p>
    );
  }

  return (
    <div className="-mx-4 flex min-h-0 flex-col gap-4 overflow-y-auto px-4 pb-1">
      <Combo
        etiqueta="Categoría"
        testId="paso-categoria"
        valor={categoria?.nombre ?? null}
        marcador="Elige la categoría"
        abierto={abierto}
        alAbrir={setAbierto}
        buscar="Buscar categoría…"
        elementos={categorias.lista.map((c) => ({
          clave: c.id,
          texto: c.nombre,
          detalle: c.codigos.length === 1 ? "1 accesorio" : `${c.codigos.length} accesorios`,
          marcado: c.id === categoriaId,
        }))}
        sinNada="Todavía no hay accesorios. Se agregan en Almacén."
        alElegir={(id) => {
          setCategoriaId(id);
          setFiltro("");
          setAbierto(false);
        }}
      />

      {categoria && (
        <div className="flex flex-col gap-1.5">
          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <input
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
              placeholder={`Filtrar en ${categoria.nombre.toLowerCase()}…`}
              aria-label="Filtrar accesorios"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              className="border-input focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 h-10 w-full min-w-0 rounded-lg border bg-transparent pr-3 pl-9 text-base outline-none focus-visible:ring-3 md:text-sm"
            />
          </div>
          {productos.error && <p className="text-destructive text-sm">{productos.error}</p>}
          {productos.cargando && (
            <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
              <Loader2 className="size-4 animate-spin" /> Buscando en Odoo…
            </p>
          )}
          {!productos.cargando && !productos.error && visibles.length === 0 && (
            <p className="text-muted-foreground px-1 py-2 text-sm">
              {filtro.trim() ? "Ningún accesorio coincide." : "Ninguno de estos accesorios está en Odoo."}
            </p>
          )}
          <ul className="flex flex-col gap-1.5" aria-label={`Accesorios: ${categoria.nombre}`}>
            {visibles.map((r) => (
              <li key={r.item.id}>
                <button
                  type="button"
                  onClick={() => alAgregar(r.item)}
                  className="hover:bg-muted focus-visible:border-ring focus-visible:ring-ring/50 flex w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors outline-none focus-visible:ring-3"
                >
                  <FilaProducto resultado={r} consulta={filtro} sinPrecio={sinPrecio} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function useCategorias(): { lista: CategoriaConAccesorios[] | null; error: string | null } {
  const [estado, setEstado] = useState<{ lista: CategoriaConAccesorios[] | null; error: string | null }>({
    lista: null,
    error: null,
  });
  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/cotizaciones/buscar/accesorios", { signal: ctrl.signal });
        const json = (await res.json()) as RespuestaAccesorios & { error?: string };
        setEstado(
          res.ok
            ? { lista: json.categorias, error: null }
            : { lista: null, error: json.error ?? "No se pudieron leer los accesorios." },
        );
      } catch {
        if (!ctrl.signal.aborted) setEstado({ lista: null, error: "No se pudieron leer los accesorios. Revisa la conexión." });
      }
    })();
    return () => ctrl.abort();
  }, []);
  return estado;
}
