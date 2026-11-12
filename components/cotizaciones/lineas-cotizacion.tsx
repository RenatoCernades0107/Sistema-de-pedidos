"use client";

import { useState, type KeyboardEvent } from "react";
import { Minus, NotebookPen, Package, Pencil, Plus, Scissors, Trash2 } from "lucide-react";
import { MODALIDADES } from "@/lib/cortes/calcular";
import { materialDeCorte, resumenPiezas } from "@/lib/cortes/guardado";
import { money } from "@/lib/formato";
import {
  esCorte,
  esTerminado,
  subtotalDe,
  type Linea as LineaDelFormulario,
  type LineaCorte,
  type LineaCotizacion,
  type LineaTerminado,
} from "@/lib/lineas-cotizacion";
import { textoDeMedidas } from "@/lib/terminados/geometria";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CodigoProducto } from "./buscador-producto";

/**
 * Las líneas de la cotización mientras se arma. Cantidad con botones ± (en el
 * celular es lo cómodo), precio editable que arranca en el de Odoo, y un
 * detalle opcional para medidas y acabados.
 *
 * Enter en la cantidad o el precio no envía nada: devuelve el foco al buscador
 * de productos, para seguir agregando sin tocar el mouse.
 */
export function LineasCotizacion({
  lineas,
  alCambiar,
  alCambiarCantidad,
  alQuitar,
  alEditarCorte,
  alEditarTerminado,
  alTerminar,
  refCantidad,
  resaltada,
}: {
  lineas: LineaDelFormulario[];
  alCambiar: (clave: string, cambios: Partial<Pick<LineaCotizacion, "cantidad" | "precioUnitario" | "descripcion">>) => void;
  alCambiarCantidad: (clave: string, delta: number) => void;
  alQuitar: (clave: string) => void;
  /** Reabrir el editor de un corte ya agregado. */
  alEditarCorte: (clave: string) => void;
  alEditarTerminado: (clave: string) => void;
  /** Enter en un número: volver al buscador. */
  alTerminar: () => void;
  /** Para que el formulario pueda llevar el foco a la cantidad de una línea nueva. */
  refCantidad: (clave: string, el: HTMLInputElement | null) => void;
  /** La línea que acaba de cambiar, para marcarla un instante. */
  resaltada: string | null;
}) {
  if (lineas.length === 0) {
    return (
      <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center text-sm">
        Todavía no hay productos. Búscalos arriba por código o por nombre, o agrega un corte a medida.
      </p>
    );
  }

  return (
    <ol className="flex flex-col gap-2" aria-label="Productos de la cotización">
      {lineas.map((l, i) =>
        esCorte(l) ? (
          <LineaDeCorte
            key={l.clave}
            n={i + 1}
            linea={l}
            resaltada={resaltada === l.clave}
            alEditar={() => alEditarCorte(l.clave)}
            alQuitar={() => alQuitar(l.clave)}
          />
        ) : esTerminado(l) ? (
          <LineaDeTerminado
            key={l.clave}
            n={i + 1}
            linea={l}
            resaltada={resaltada === l.clave}
            alEditar={() => alEditarTerminado(l.clave)}
            alQuitar={() => alQuitar(l.clave)}
          />
        ) : (
        <Linea
          key={l.clave}
          n={i + 1}
          linea={l}
          resaltada={resaltada === l.clave}
          alCambiar={(c) => alCambiar(l.clave, c)}
          alCambiarCantidad={(d) => alCambiarCantidad(l.clave, d)}
          alQuitar={() => alQuitar(l.clave)}
          alTerminar={alTerminar}
          refCantidad={(el) => refCantidad(l.clave, el)}
        />
        ),
      )}
    </ol>
  );
}

/**
 * Un corte a medida en la lista. No se edita aquí: sus números salen de un
 * cálculo, así que cambiarlo es reabrir el editor.
 */
function LineaDeCorte({
  n,
  linea: l,
  resaltada,
  alEditar,
  alQuitar,
}: {
  n: number;
  linea: LineaCorte;
  resaltada: boolean;
  alEditar: () => void;
  alQuitar: () => void;
}) {
  const c = l.calculo;
  const nombre = `${MODALIDADES[l.modalidad]} en ${materialDeCorte(l)}`;
  const planchas = c.planchas.length;

  return (
    <li
      className={cn(
        "bg-card rounded-lg border p-3 transition-colors duration-500",
        resaltada && "border-primary/50 bg-primary/[0.04]",
      )}
      aria-label={`Línea ${n}: ${nombre}`}
    >
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="bg-brand-soft text-foreground inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium">
            <Scissors className="size-3" />
            {MODALIDADES[l.modalidad]}
          </span>
          <span className="min-w-0 text-sm font-medium">{materialDeCorte(l)}</span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Editar el corte de ${materialDeCorte(l)}`}
          onClick={alEditar}
          className="text-muted-foreground -mt-1 shrink-0"
        >
          <Pencil />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Quitar el corte de ${materialDeCorte(l)}`}
          onClick={alQuitar}
          className="text-muted-foreground -mt-1 -mr-1 shrink-0"
        >
          <Trash2 />
        </Button>
      </div>

      <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 text-sm">
          <p className="tnum">{resumenPiezas(l.piezas)}</p>
          <p className="text-muted-foreground tnum mt-0.5 text-xs">
            {planchas} {planchas === 1 ? "plancha" : "planchas"} de {c.formato.ancho}×{c.formato.alto}{" "}
            <span className="font-mono">{c.formato.codigo}</span> · material {money(c.material)} + corte{" "}
            {money(c.servicio)}
          </p>
          {c.problema && <p className="text-destructive mt-1 text-xs">{c.problema}</p>}
        </div>
        <div className="ml-auto flex flex-col items-end gap-1">
          <span className="text-muted-foreground text-xs">Subtotal</span>
          <span className="tnum h-8 text-sm leading-8 font-semibold">{money(c.total)}</span>
        </div>
      </div>
    </li>
  );
}

/**
 * Un producto terminado en la lista. Como el corte, no se edita aquí: se reabre
 * su editor.
 */
function LineaDeTerminado({
  n,
  linea: l,
  resaltada,
  alEditar,
  alQuitar,
}: {
  n: number;
  linea: LineaTerminado;
  resaltada: boolean;
  alEditar: () => void;
  alQuitar: () => void;
}) {
  const ficha = [textoDeMedidas(l.medidas), l.materialTexto, ...l.opcionesTexto].filter(Boolean).join(" · ");
  const c = l.calculo;

  return (
    <li
      className={cn(
        "bg-card rounded-lg border p-3 transition-colors duration-500",
        resaltada && "border-primary/50 bg-primary/[0.04]",
      )}
      aria-label={`Línea ${n}: ${l.nombre}`}
    >
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="bg-brand-soft text-foreground inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium">
            <Package className="size-3" />
            {l.productoCodigo ? "Producto terminado" : "Personalizado"}
          </span>
          {l.productoCodigo && <CodigoProducto codigo={l.productoCodigo} />}
          <span className="min-w-0 text-sm font-medium">{l.nombre}</span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Editar ${l.nombre}`}
          onClick={alEditar}
          className="text-muted-foreground -mt-1 shrink-0"
        >
          <Pencil />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Quitar ${l.nombre}`}
          onClick={alQuitar}
          className="text-muted-foreground -mt-1 -mr-1 shrink-0"
        >
          <Trash2 />
        </Button>
      </div>

      <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 text-sm">
          {ficha && <p>{ficha}</p>}
          <p className="text-muted-foreground tnum mt-0.5 text-xs">
            {l.cantidad} × {money(l.precioUnitario)}
            {l.precioUnitario !== c.precioSugerido && ` (sugerido ${money(c.precioSugerido)})`} · material estimado{" "}
            {money(c.costoMaterial)}
            {l.reservar && " · se reserva"}
          </p>
        </div>
        <div className="ml-auto flex flex-col items-end gap-1">
          <span className="text-muted-foreground text-xs">Subtotal</span>
          <span className="tnum h-8 text-sm leading-8 font-semibold">{money(subtotalDe(l))}</span>
        </div>
      </div>
    </li>
  );
}

function Linea({
  n,
  linea: l,
  resaltada,
  alCambiar,
  alCambiarCantidad,
  alQuitar,
  alTerminar,
  refCantidad,
}: {
  n: number;
  linea: LineaCotizacion;
  resaltada: boolean;
  alCambiar: (c: Partial<Pick<LineaCotizacion, "cantidad" | "precioUnitario" | "descripcion">>) => void;
  alCambiarCantidad: (delta: number) => void;
  alQuitar: () => void;
  alTerminar: () => void;
  refCantidad: (el: HTMLInputElement | null) => void;
}) {
  const [conDetalle, setConDetalle] = useState(!!l.descripcion);
  const enter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      alTerminar();
    }
  };

  return (
    <li
      className={cn(
        "bg-card rounded-lg border p-3 transition-colors duration-500",
        resaltada && "border-primary/50 bg-primary/[0.04]",
      )}
      aria-label={`Línea ${n}: ${l.nombre}`}
    >
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          {l.codigo && <CodigoProducto codigo={l.codigo} />}
          <span className="min-w-0 text-sm font-medium">{l.nombre}</span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Quitar ${l.nombre}`}
          onClick={alQuitar}
          className="text-muted-foreground -mt-1 -mr-1 shrink-0"
        >
          <Trash2 />
        </Button>
      </div>

      <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs">Cantidad{l.unidad ? ` (${l.unidad})` : ""}</span>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label="Uno menos"
              onClick={() => alCambiarCantidad(-1)}
              disabled={l.cantidad <= 1}
            >
              <Minus />
            </Button>
            <NumeroEditable
              valor={l.cantidad}
              alCambiar={(cantidad) => alCambiar({ cantidad })}
              etiqueta={`Cantidad de ${l.nombre}`}
              decimales={3}
              onKeyDown={enter}
              inputRef={refCantidad}
              className="w-20 text-center"
            />
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label="Uno más"
              onClick={() => alCambiarCantidad(1)}
            >
              <Plus />
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs">Precio unitario</span>
          <div className="relative">
            <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm">
              S/
            </span>
            <NumeroEditable
              valor={l.precioUnitario}
              alCambiar={(precioUnitario) => alCambiar({ precioUnitario })}
              etiqueta={`Precio unitario de ${l.nombre}`}
              decimales={2}
              onKeyDown={enter}
              className="w-28 pl-8 text-right"
            />
          </div>
        </div>

        <div className="ml-auto flex flex-col items-end gap-1">
          <span className="text-muted-foreground text-xs">Subtotal</span>
          <span className="tnum h-8 text-sm leading-8 font-semibold">{money(subtotalDe(l))}</span>
        </div>
      </div>

      {conDetalle ? (
        <Textarea
          rows={2}
          autoFocus={!l.descripcion}
          value={l.descripcion}
          onChange={(e) => alCambiar({ descripcion: e.target.value })}
          placeholder="Medidas, acabado, color… (sale en la línea de Odoo)"
          aria-label={`Detalle de ${l.nombre}`}
          className="mt-2"
          maxLength={500}
        />
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="text-muted-foreground mt-1 -ml-2 gap-1"
          onClick={() => setConDetalle(true)}
        >
          <NotebookPen />
          Agregar detalle (medidas, acabado)
        </Button>
      )}
    </li>
  );
}

/**
 * Un número que se puede escribir a medias. Si el input fuera el número mismo,
 * "2." se convertiría en "2" a mitad de teclear y el punto se perdería. Aquí el
 * texto es local y solo sube el número cuando es válido; si el número cambia
 * desde fuera (los botones ±, o agregar otra vez el producto), el texto se pone
 * al día.
 */
function NumeroEditable({
  valor,
  alCambiar,
  etiqueta,
  decimales,
  onKeyDown,
  inputRef,
  className,
}: {
  valor: number;
  alCambiar: (n: number) => void;
  etiqueta: string;
  decimales: number;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  inputRef?: (el: HTMLInputElement | null) => void;
  className?: string;
}) {
  const [texto, setTexto] = useState(String(valor));
  const [conocido, setConocido] = useState(valor);
  if (valor !== conocido) {
    setConocido(valor);
    setTexto(String(valor));
  }

  return (
    <Input
      ref={inputRef}
      type="text"
      inputMode="decimal"
      value={texto}
      aria-label={etiqueta}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => {
        const t = e.target.value.replace(",", ".");
        if (!new RegExp(`^\\d*(\\.\\d{0,${decimales}})?$`).test(t)) return;
        setTexto(t);
        const n = Number(t);
        if (t !== "" && Number.isFinite(n)) {
          setConocido(n);
          alCambiar(n);
        }
      }}
      onBlur={() => {
        // Lo que quedó a medias ("", "2.") vuelve a ser el número de verdad.
        setTexto(String(valor));
      }}
      onKeyDown={onKeyDown}
      className={cn("tnum h-8", className)}
    />
  );
}
