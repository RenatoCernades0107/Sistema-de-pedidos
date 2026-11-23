"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { medidaDe, nombreDeGrupo, type GrupoPlancha } from "@/lib/cortes/catalogo";
import type { ProductoOdoo } from "@/lib/odoo/tipos";
import { cn } from "@/lib/utils";
import type { RespuestaStock } from "@/app/api/cortes/stock/route";
import { SelectorMaterialPasos } from "@/components/cortes/selector-material-pasos";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FilaProducto } from "./buscador-producto";
import { useProductosPorCodigo } from "./use-busqueda";

/**
 * Buscar una plancha por sus propiedades, como en corte a medida: Material →
 * Color → Espesor (cada paso dice cuántas opciones tiene el siguiente) y, al
 * final, el formato. Cada formato es un producto distinto en Odoo: se enseña con
 * su código, su precio y su stock, y al tocarlo se agrega.
 */
export function BuscarPlancha({
  abierto,
  alCambiar,
  catalogo,
  ruta,
  sinPrecio,
  alAgregar,
}: {
  abierto: boolean;
  alCambiar: (abierto: boolean) => void;
  catalogo: GrupoPlancha[];
  /** La ruta de búsqueda de la pantalla: decide si salen precios. */
  ruta: string;
  sinPrecio?: boolean;
  alAgregar: (producto: ProductoOdoo) => void;
}) {
  return (
    <Dialog open={abierto} onOpenChange={alCambiar} triggerId={null}>
      <DialogContent className="flex max-h-[92dvh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Buscar plancha</DialogTitle>
          <DialogDescription>Elige el material, el color y el espesor, y después el formato.</DialogDescription>
        </DialogHeader>
        {abierto && (
          <Pasos
            catalogo={catalogo}
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
  catalogo,
  ruta,
  sinPrecio,
  alAgregar,
}: {
  catalogo: GrupoPlancha[];
  ruta: string;
  sinPrecio?: boolean;
  alAgregar: (producto: ProductoOdoo) => void;
}) {
  const [grupo, setGrupo] = useState<GrupoPlancha | null>(null);
  const formatos = useMemo(() => grupo?.formatos.filter((f) => f.activo && f.codigo) ?? [], [grupo]);
  const codigos = useMemo(() => formatos.map((f) => f.codigo), [formatos]);
  const productos = useProductosPorCodigo<ProductoOdoo>(ruta, codigos);
  const stock = useStock(codigos);
  const porCodigo = new Map(productos.resultados.map((r) => [r.item.codigo, r]));

  return (
    <div className="-mx-4 flex min-h-0 flex-col gap-4 overflow-y-auto px-4 pb-1">
      <SelectorMaterialPasos
        catalogo={catalogo}
        grupo={grupo}
        alElegir={setGrupo}
        alCambiar={() => setGrupo(null)}
        testId="plancha-buscada"
        autoFocus
      />

      {grupo && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium">
            Formato{" "}
            <span className="text-muted-foreground font-normal">
              · {formatos.length === 1 ? "1 formato" : `${formatos.length} formatos`}
            </span>
          </p>
          {productos.error && <p className="text-destructive text-sm">{productos.error}</p>}
          {formatos.length === 0 && (
            <p className="text-muted-foreground rounded-lg border border-dashed px-3 py-3 text-center text-xs">
              {nombreDeGrupo(grupo)} no tiene formatos activos. Se administran en Configuración.
            </p>
          )}
          <ul className="flex flex-col gap-1.5" aria-label="Formatos">
            {formatos.map((f) => {
              const r = porCodigo.get(f.codigo);
              const cantidad = stock?.[f.codigo];
              return (
                <li key={f.id}>
                  <button
                    type="button"
                    disabled={!r}
                    onClick={() => r && alAgregar(r.item)}
                    className={cn(
                      "flex w-full flex-col gap-1 rounded-lg border px-3 py-2 text-left text-sm transition-colors outline-none",
                      "hover:bg-muted focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent",
                    )}
                  >
                    <span className="tnum font-medium">{medidaDe(f)} cm</span>
                    {r ? (
                      <FilaProducto
                        resultado={r}
                        consulta=""
                        sinPrecio={sinPrecio}
                        extra={
                          cantidad !== undefined && cantidad !== null ? (
                            <span
                              className={cn("tnum text-xs", cantidad > 0 ? "text-muted-foreground" : "text-destructive")}
                            >
                              {cantidad > 0 ? `Stock ${+cantidad.toFixed(2)}` : "Sin stock"}
                            </span>
                          ) : null
                        }
                      />
                    ) : productos.cargando ? (
                      <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
                        <Loader2 className="size-3.5 animate-spin" /> Buscando en Odoo…
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs">
                        <span className="font-mono">{f.codigo}</span> · No está en Odoo
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/** El stock de los formatos. Si no se puede saber (Odoo caído, o quien busca no cotiza), no se enseña. */
function useStock(codigos: readonly string[]): Record<string, number | null> | null {
  const clave = codigos.join(",");
  const [stock, setStock] = useState<{ clave: string; stock: Record<string, number | null> } | null>(null);
  useEffect(() => {
    if (!clave) return;
    const ctrl = new AbortController();
    fetch(`/api/cortes/stock?codigos=${encodeURIComponent(clave)}`, { signal: ctrl.signal })
      .then(async (res) => {
        if (res.ok) setStock({ clave, stock: ((await res.json()) as RespuestaStock).stock });
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [clave]);
  return stock?.clave === clave ? stock.stock : null;
}
