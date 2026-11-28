"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import * as acciones from "@/app/(app)/almacen/acciones";
import type { Almacen } from "@/lib/almacenes";
import { compactar } from "@/lib/busqueda-inteligente";
import type { Ingresable } from "@/lib/inventario";

export { ingresables, type Ingresable } from "@/lib/inventario";
import { ComboBusqueda, type Opcion } from "@/components/cotizaciones/combo-busqueda";
import { Button } from "@/components/ui/button";
import { Campo } from "@/components/ui/campo";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SelectorAlmacen, cantidad as fmt } from "./comun";

interface Fila extends Ingresable {
  cantidad: string;
}

const entero = (t: string) => {
  const v = Number(t.trim());
  return t.trim() && Number.isInteger(v) && v >= 0 && v <= 99_999 ? v : null;
};

/**
 * Un ajuste de inventario: se contó y se pone lo que hay; en Odoo es un ajuste
 * de inventario. Siempre en unidades enteras.
 *
 * Las compras ya no entran por aquí: se registran en `/compras` (orden de compra
 * en Odoo) y Almacén las recibe con "Recibir compra".
 */
export function DialogoIngreso({
  almacenes,
  productos,
  alCerrar,
}: {
  almacenes: Almacen[];
  productos: Ingresable[];
  alCerrar: () => void;
}) {
  const tipo = "ajuste" as const;
  const [almacenId, setAlmacenId] = useState<string | null>(null);
  const [nota, setNota] = useState("");
  const [filas, setFilas] = useState<Fila[]>([]);
  const [consulta, setConsulta] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  const opciones: Opcion[] = useMemo(() => {
    const palabras = consulta.split(/\s+/).map(compactar).filter(Boolean);
    if (palabras.length === 0) return [];
    return productos
      .filter((p) => !filas.some((f) => f.productoId === p.productoId))
      .filter((p) => {
        const donde = compactar(`${p.codigo} ${p.titulo}`);
        return palabras.every((x) => donde.includes(x));
      })
      .slice(0, 12)
      .map((p) => ({
        valor: String(p.productoId),
        alElegir: () => {
          setFilas((fs) => [...fs, { ...p, cantidad: "" }]);
          setConsulta("");
          setError(null);
        },
        contenido: (
          <span className="flex min-w-0 flex-1 items-baseline gap-2">
            <span className="text-muted-foreground font-mono text-xs">{p.codigo}</span>
            <span className="min-w-0 truncate">{p.titulo}</span>
          </span>
        ),
      }));
  }, [productos, consulta, filas]);

  const cambiar = (i: number, cambios: Partial<Fila>) => {
    setFilas((fs) => fs.map((f, j) => (j === i ? { ...f, ...cambios } : f)));
    setError(null);
  };

  const registrar = () => {
    if (!almacenId) return setError("Elige el almacén.");
    if (filas.length === 0) return setError("Agrega al menos un producto.");
    for (const f of filas) {
      const n = entero(f.cantidad);
      if (n === null) return setError(`Escribe cuántas unidades de ${f.codigo} (un número entero).`);
    }
    iniciar(async () => {
      const r = await acciones.registrarIngreso({
        tipo,
        almacenId,
        proveedorId: null,
        proveedorNombre: null,
        documento: null,
        nota,
        lineas: filas.map((f) => ({
          productoId: f.productoId,
          cantidad: entero(f.cantidad)!,
          costo: null,
        })),
      });
      if (!r.ok) return setError(r.error);
      if (r.aviso) toast.warning(`${r.codigo} registrado`, { description: r.aviso, duration: 12_000 });
      else toast.success(`${r.codigo} registrado`, { description: "El inventario ya está en Odoo." });
      alCerrar();
    });
  };

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && alCerrar()}>
      <DialogContent className="flex max-h-[92dvh] flex-col gap-0 p-0 sm:max-w-3xl">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>Ajustar inventario</DialogTitle>
          <DialogDescription>
            Pone lo que contaste: lo que había se reemplaza. Una compra se recibe con “Recibir compra”.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 overflow-y-auto px-5 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo grupo label="Almacén" requerido>
              <SelectorAlmacen almacenes={almacenes} valor={almacenId} alCambiar={setAlmacenId} />
            </Campo>
          </div>


          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium">Productos</p>
            <ComboBusqueda
              etiqueta="Buscar plancha o accesorio"
              placeholder="Código o nombre: F7E024, eco cristal 3, bisagra…"
              consulta={consulta}
              alEscribir={setConsulta}
              opciones={opciones}
              cargando={false}
              error={null}
              vacio={consulta.trim() ? "Ningún producto del almacén coincide. Si es nuevo, créalo primero." : "Escribe para buscar."}
              fresco
              enLinea
            />
          </div>

          {filas.length > 0 && (
            <ul className="divide-y rounded-xl border" aria-label="Productos del ingreso">
              {filas.map((f, i) => {
                const hay = almacenId ? (f.porAlmacen[almacenId] ?? 0) : null;
                return (
                  <li key={f.productoId} className="flex flex-wrap items-end gap-2 px-3 py-2.5">
                    <div className="min-w-0 flex-1 basis-56">
                      <p className="text-sm">
                        <span className="text-muted-foreground mr-2 font-mono text-xs">{f.codigo}</span>
                        {f.titulo}
                      </p>
                      {hay !== null && (
                        <p className="text-muted-foreground mt-0.5 text-xs">
                          Hoy hay {fmt(hay)} en este almacén
                          {entero(f.cantidad) !== null && ` · queda en ${entero(f.cantidad)}`}
                        </p>
                      )}
                    </div>
                    <Campo label="Contaste" className="w-24">
                      <Input
                        inputMode="numeric"
                        value={f.cantidad}
                        onChange={(e) => cambiar(i, { cantidad: e.target.value })}
                        className="tnum"
                      />
                    </Campo>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Quitar ${f.codigo}`}
                      onClick={() => setFilas((fs) => fs.filter((_, j) => j !== i))}
                      className="text-muted-foreground mb-0.5"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}

          <Campo label="Nota">
            <Textarea value={nota} onChange={(e) => setNota(e.target.value)} maxLength={500} rows={2} />
          </Campo>
          {error && <p className="text-destructive text-sm" role="alert">{error}</p>}
        </div>

        <DialogFooter className="m-0 flex-row items-center border-t px-5 py-3">
          <p className="text-muted-foreground min-w-0 flex-1 text-xs">
            {filas.length} {filas.length === 1 ? "producto" : "productos"}
          </p>
          <DialogClose render={<Button variant="outline" type="button" className="hidden sm:inline-flex" />}>Cancelar</DialogClose>
          <Button onClick={registrar} disabled={pendiente}>
            {pendiente ? "Registrando…" : "Registrar ajuste"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
