"use client";

import { useState, type ReactNode, type Ref } from "react";
import { Layers, Puzzle } from "lucide-react";
import type { GrupoPlancha } from "@/lib/cortes/catalogo";
import type { ProductoOdoo } from "@/lib/odoo/tipos";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { BuscadorProducto } from "./buscador-producto";
import { BuscarAccesorio } from "./buscar-accesorio";
import { BuscarPlancha } from "./buscar-plancha";

const RUTA = "/api/cotizaciones/buscar/productos";

/**
 * Cómo se agregan productos a una cotización o un pedido: el buscador de Odoo a
 * todo el ancho (así sus resultados tienen sitio para el nombre, también en un
 * celular) y, debajo, los atajos por propiedades —Buscar plancha, Buscar
 * accesorio— y lo que pase la pantalla en `acciones` (corte a medida, producto
 * terminado).
 */
export function BarraAgregar({
  alAgregar,
  inputRef,
  catalogo,
  ruta = RUTA,
  sinPrecio,
  etiqueta,
  acciones,
  className,
}: {
  alAgregar: (producto: ProductoOdoo) => void;
  inputRef?: Ref<HTMLInputElement>;
  catalogo: GrupoPlancha[];
  ruta?: string;
  sinPrecio?: boolean;
  etiqueta?: string;
  /** Más botones al lado de los atajos, del mismo alto. */
  acciones?: ReactNode;
  className?: string;
}) {
  const [buscando, setBuscando] = useState<"plancha" | "accesorio" | null>(null);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <BuscadorProducto alAgregar={alAgregar} inputRef={inputRef} ruta={ruta} sinPrecio={sinPrecio} etiqueta={etiqueta} />
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <Button
          type="button"
          variant="outline"
          className="h-10 gap-1.5"
          onClick={() => setBuscando("plancha")}
          disabled={catalogo.length === 0}
          title={catalogo.length === 0 ? "No hay planchas en el catálogo" : undefined}
        >
          <Layers />
          Buscar plancha
        </Button>
        <Button type="button" variant="outline" className="h-10 gap-1.5" onClick={() => setBuscando("accesorio")}>
          <Puzzle />
          Buscar accesorio
        </Button>
        {acciones}
      </div>

      <BuscarPlancha
        abierto={buscando === "plancha"}
        alCambiar={(v) => setBuscando(v ? "plancha" : null)}
        catalogo={catalogo}
        ruta={ruta}
        sinPrecio={sinPrecio}
        alAgregar={alAgregar}
      />
      <BuscarAccesorio
        abierto={buscando === "accesorio"}
        alCambiar={(v) => setBuscando(v ? "accesorio" : null)}
        ruta={ruta}
        sinPrecio={sinPrecio}
        alAgregar={alAgregar}
      />
    </div>
  );
}
