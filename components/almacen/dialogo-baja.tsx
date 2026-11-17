"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import * as acciones from "@/app/(app)/almacen/acciones";
import type { Almacen } from "@/lib/almacenes";
import { compactar } from "@/lib/busqueda-inteligente";
import { MOTIVOS_BAJA, type MotivoBaja } from "@/lib/casos";
import { medidaSobrante, type Sobrante } from "@/lib/sobrantes";
import { ComboBusqueda, type Opcion } from "@/components/cotizaciones/combo-busqueda";
import { Button } from "@/components/ui/button";
import { Campo, Opciones } from "@/components/ui/campo";
import { Checkbox } from "@/components/ui/checkbox";
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
import type { Ingresable } from "./dialogo-ingreso";

/** Con qué abre: desde un sobrante, ya elegido. */
export interface BajaInicial {
  almacenId: string;
  sobrante: string | null;
}

/**
 * Reportar algo que se rompió, vino fallado o se perdió. No cambia el stock:
 * queda un caso que Administración revisa y cierra. Administración puede
 * aplicarlo en el acto, con su razón.
 */
export function DialogoBaja({
  almacenes,
  productos,
  sobrantes,
  inicial,
  cierraCasos,
  alCerrar,
}: {
  almacenes: Almacen[];
  productos: Ingresable[];
  sobrantes: Sobrante[];
  inicial?: BajaInicial;
  cierraCasos: boolean;
  alCerrar: () => void;
}) {
  const [almacenId, setAlmacenId] = useState<string | null>(inicial?.almacenId ?? null);
  const [que, setQue] = useState<"producto" | "sobrante">(inicial?.sobrante ? "sobrante" : "producto");
  const [producto, setProducto] = useState<Ingresable | null>(null);
  const [sobrante, setSobrante] = useState<string | null>(inicial?.sobrante ?? null);
  const [cantidad, setCantidad] = useState("1");
  const [motivo, setMotivo] = useState<MotivoBaja | null>(null);
  const [descripcion, setDescripcion] = useState("");
  const [aplicar, setAplicar] = useState(false);
  const [razon, setRazon] = useState("");
  const [consulta, setConsulta] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  const opciones: Opcion[] = useMemo(() => {
    const palabras = consulta.split(/\s+/).map(compactar).filter(Boolean);
    if (palabras.length === 0) return [];
    return productos
      .filter((p) => palabras.every((x) => compactar(`${p.codigo} ${p.titulo}`).includes(x)))
      .slice(0, 12)
      .map((p) => ({
        valor: String(p.productoId),
        alElegir: () => {
          setProducto(p);
          setConsulta("");
          setError(null);
        },
        contenido: (
          <span className="flex min-w-0 flex-1 items-baseline gap-2">
            <span className="text-muted-foreground font-mono text-xs">{p.codigo}</span>
            <span className="min-w-0 truncate">{p.titulo}</span>
            {almacenId && <span className="text-muted-foreground ml-auto text-xs">hay {fmt(p.porAlmacen[almacenId] ?? 0)}</span>}
          </span>
        ),
      }));
  }, [productos, consulta, almacenId]);

  const delAlmacen = sobrantes.filter(
    (s) => s.almacenId === almacenId && (s.estado === "disponible" || s.estado === "reservado") && s.odooLotId,
  );

  const reportar = () => {
    if (!almacenId) return setError("Elige el almacén.");
    if (que === "producto" && !producto) return setError("Elige el producto.");
    if (que === "sobrante" && !sobrante) return setError("Elige el sobrante.");
    const n = que === "sobrante" ? 1 : Number(cantidad);
    if (!Number.isInteger(n) || n <= 0) return setError("La cantidad es un número entero mayor que cero.");
    if (que === "producto" && n > (producto!.porAlmacen[almacenId] ?? 0)) {
      return setError(`En ese almacén hay ${fmt(producto!.porAlmacen[almacenId] ?? 0)}: no se pueden dar de baja ${n}.`);
    }
    if (!motivo) return setError("Elige el motivo.");
    if (motivo === "otro" && !descripcion.trim()) return setError("Cuenta qué pasó.");
    if (aplicar && razon.trim().length < 5) return setError("Escribe la razón para aplicarla (al menos 5 letras).");
    const datos = {
      almacenId,
      productoId: que === "producto" ? producto!.productoId : null,
      sobrante: que === "sobrante" ? sobrante : null,
      cantidad: n,
      motivo,
      descripcion,
    };
    iniciar(async () => {
      const r = aplicar ? await acciones.reportarYAplicarBaja(datos, razon) : await acciones.reportarBaja(datos);
      if (!r.ok) return setError(r.error);
      if (r.aviso) toast.warning(`${r.codigo} reportado`, { description: r.aviso, duration: 12_000 });
      else
        toast.success(aplicar ? `${r.codigo} aplicado` : `${r.codigo} reportado`, {
          description: aplicar ? "Ya se dio de baja en Odoo." : "Administración lo revisa y lo cierra.",
        });
      alCerrar();
    });
  };

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && alCerrar()}>
      <DialogContent className="flex max-h-[92dvh] flex-col gap-0 p-0 sm:max-w-xl">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>Reportar baja</DialogTitle>
          <DialogDescription>
            Algo que se rompió, vino fallado o se perdió. El stock no cambia hasta que Administración cierra el caso.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 overflow-y-auto px-5 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo grupo label="Almacén" requerido>
              <SelectorAlmacen
                almacenes={almacenes}
                valor={almacenId}
                alCambiar={(id) => {
                  setAlmacenId(id);
                  setSobrante(null);
                  setError(null);
                }}
              />
            </Campo>
            <Campo grupo label="Qué">
              <Opciones
                valores={[que]}
                onToggle={(v) => {
                  setQue(v as "producto" | "sobrante");
                  setError(null);
                }}
                opciones={[
                  { valor: "producto", label: "Plancha o accesorio" },
                  { valor: "sobrante", label: "Sobrante" },
                ]}
              />
            </Campo>
          </div>

          {que === "producto" ? (
            producto ? (
              <div className="flex flex-wrap items-end gap-3">
                <p className="bg-muted/50 flex min-h-9 min-w-0 flex-1 basis-60 items-center gap-2 rounded-lg border px-3 text-sm">
                  <span className="text-muted-foreground font-mono text-xs">{producto.codigo}</span>
                  <span className="min-w-0 flex-1 truncate">{producto.titulo}</span>
                  <Button type="button" variant="ghost" size="xs" onClick={() => setProducto(null)}>
                    Cambiar
                  </Button>
                </p>
                <Campo label="Cantidad" className="w-24">
                  <Input inputMode="numeric" value={cantidad} onChange={(e) => setCantidad(e.target.value)} className="tnum" />
                </Campo>
                {almacenId && <p className="text-muted-foreground w-full text-xs">En ese almacén hay {fmt(producto.porAlmacen[almacenId] ?? 0)}.</p>}
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <p className="text-xs font-medium">Producto</p>
                <ComboBusqueda
                  etiqueta="Buscar plancha o accesorio"
                  placeholder="Código o nombre: F7E024, eco cristal 3, bisagra…"
                  consulta={consulta}
                  alEscribir={setConsulta}
                  opciones={opciones}
                  cargando={false}
                  error={null}
                  vacio={consulta.trim() ? "Ningún producto del almacén coincide." : "Escribe para buscar."}
                  fresco
                  enLinea
                />
              </div>
            )
          ) : !almacenId ? (
            <p className="text-muted-foreground text-xs">Elige el almacén para ver sus sobrantes.</p>
          ) : delAlmacen.length === 0 ? (
            <p className="text-muted-foreground text-xs">No hay sobrantes en ese almacén.</p>
          ) : (
            <ul className="max-h-48 divide-y overflow-y-auto rounded-xl border" aria-label="Sobrantes del almacén">
              {delAlmacen.map((s) => (
                <li key={s.codigo}>
                  <label className="hover:bg-muted/40 flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                    <input
                      type="radio"
                      name="sobrante-baja"
                      checked={sobrante === s.codigo}
                      onChange={() => setSobrante(s.codigo)}
                      aria-label={`Dar de baja ${s.codigo}`}
                    />
                    <span className="font-mono text-xs">{s.codigo}</span>
                    <span className="min-w-0 flex-1 truncate">{s.material}</span>
                    <span className="tnum text-muted-foreground text-xs">{medidaSobrante(s)} cm</span>
                  </label>
                </li>
              ))}
            </ul>
          )}

          <Campo grupo label="Motivo" requerido>
            <Opciones
              valores={motivo ? [motivo] : []}
              onToggle={(v) => {
                setMotivo(v as MotivoBaja);
                setError(null);
              }}
              opciones={Object.entries(MOTIVOS_BAJA).map(([valor, label]) => ({ valor, label }))}
            />
          </Campo>
          <Campo label="Qué pasó">
            <Textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} maxLength={500} rows={2} />
          </Campo>

          {cierraCasos && (
            <div className="bg-muted/30 flex flex-col gap-2 rounded-xl border p-3">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={aplicar} onCheckedChange={(v) => setAplicar(v === true)} aria-label="Aplicar ya en Odoo" />
                Aplicar ya en Odoo (lo cierras tú)
              </label>
              {aplicar && (
                <Campo label="Razón del cierre" requerido>
                  <Textarea value={razon} onChange={(e) => setRazon(e.target.value)} maxLength={500} rows={2} />
                </Campo>
              )}
            </div>
          )}

          {error && (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          )}
        </div>

        <DialogFooter className="m-0 flex-row items-center justify-end border-t px-5 py-3">
          <DialogClose render={<Button variant="outline" type="button" />}>Cancelar</DialogClose>
          <Button onClick={reportar} disabled={pendiente}>
            {pendiente ? "Guardando…" : aplicar ? "Reportar y aplicar" : "Reportar baja"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
