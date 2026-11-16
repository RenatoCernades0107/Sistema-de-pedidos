"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Pencil, Plus, Search, Tags } from "lucide-react";
import * as acciones from "@/app/(app)/almacen/acciones";
import type { Almacen } from "@/lib/almacenes";
import { compactar } from "@/lib/busqueda-inteligente";
import { money } from "@/lib/formato";
import type { AccesorioInventario, CategoriaAccesorio } from "@/lib/inventario";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Campo } from "@/components/ui/campo";
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
import { CeldasStock, DialogoPrecio, EncabezadosStock, type PermisosAlmacen } from "./comun";

const TODAS = "__todas";

/** Para elegir una categoría. */
function SelectorCategoria({
  categorias,
  valor,
  alCambiar,
  conTodas,
  etiqueta = "Categoría",
  className,
}: {
  categorias: CategoriaAccesorio[];
  valor: string | null;
  alCambiar: (id: string | null) => void;
  conTodas?: boolean;
  etiqueta?: string;
  className?: string;
}) {
  const elegida = categorias.find((c) => c.id === valor);
  return (
    <Select value={valor ?? (conTodas ? TODAS : null)} onValueChange={(v) => alCambiar(v === TODAS || !v ? null : v)}>
      <SelectTrigger aria-label={etiqueta} className={className ?? "w-full"}>
        <SelectValue>{elegida ? elegida.nombre : conTodas ? "Categoría: todas" : "Elige la categoría"}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {conTodas && <SelectItem value={TODAS}>Categoría: todas</SelectItem>}
        {categorias.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.nombre}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Los accesorios (bisagras, tornillos, adhesivos…) con su stock en cada
 * almacén, agrupados por su categoría. La categoría es de la app: Odoo no la tiene.
 */
export function TablaAccesorios({
  accesorios,
  categorias,
  almacenes,
  permisos,
  conFuera,
}: {
  accesorios: AccesorioInventario[];
  categorias: CategoriaAccesorio[];
  almacenes: Almacen[];
  permisos: PermisosAlmacen;
  conFuera: boolean;
}) {
  const [texto, setTexto] = useState("");
  const [categoria, setCategoria] = useState<string | null>(null);
  const [conStock, setConStock] = useState(false);
  const [preciando, setPreciando] = useState<AccesorioInventario | null>(null);
  const [agregando, setAgregando] = useState(false);
  const [editandoCategorias, setEditandoCategorias] = useState(false);
  const [, iniciar] = useTransition();
  const activos = almacenes.filter((a) => a.activo);

  const visibles = useMemo(() => {
    const palabras = texto.split(/\s+/).map(compactar).filter(Boolean);
    return accesorios.filter((a) => {
      if (!a.activo) return false;
      if (categoria && a.categoriaId !== categoria) return false;
      if (conStock && !(a.stock && a.stock.total > 0)) return false;
      const donde = compactar(`${a.codigo} ${a.nombre} ${a.categoria}`);
      return palabras.every((p) => donde.includes(p));
    });
  }, [accesorios, texto, categoria, conStock]);

  const porCategoria = useMemo(
    () =>
      categorias
        .map((c) => [c, visibles.filter((a) => a.categoriaId === c.id)] as const)
        .filter(([, lista]) => lista.length > 0),
    [categorias, visibles],
  );

  const moverDeCategoria = (a: AccesorioInventario, categoriaId: string) =>
    iniciar(async () => {
      const r = await acciones.cambiarCategoriaDeAccesorio(a.id, categoriaId);
      if (!r.ok) toast.error("No se cambió la categoría", { description: r.error });
    });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative min-w-0 sm:min-w-56 sm:flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            aria-label="Buscar accesorio"
            placeholder="Código o nombre: bisagra 30"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            className="pl-9"
          />
        </div>
        <SelectorCategoria categorias={categorias} valor={categoria} alCambiar={setCategoria} conTodas className="w-full sm:w-52" />
        {permisos.gestionarStock && (
          <div className="flex gap-2">
            <Button variant="outline" className="gap-1.5" onClick={() => setEditandoCategorias(true)}>
              <Tags className="size-4" />
              Categorías
            </Button>
            <Button variant="outline" className="gap-1.5" onClick={() => setAgregando(true)}>
              <Plus className="size-4" />
              Uno que ya está en Odoo
            </Button>
          </div>
        )}
      </div>
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <label className="flex cursor-pointer items-center gap-2">
          <Checkbox checked={conStock} onCheckedChange={(v) => setConStock(v === true)} />
          Solo con stock
        </label>
        <span aria-live="polite">
          {visibles.length} de {accesorios.filter((a) => a.activo).length} accesorios
        </span>
      </div>

      {porCategoria.length === 0 && (
        <p className="text-muted-foreground rounded-xl border border-dashed px-4 py-8 text-center text-sm">
          Ningún accesorio coincide.
        </p>
      )}

      {porCategoria.map(([c, lista]) => (
        <section key={c.id} className="bg-card overflow-hidden rounded-xl border">
          <header className="bg-muted/40 flex flex-wrap items-baseline gap-x-3 border-b px-4 py-2.5">
            <h2 className="text-sm font-medium">{c.nombre}</h2>
            <span className="text-muted-foreground text-xs">
              {lista.length} {lista.length === 1 ? "accesorio" : "accesorios"} · códigos nuevos {c.prefijo}…
            </span>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground text-left text-xs">
                  <th className="px-4 py-2 font-medium">Código</th>
                  <th className="px-2 py-2 font-medium">Accesorio</th>
                  <EncabezadosStock almacenes={activos} conFuera={conFuera} />
                  {permisos.verPrecios && <th className="px-2 py-2 text-right font-medium">Precio</th>}
                  {permisos.gestionarStock && <th className="px-2 py-2 font-medium">Categoría</th>}
                  {permisos.editarPrecios && <th className="w-10" />}
                </tr>
              </thead>
              <tbody>
                {lista.map((a) => (
                  <tr key={a.id} className="border-t">
                    <td className="px-4 py-2">
                      <span className={cn("font-mono text-xs", !a.productoId && "text-destructive")}>{a.codigo}</span>
                    </td>
                    <td className="min-w-48 px-2 py-2">
                      {a.nombre}
                      {a.unidad && <span className="text-muted-foreground ml-1.5 text-xs">({a.unidad.toLowerCase()})</span>}
                    </td>
                    <CeldasStock stock={a.stock} almacenes={activos} conFuera={conFuera} />
                    {permisos.verPrecios && (
                      <td className="tnum px-2 py-2 text-right whitespace-nowrap">{a.precio === null ? "—" : money(a.precio)}</td>
                    )}
                    {permisos.gestionarStock && (
                      <td className="px-2 py-1.5">
                        <SelectorCategoria
                          categorias={categorias}
                          valor={a.categoriaId}
                          alCambiar={(id) => id && id !== a.categoriaId && moverDeCategoria(a, id)}
                          etiqueta={`Categoría de ${a.codigo}`}
                          className="h-8 w-44"
                        />
                      </td>
                    )}
                    {permisos.editarPrecios && (
                      <td className="py-1 pr-2">
                        {a.productoId && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground size-8"
                            aria-label={`Cambiar el precio de ${a.codigo}`}
                            onClick={() => setPreciando(a)}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {preciando && (
        <DialogoPrecio
          titulo={`Precio de ${preciando.codigo}`}
          descripcion={`${preciando.nombre}. Se cambia en Odoo: vale para las cotizaciones nuevas.`}
          actual={preciando.precio}
          alGuardar={(precio) => acciones.cambiarPrecio({ productoId: preciando.productoId, precio })}
          alCerrar={() => setPreciando(null)}
        />
      )}
      {agregando && <DialogoAccesorioExistente categorias={categorias} alCerrar={() => setAgregando(false)} />}
      {editandoCategorias && <DialogoCategorias categorias={categorias} alCerrar={() => setEditandoCategorias(false)} />}
    </div>
  );
}

/** Un accesorio que ya existe en Odoo con su código, para que aparezca en el almacén. */
function DialogoAccesorioExistente({ categorias, alCerrar }: { categorias: CategoriaAccesorio[]; alCerrar: () => void }) {
  const [codigo, setCodigo] = useState("");
  const [categoria, setCategoria] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  const guardar = () =>
    iniciar(async () => {
      const r = await acciones.agregarAccesorioExistente({ codigo: codigo.trim(), categoriaId: categoria });
      if (!r.ok) return setError(r.error);
      toast.success(`${codigo.trim()} agregado al almacén`);
      alCerrar();
    });

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && alCerrar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Accesorio que ya está en Odoo</DialogTitle>
          <DialogDescription>
            Escribe su código de Odoo y elige su categoría. Para uno que todavía no existe, usa «Nuevo producto».
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            guardar();
          }}
        >
          <Campo label="Código de Odoo" requerido>
            <Input autoFocus value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase())} className="font-mono" />
          </Campo>
          <Campo grupo label="Categoría" requerido>
            <SelectorCategoria categorias={categorias} valor={categoria} alCambiar={setCategoria} />
          </Campo>
          {error && <p className="text-destructive text-sm">{error}</p>}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>Cancelar</DialogClose>
            <Button type="submit" disabled={pendiente || !codigo.trim() || !categoria}>
              {pendiente ? "Agregando…" : "Agregar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Las categorías de accesorios y el prefijo con que nacen los códigos nuevos de cada una. */
function DialogoCategorias({ categorias, alCerrar }: { categorias: CategoriaAccesorio[]; alCerrar: () => void }) {
  const [filas, setFilas] = useState(() => categorias.map((c) => ({ id: c.id as string | null, nombre: c.nombre, prefijo: c.prefijo })));
  const [pendiente, iniciar] = useTransition();

  const guardar = () =>
    iniciar(async () => {
      for (const f of filas) {
        const original = categorias.find((c) => c.id === f.id);
        if (original && original.nombre === f.nombre.trim() && original.prefijo === f.prefijo.trim().toUpperCase()) continue;
        if (!f.id && !f.nombre.trim()) continue;
        const r = await acciones.guardarCategoria(f);
        if (!r.ok) {
          toast.error(`No se guardó ${f.nombre || "la categoría nueva"}`, { description: r.error });
          return;
        }
      }
      toast.success("Categorías guardadas");
      alCerrar();
    });

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && alCerrar()}>
      <DialogContent className="flex max-h-[92dvh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Categorías de accesorios</DialogTitle>
          <DialogDescription>
            El prefijo es con lo que empieza el código de un accesorio nuevo de esa categoría (ACC055, PEG020): la app
            sigue el número que ya tiene Odoo.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 overflow-y-auto">
          {filas.map((f, i) => (
            <div key={f.id ?? `nueva-${i}`} className="grid grid-cols-[1fr_6rem] gap-2">
              <Input
                aria-label="Nombre de la categoría"
                value={f.nombre}
                placeholder="Bisagras"
                onChange={(e) => setFilas((fs) => fs.map((x, j) => (j === i ? { ...x, nombre: e.target.value } : x)))}
              />
              <Input
                aria-label="Prefijo de los códigos"
                value={f.prefijo}
                placeholder="ACC"
                maxLength={5}
                onChange={(e) =>
                  setFilas((fs) => fs.map((x, j) => (j === i ? { ...x, prefijo: e.target.value.toUpperCase() } : x)))
                }
                className="font-mono"
              />
            </div>
          ))}
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setFilas((fs) => [...fs, { id: null, nombre: "", prefijo: "ACC" }])}
            >
              <Plus className="size-3.5" />
              Agregar categoría
            </Button>
          </div>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" type="button" />}>Cancelar</DialogClose>
          <Button onClick={guardar} disabled={pendiente}>
            {pendiente ? "Guardando…" : "Guardar categorías"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
