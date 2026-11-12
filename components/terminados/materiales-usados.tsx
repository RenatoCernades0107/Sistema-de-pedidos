"use client";

import { useState } from "react";
import { Package, X } from "lucide-react";
import type { Resultado } from "@/app/(app)/acciones";
import type { LineaDePedido } from "@/lib/pedido-lineas";
import type { ProductoOdoo } from "@/lib/odoo/tipos";
import { materialesADescontar, tituloTerminado } from "@/lib/terminados/guardado";
import { BuscadorProducto } from "@/components/cotizaciones/buscador-producto";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type MaterialesAnotados = { posicion: number; usados: { productoId: number; cantidad: number }[] }[];

interface Fila {
  productoId: number;
  codigo: string | null;
  nombre: string;
  unidad: string | null;
  cantidad: string;
}

const n = (x: number) => String(+x.toFixed(3));

/** Lo escrito, si es una cantidad válida (hasta 3 decimales). */
function leer(texto: string): number | null {
  const limpio = texto.trim().replace(",", ".");
  if (!limpio) return null;
  const v = Number(limpio);
  if (!Number.isFinite(v) || v < 0 || v > 99_999) return null;
  return Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6 ? v : null;
}

/**
 * Lo que de verdad se usó en cada producto terminado: planchas, accesorios y
 * cualquier otro material del almacén. Llega puesto con lo anotado o, si nadie
 * anotó, con lo que se estimó al cotizar; se corrige, se quita o se agrega.
 *
 * Es lo que se descuenta del stock en Odoo. Lo abre el botón "Listo"
 * (`alPasarAListo`) y el detalle del pedido, que solo lo anota.
 */
export function DialogoMateriales({
  abierto,
  alCambiar,
  terminados,
  alPasarAListo,
  siguePlanchas,
  pendiente,
  alConfirmar,
}: {
  abierto: boolean;
  alCambiar: (abierto: boolean) => void;
  terminados: LineaDePedido[];
  alPasarAListo?: boolean;
  /** Después vienen las planchas de los cortes: este paso no cierra el pedido todavía. */
  siguePlanchas?: boolean;
  pendiente: boolean;
  alConfirmar: (materiales: MaterialesAnotados) => Promise<Resultado> | void;
}) {
  return (
    <Dialog open={abierto} onOpenChange={alCambiar} triggerId={null}>
      <DialogContent className="flex max-h-[92dvh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{alPasarAListo ? "Pasar a Listo: materiales usados" : "Materiales usados"}</DialogTitle>
          <DialogDescription>
            {alPasarAListo
              ? "Confirma lo que de verdad se usó en cada producto terminado: eso es lo que se descuenta del stock en Odoo."
              : "Lo que se descontará del stock en Odoo cuando el pedido pase a Listo."}
          </DialogDescription>
        </DialogHeader>
        {/* Se monta al abrir: así cada vez llega con lo último anotado. */}
        {abierto && (
          <Formulario
            terminados={terminados}
            etiqueta={siguePlanchas ? "Siguiente" : alPasarAListo ? "Pasar a Listo" : "Guardar"}
            pendiente={pendiente}
            alConfirmar={async (materiales) => {
              const r = await alConfirmar(materiales);
              if (!r || r.ok) alCambiar(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Formulario({
  terminados,
  etiqueta,
  pendiente,
  alConfirmar,
}: {
  terminados: LineaDePedido[];
  etiqueta: string;
  pendiente: boolean;
  alConfirmar: (materiales: MaterialesAnotados) => Promise<void>;
}) {
  const [filas, setFilas] = useState<Fila[][]>(() =>
    terminados.map((l) =>
      materialesADescontar(l.terminado!, l.materialesUsados).map((m) => ({ ...m, cantidad: n(m.cantidad) })),
    ),
  );
  const [error, setError] = useState<string | null>(null);

  const cambiar = (i: number, hacer: (lista: Fila[]) => Fila[]) => {
    setError(null);
    setFilas((prev) => prev.map((lista, j) => (j === i ? hacer(lista) : lista)));
  };

  const agregar = (i: number, p: ProductoOdoo) =>
    cambiar(i, (lista) =>
      lista.some((f) => f.productoId === p.id)
        ? lista
        : [...lista, { productoId: p.id, codigo: p.codigo, nombre: p.nombre, unidad: p.unidad, cantidad: "1" }],
    );

  const enviar = (e: React.FormEvent) => {
    e.preventDefault();
    const materiales: MaterialesAnotados = [];
    for (const [i, l] of terminados.entries()) {
      const usados = [];
      for (const f of filas[i]) {
        const cantidad = leer(f.cantidad);
        if (cantidad === null) return setError(`Revisa la cantidad de ${f.nombre}: un número, con hasta 3 decimales.`);
        if (cantidad > 0) usados.push({ productoId: f.productoId, cantidad });
      }
      materiales.push({ posicion: l.posicion, usados });
    }
    void alConfirmar(materiales);
  };

  return (
    <form onSubmit={enviar} className="flex min-h-0 flex-col gap-4" noValidate>
      <ul className="flex flex-col gap-3 overflow-y-auto">
        {terminados.map((l, i) => (
          <li key={l.posicion} className="flex items-start gap-3 rounded-lg border p-3">
            <Package className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <p className="text-sm font-medium">
                <span className="tnum">{n(l.cantidad)} ×</span> {tituloTerminado(l.terminado!)}
              </p>
              {filas[i].length === 0 && (
                <p className="text-muted-foreground text-xs">Sin materiales: no se descuenta nada del almacén.</p>
              )}
              {filas[i].map((f) => (
                <div key={f.productoId} className="flex items-center gap-2 text-sm">
                  {f.codigo && <span className="shrink-0 font-mono text-xs">{f.codigo}</span>}
                  <span className="min-w-0 flex-1 truncate">{f.nombre}</span>
                  <Input
                    inputMode="decimal"
                    aria-label={`Cantidad usada de ${f.nombre}`}
                    className="tnum h-8 w-24 text-right"
                    value={f.cantidad}
                    onChange={(e) =>
                      cambiar(i, (lista) =>
                        lista.map((x) => (x.productoId === f.productoId ? { ...x, cantidad: e.target.value } : x)),
                      )
                    }
                  />
                  <span className="text-muted-foreground w-14 text-xs">{f.unidad ?? "un"}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Quitar ${f.nombre}`}
                    onClick={() => cambiar(i, (lista) => lista.filter((x) => x.productoId !== f.productoId))}
                  >
                    <X />
                  </Button>
                </div>
              ))}
              <BuscadorProducto
                alAgregar={(p) => agregar(i, p)}
                ruta="/api/terminados/materiales"
                sinPrecio
                etiqueta={`Agregar material usado en ${l.terminado!.nombre}`}
              />
            </div>
          </li>
        ))}
      </ul>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      <DialogFooter>
        <DialogClose render={<Button variant="outline" type="button" />}>Cancelar</DialogClose>
        <Button type="submit" disabled={pendiente}>
          {pendiente ? "Guardando…" : etiqueta}
        </Button>
      </DialogFooter>
    </form>
  );
}
