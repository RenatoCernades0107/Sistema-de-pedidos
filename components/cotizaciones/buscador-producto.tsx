"use client";

import { useState, type Ref } from "react";
import { money } from "@/lib/formato";
import { compactar } from "@/lib/busqueda-inteligente";
import type { ProductoOdoo, Resultado } from "@/lib/odoo/tipos";
import { cn } from "@/lib/utils";
import { ComboBusqueda, type Opcion } from "./combo-busqueda";
import { Resaltado } from "./resaltado";
import { buscarUnaVez, useBusqueda } from "./use-busqueda";

const RUTA = "/api/cotizaciones/buscar/productos";

/**
 * Agregar productos de Odoo por código o por nombre. Se queda siempre a la
 * vista: se escribe, Enter, se ajusta la cantidad, Enter, y de vuelta aquí para
 * el siguiente.
 *
 * El código va primero y destacado en cada resultado: es por donde más se busca
 * en mostrador, y lo que distingue a dos planchas casi iguales.
 */
export function BuscadorProducto({
  alAgregar,
  inputRef,
  ruta = RUTA,
  sinPrecio = false,
  enLinea = false,
  etiqueta = "Buscar producto",
}: {
  alAgregar: (producto: ProductoOdoo) => void;
  inputRef?: Ref<HTMLInputElement>;
  /** De dónde se busca. Por defecto, el buscador de cotizaciones. */
  ruta?: string;
  /** Para quien no ve dinero: los resultados salen sin precio. */
  sinPrecio?: boolean;
  /** Dentro de un diálogo: la lista ocupa su lugar en vez de flotar. */
  enLinea?: boolean;
  etiqueta?: string;
}) {
  const [consulta, setConsulta] = useState("");
  const busqueda = useBusqueda<ProductoOdoo>(ruta, consulta, true);
  const q = consulta.trim();

  const agregar = (p: ProductoOdoo) => {
    setConsulta("");
    alAgregar(p);
  };

  const opciones: Opcion[] = busqueda.resultados.map((r) => ({
    valor: `producto-${r.item.id}`,
    alElegir: () => agregar(r.item),
    contenido: <FilaProducto resultado={r} consulta={q} sinPrecio={sinPrecio} />,
  }));

  return (
    <ComboBusqueda
      etiqueta={etiqueta}
      enLinea={enLinea}
      placeholder="Código o nombre del producto…"
      consulta={consulta}
      alEscribir={setConsulta}
      opciones={opciones}
      titulo={busqueda.origen === "recientes" ? "Los más cotizados" : undefined}
      cargando={busqueda.cargando}
      error={busqueda.error}
      vacio={
        q
          ? "Ningún producto coincide. Prueba con el código o con menos palabras."
          : "Escribe el código o el nombre."
      }
      fresco={!busqueda.cargando && busqueda.consultaRespondida === q}
      alEnterSinRespuesta={async () => {
        // Lector de código de barras o código tecleado de memoria: si hay uno
        // solo que coincide exacto, se agrega ya, sin esperar a la lista.
        if (!q) return;
        const r = await buscarUnaVez<ProductoOdoo>(`${ruta}?exacto=1&q=${encodeURIComponent(q)}`);
        if (r?.resultados.length === 1) agregar(r.resultados[0].item);
      }}
      inputRef={inputRef}
    />
  );
}

function FilaProducto({
  resultado,
  consulta,
  sinPrecio,
}: {
  resultado: Resultado<ProductoOdoo>;
  consulta: string;
  sinPrecio?: boolean;
}) {
  const p = resultado.item;
  const exacto = resultado.porCodigo === "exacto";
  // Si lo que se escribió está en el código de barras, se enseña: es lo que lo trajo.
  const q = compactar(consulta);
  const porBarcode = !!p.barcode && q.length >= 3 && compactar(p.barcode).includes(q);
  return (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-start gap-2">
          {p.codigo && (
            <CodigoProducto codigo={p.codigo} consulta={consulta} destacado={exacto} />
          )}
          {/* Hasta dos líneas y no una cortada: lo que distingue dos planchas
              ("… 3MM" / "… 5MM") suele estar al final del nombre. */}
          <Resaltado texto={p.nombre} consulta={consulta} className="line-clamp-2 min-w-0" />
        </span>
        {(porBarcode || p.categoria) && (
          <span className="text-muted-foreground truncate text-xs">
            {porBarcode ? (
              <>
                Código de barras <Resaltado texto={p.barcode!} consulta={consulta} codigo />
              </>
            ) : (
              p.categoria
            )}
          </span>
        )}
      </span>
      <span className="flex shrink-0 flex-col items-end">
        {!sinPrecio && <span className="tnum font-medium">{money(p.precio)}</span>}
        <span className="text-muted-foreground text-xs">
          {resultado.veces ? `${resultado.veces}× · ` : ""}
          {p.unidad ?? ""}
        </span>
      </span>
    </>
  );
}

/** La referencia interna de Odoo, en monoespaciada para que se lea dígito a dígito. */
export function CodigoProducto({
  codigo,
  consulta = "",
  destacado = false,
  className,
}: {
  codigo: string;
  consulta?: string;
  destacado?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "shrink-0 rounded border px-1.5 py-px font-mono text-xs",
        destacado ? "border-primary/50 bg-primary/10 text-primary" : "bg-muted/60 text-foreground",
        className,
      )}
    >
      <Resaltado texto={codigo} consulta={consulta} codigo />
    </span>
  );
}
