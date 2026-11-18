"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CircleAlert, Plus } from "lucide-react";
import * as acciones from "@/app/(app)/almacen/acciones";
import { TIPOS_ALMACEN, type Almacen, type TipoAlmacen } from "@/lib/almacenes";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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

interface FilaAlmacen {
  id: string | null;
  nombre: string;
  codigo: string;
  tipo: TipoAlmacen;
  activo: boolean;
  enOdoo: boolean;
  error: string | null;
}

/**
 * Los almacenes: su nombre, su código corto en Odoo (AND, CAT) y su papel. El
 * taller es donde se corta láser y se fabrican los productos terminados; la
 * tienda, donde se hacen algunos cortes manuales. Uno nuevo se crea en Odoo al guardarlo.
 */
export function DialogoAlmacenes({ almacenes, alCerrar }: { almacenes: Almacen[]; alCerrar: () => void }) {
  const [filas, setFilas] = useState<FilaAlmacen[]>(() =>
    almacenes.map((a) => ({
      id: a.id,
      nombre: a.nombre,
      codigo: a.codigo,
      tipo: a.tipo,
      activo: a.activo,
      enOdoo: !!a.odooWarehouseId,
      error: a.sincronizacion === "error" ? a.errorSincronizacion : null,
    })),
  );
  const [pendiente, iniciar] = useTransition();

  const cambiar = (i: number, cambios: Partial<FilaAlmacen>) =>
    setFilas((fs) => fs.map((f, j) => (j === i ? { ...f, ...cambios } : f)));

  const guardar = () =>
    iniciar(async () => {
      // Primero los que dejan de ser taller o tienda: así otro puede tomar ese papel.
      const orden = [...filas].sort((a, b) => Number(a.tipo !== "deposito") - Number(b.tipo !== "deposito"));
      for (const f of orden) {
        const original = almacenes.find((a) => a.id === f.id);
        const igual =
          original &&
          original.nombre === f.nombre.trim() &&
          original.codigo === f.codigo.trim().toUpperCase() &&
          original.tipo === f.tipo &&
          original.activo === f.activo &&
          (original.odooWarehouseId || !original.activo);
        if (igual) continue;
        if (!f.id && !f.nombre.trim()) continue;
        const r = await acciones.guardarAlmacen({ ...f, codigo: f.codigo.trim().toUpperCase() });
        if (!r.ok) {
          toast.error(`No se guardó ${f.nombre || "el almacén nuevo"}`, { description: r.error });
          return;
        }
        if (r.aviso) toast.warning(f.nombre, { description: r.aviso, duration: 12_000 });
      }
      toast.success("Almacenes guardados");
      alCerrar();
    });

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && alCerrar()}>
      <DialogContent className="flex max-h-[92dvh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Almacenes</DialogTitle>
          <DialogDescription>
            Cada almacén es un almacén de Odoo. El código corto (hasta 5 letras) no cambia una vez creado. Solo puede
            haber un taller y una tienda.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 overflow-y-auto">
          {filas.map((f, i) => (
            <div key={f.id ?? `nuevo-${i}`} className="flex flex-col gap-1 rounded-lg border p-2.5">
              <div className="grid grid-cols-2 items-center gap-2 sm:grid-cols-[1fr_5.5rem_8rem_auto]">
                <Input
                  aria-label="Nombre del almacén"
                  value={f.nombre}
                  placeholder="Esmeraldas"
                  onChange={(e) => cambiar(i, { nombre: e.target.value })}
                  className="col-span-2 sm:col-span-1"
                />
                <Input
                  aria-label="Código corto en Odoo"
                  value={f.codigo}
                  placeholder="ESM"
                  maxLength={5}
                  disabled={f.enOdoo}
                  onChange={(e) => cambiar(i, { codigo: e.target.value.toUpperCase() })}
                  className="font-mono"
                />
                <Select value={f.tipo} onValueChange={(v) => v && cambiar(i, { tipo: v as TipoAlmacen })}>
                  <SelectTrigger aria-label="Papel del almacén" className="w-full">
                    <SelectValue>{TIPOS_ALMACEN[f.tipo]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(TIPOS_ALMACEN).map(([valor, label]) => (
                      <SelectItem key={valor} value={valor}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <label className="flex cursor-pointer items-center gap-2 text-xs">
                  <Checkbox checked={f.activo} onCheckedChange={(v) => cambiar(i, { activo: v === true })} />
                  Activo
                </label>
              </div>
              <p className="text-muted-foreground text-xs">
                {f.enOdoo ? "En Odoo." : f.id ? "Todavía no está en Odoo: se crea al guardar." : "Se crea en Odoo al guardar."}
              </p>
              {f.error && (
                <p className="text-destructive flex gap-1.5 text-xs">
                  <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                  {f.error}
                </p>
              )}
            </div>
          ))}
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() =>
                setFilas((fs) => [...fs, { id: null, nombre: "", codigo: "", tipo: "deposito", activo: true, enOdoo: false, error: null }])
              }
            >
              <Plus className="size-3.5" />
              Agregar almacén
            </Button>
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" type="button" />}>Cancelar</DialogClose>
          <Button onClick={guardar} disabled={pendiente}>
            {pendiente ? "Guardando…" : "Guardar almacenes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
