"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import * as acciones from "@/app/(app)/almacen/acciones";
import type { Almacen } from "@/lib/almacenes";
import { compactar } from "@/lib/busqueda-inteligente";
import { espesorTexto } from "@/lib/cortes/catalogo";
import { money } from "@/lib/formato";
import { TIPOS_INGRESO, type AccesorioInventario, type PlanchaInventario, type TipoIngreso } from "@/lib/inventario";
import type { ClienteOdoo } from "@/lib/odoo/tipos";
import { ComboBusqueda, type Opcion } from "@/components/cotizaciones/combo-busqueda";
import { Button } from "@/components/ui/button";
import { Campo, Opciones } from "@/components/ui/campo";
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
import { SelectorAlmacen, cantidad as fmt, leerPrecio } from "./comun";

/** Un producto que se puede ingresar: una plancha o un accesorio del almacén que existe en Odoo. */
interface Ingresable {
  productoId: number;
  codigo: string;
  /** "Acrílico ECO · Cristal · 3 mm · 122×183" o el nombre del accesorio. */
  titulo: string;
  precio: number | null;
  porAlmacen: Record<string, number>;
}

interface Fila extends Ingresable {
  cantidad: string;
  costo: string;
}

const entero = (t: string) => {
  const v = Number(t.trim());
  return t.trim() && Number.isInteger(v) && v >= 0 && v <= 99_999 ? v : null;
};

/** Los productos del almacén que se pueden ingresar, con lo que se busca en cada uno. */
export function ingresables(planchas: PlanchaInventario[], accesorios: AccesorioInventario[]): Ingresable[] {
  const desde = (p: { productoId: number | null; codigo: string; precio: number | null; stock: { porAlmacen: Record<string, number> } | null }, titulo: string) =>
    p.productoId ? [{ productoId: p.productoId, codigo: p.codigo, titulo, precio: p.precio, porAlmacen: p.stock?.porAlmacen ?? {} }] : [];
  return [
    ...planchas
      .filter((p) => p.activo)
      .flatMap((p) => desde(p, `${p.material} · ${p.color} · ${espesorTexto(p.espesorMm)} · ${p.formato}`)),
    ...accesorios.filter((a) => a.activo).flatMap((a) => desde(a, a.nombre)),
  ];
}

/**
 * Meter stock a un almacén. Una **compra**: llegó mercadería del proveedor, con
 * su guía o factura y el costo de cada producto; en Odoo es una recepción. Un
 * **ajuste**: se contó y se pone lo que hay; en Odoo es un ajuste de inventario.
 * Siempre en unidades enteras.
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
  const [tipo, setTipo] = useState<TipoIngreso>("compra");
  const [almacenId, setAlmacenId] = useState<string | null>(null);
  const [proveedor, setProveedor] = useState<ClienteOdoo | null>(null);
  const [documento, setDocumento] = useState("");
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
          setFilas((fs) => [...fs, { ...p, cantidad: "", costo: "" }]);
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

  const total = filas.reduce((t, f) => t + (entero(f.cantidad) ?? 0) * (leerPrecio(f.costo) ?? 0), 0);

  const registrar = () => {
    if (!almacenId) return setError("Elige el almacén.");
    if (tipo === "compra" && !proveedor) return setError("Elige el proveedor de la compra.");
    if (filas.length === 0) return setError("Agrega al menos un producto.");
    for (const f of filas) {
      const n = entero(f.cantidad);
      if (n === null || (tipo === "compra" && n === 0)) return setError(`Escribe cuántas unidades de ${f.codigo} (un número entero).`);
      if (tipo === "compra" && leerPrecio(f.costo) === null) return setError(`Escribe el costo de una unidad de ${f.codigo}.`);
    }
    iniciar(async () => {
      const r = await acciones.registrarIngreso({
        tipo,
        almacenId,
        proveedorId: tipo === "compra" ? proveedor!.id : null,
        proveedorNombre: tipo === "compra" ? proveedor!.nombre : null,
        documento,
        nota,
        lineas: filas.map((f) => ({
          productoId: f.productoId,
          cantidad: entero(f.cantidad)!,
          costo: tipo === "compra" ? leerPrecio(f.costo) : null,
        })),
      });
      if (!r.ok) return setError(r.error);
      if (r.aviso) toast.warning(`${r.codigo} registrado`, { description: r.aviso, duration: 12_000 });
      else toast.success(`${r.codigo} registrado`, { description: tipo === "compra" ? "La recepción ya está en Odoo." : "El inventario ya está en Odoo." });
      alCerrar();
    });
  };

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && alCerrar()}>
      <DialogContent className="flex max-h-[92dvh] flex-col gap-0 p-0 sm:max-w-3xl">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>Ingresar stock</DialogTitle>
          <DialogDescription>
            Una compra suma lo que llegó del proveedor. Un ajuste pone lo que contaste: lo que había se reemplaza.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 overflow-y-auto px-5 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo grupo label="Tipo de ingreso">
              <Opciones
                valores={[tipo]}
                onToggle={(v) => {
                  setTipo(v as TipoIngreso);
                  setError(null);
                }}
                opciones={Object.entries(TIPOS_INGRESO).map(([valor, label]) => ({ valor, label }))}
              />
            </Campo>
            <Campo grupo label="Almacén" requerido>
              <SelectorAlmacen almacenes={almacenes} valor={almacenId} alCambiar={setAlmacenId} />
            </Campo>
          </div>

          {tipo === "compra" && (
            <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
              <BuscadorProveedor proveedor={proveedor} alElegir={setProveedor} />
              <Campo label="Guía o factura">
                <Input value={documento} onChange={(e) => setDocumento(e.target.value)} maxLength={60} placeholder="F001-000123" />
              </Campo>
            </div>
          )}

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
                          {tipo === "ajuste" && entero(f.cantidad) !== null && ` · queda en ${entero(f.cantidad)}`}
                        </p>
                      )}
                    </div>
                    <Campo label={tipo === "compra" ? "Llegaron" : "Contaste"} className="w-24">
                      <Input
                        inputMode="numeric"
                        value={f.cantidad}
                        onChange={(e) => cambiar(i, { cantidad: e.target.value })}
                        className="tnum"
                      />
                    </Campo>
                    {tipo === "compra" && (
                      <Campo label="Costo c/u (S/)" className="w-28">
                        <Input
                          inputMode="decimal"
                          value={f.costo}
                          onChange={(e) => cambiar(i, { costo: e.target.value })}
                          className="tnum"
                        />
                      </Campo>
                    )}
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
            {tipo === "compra" && total > 0 && <> · <span className="tnum text-foreground font-medium">{money(total)}</span></>}
          </p>
          <DialogClose render={<Button variant="outline" type="button" className="hidden sm:inline-flex" />}>Cancelar</DialogClose>
          <Button onClick={registrar} disabled={pendiente}>
            {pendiente ? "Registrando…" : tipo === "compra" ? "Registrar compra" : "Registrar ajuste"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** El proveedor de una compra: un contacto de Odoo. */
function BuscadorProveedor({ proveedor, alElegir }: { proveedor: ClienteOdoo | null; alElegir: (p: ClienteOdoo | null) => void }) {
  const [consulta, setConsulta] = useState("");
  const [estado, setEstado] = useState<{ q: string; lista: ClienteOdoo[]; error: string | null } | null>(null);

  useEffect(() => {
    const q = consulta.trim();
    if (q.length < 2) return;
    let vigente = true;
    const t = setTimeout(async () => {
      const r = await acciones.buscarProveedores(q);
      if (!vigente) return;
      setEstado(r.ok ? { q, lista: r.proveedores, error: null } : { q, lista: [], error: r.error });
    }, 250);
    return () => {
      vigente = false;
      clearTimeout(t);
    };
  }, [consulta]);

  if (proveedor) {
    return (
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium">Proveedor</p>
        <p className="bg-muted/50 flex min-h-9 items-center gap-2 rounded-lg border px-3 text-sm">
          <span className="min-w-0 flex-1 font-medium">{proveedor.nombre}</span>
          {proveedor.documento && <span className="text-muted-foreground text-xs">{proveedor.documento}</span>}
          <Button type="button" variant="ghost" size="xs" onClick={() => alElegir(null)}>
            Cambiar
          </Button>
        </p>
      </div>
    );
  }

  const fresco = estado?.q === consulta.trim();
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-medium">
        Proveedor <span className="text-destructive">*</span>
      </p>
      <ComboBusqueda
        etiqueta="Buscar proveedor"
        placeholder="Nombre o RUC del proveedor"
        consulta={consulta}
        alEscribir={setConsulta}
        opciones={(fresco ? estado!.lista : []).map((p) => ({
          valor: String(p.id),
          alElegir: () => alElegir(p),
          contenido: (
            <span className="flex min-w-0 flex-1 items-baseline gap-2">
              <span className="min-w-0 truncate">{p.nombre}</span>
              {p.documento && <span className="text-muted-foreground ml-auto text-xs">{p.documento}</span>}
            </span>
          ),
        }))}
        cargando={consulta.trim().length >= 2 && !fresco}
        error={fresco ? estado!.error : null}
        vacio={consulta.trim().length < 2 ? "Escribe al menos dos letras." : "Ningún contacto de Odoo coincide."}
        fresco={fresco}
      />
    </div>
  );
}
