"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { TIPOS_ALMACEN, type Almacen } from "@/lib/almacenes";
import { money } from "@/lib/formato";
import { Button } from "@/components/ui/button";
import { Campo } from "@/components/ui/campo";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Lo que puede hacer quien mira el almacén. */
export interface PermisosAlmacen {
  /** Ingresar stock, crear productos y almacenes, registrar sobrantes a mano. */
  gestionarStock: boolean;
  /** Cambiar precios de venta (Administración). */
  editarPrecios: boolean;
  /** Ver los precios (Administración y Logística). */
  verPrecios: boolean;
}

/** Una cantidad del almacén: sin decimales de más. */
export const cantidad = (n: number) => String(+n.toFixed(2));

/** "Andahuaylas (tienda)". */
export const nombreDeAlmacen = (a: Pick<Almacen, "nombre" | "tipo">) =>
  a.tipo === "deposito" ? a.nombre : `${a.nombre} (${TIPOS_ALMACEN[a.tipo].toLowerCase()})`;

/** Para elegir uno de los almacenes activos. */
export function SelectorAlmacen({
  almacenes,
  valor,
  alCambiar,
  etiqueta = "Almacén",
  className,
  disabled,
}: {
  almacenes: Almacen[];
  valor: string | null;
  alCambiar: (id: string) => void;
  etiqueta?: string;
  className?: string;
  disabled?: boolean;
}) {
  const activos = almacenes.filter((a) => a.activo);
  const elegido = activos.find((a) => a.id === valor) ?? null;
  return (
    <Select value={valor} onValueChange={(v) => v && alCambiar(v)} disabled={disabled}>
      <SelectTrigger aria-label={etiqueta} className={className ?? "w-full"}>
        <SelectValue>{elegido ? nombreDeAlmacen(elegido) : "Elige el almacén"}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {activos.map((a) => (
          <SelectItem key={a.id} value={a.id}>
            {nombreDeAlmacen(a)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Lo escrito como precio, si es válido. */
export function leerPrecio(texto: string): number | null {
  const limpio = texto.trim().replace(",", ".");
  if (!limpio) return null;
  const v = Number(limpio);
  return Number.isFinite(v) && v >= 0 && v <= 1_000_000 ? Math.round(v * 100) / 100 : null;
}

/**
 * Cambiar un precio de venta. Lo usa Administración para planchas, accesorios y
 * sobrantes; `permiteVaciar` es para el sobrante, que vacío vuelve al calculado.
 */
export function DialogoPrecio({
  titulo,
  descripcion,
  actual,
  permiteVaciar,
  alGuardar,
  alCerrar,
}: {
  titulo: string;
  descripcion: string;
  actual: number | null;
  permiteVaciar?: boolean;
  alGuardar: (precio: number | null) => Promise<{ ok: true } | { ok: false; error: string }>;
  alCerrar: () => void;
}) {
  const [texto, setTexto] = useState(actual === null ? "" : String(actual));
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();
  const precio = leerPrecio(texto);
  const vacio = !texto.trim();

  const guardar = () => {
    if (vacio && !permiteVaciar) return setError("Escribe el precio.");
    if (!vacio && precio === null) return setError("Escribe un precio válido.");
    iniciar(async () => {
      const r = await alGuardar(vacio ? null : precio);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      toast.success("Precio guardado", { description: vacio ? "Vuelve a calcularse solo." : money(precio!) });
      alCerrar();
    });
  };

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && alCerrar()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>{descripcion}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            guardar();
          }}
          className="flex flex-col gap-3"
        >
          <Campo label="Precio de venta (S/)" error={error ?? undefined} ayuda={permiteVaciar ? "Vacío: el calculado." : undefined}>
            <Input
              autoFocus
              inputMode="decimal"
              value={texto}
              onChange={(e) => {
                setTexto(e.target.value);
                setError(null);
              }}
              className="tnum"
            />
          </Campo>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>Cancelar</DialogClose>
            <Button type="submit" disabled={pendiente}>
              {pendiente ? "Guardando…" : "Guardar precio"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Las celdas de stock de una fila: una por almacén activo y el total. */
export function CeldasStock({
  stock,
  almacenes,
  conFuera,
  enCamino,
}: {
  stock: { porAlmacen: Record<string, number>; total: number; fuera: number } | null;
  almacenes: Almacen[];
  /** Si se muestra la columna de lo que está en el almacén anterior de Odoo. */
  conFuera: boolean;
  /** Lo que viene en camino a cada almacén (transferencias enviadas, sin recibir). */
  enCamino?: Record<string, number>;
}) {
  if (!stock) {
    return (
      <td colSpan={almacenes.length + 1 + (conFuera ? 1 : 0)} className="text-muted-foreground px-2 py-2 text-center text-xs">
        Sin dato de Odoo
      </td>
    );
  }
  return (
    <>
      {almacenes.map((a) => {
        const n = stock.porAlmacen[a.id] ?? 0;
        const viene = enCamino?.[a.id] ?? 0;
        return (
          <td key={a.id} className={`tnum px-2 py-2 text-right ${n === 0 ? "text-muted-foreground" : n < 0 ? "text-destructive" : ""}`}>
            {cantidad(n)}
            {viene > 0 && (
              <span className="text-st-en_transito block text-[0.68rem] leading-tight" title={`${cantidad(viene)} en camino a ${a.nombre}`}>
                +{cantidad(viene)} en camino
              </span>
            )}
          </td>
        );
      })}
      {conFuera && (
        <td className={`tnum px-2 py-2 text-right ${stock.fuera === 0 ? "text-muted-foreground" : "text-st-observado"}`}>
          {cantidad(stock.fuera)}
        </td>
      )}
      <td className="tnum px-2 py-2 text-right font-semibold">{cantidad(stock.total)}</td>
    </>
  );
}

/** Los encabezados de las columnas de stock, a juego con `CeldasStock`. */
export function EncabezadosStock({ almacenes, conFuera }: { almacenes: Almacen[]; conFuera: boolean }) {
  return (
    <>
      {almacenes.map((a) => (
        <th key={a.id} className="px-2 py-2 text-right font-medium whitespace-nowrap" title={nombreDeAlmacen(a)}>
          {a.nombre}
        </th>
      ))}
      {conFuera && (
        <th className="px-2 py-2 text-right font-medium whitespace-nowrap" title="En el almacén anterior de Odoo">
          Anterior
        </th>
      )}
      <th className="px-2 py-2 text-right font-medium">Total</th>
    </>
  );
}
