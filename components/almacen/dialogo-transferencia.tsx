"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowRight, Trash2 } from "lucide-react";
import * as acciones from "@/app/(app)/almacen/acciones";
import type { Almacen } from "@/lib/almacenes";
import { compactar } from "@/lib/busqueda-inteligente";
import { medidaSobrante, type Sobrante } from "@/lib/sobrantes";
import { ComboBusqueda, type Opcion } from "@/components/cotizaciones/combo-busqueda";
import { Button } from "@/components/ui/button";
import { Campo } from "@/components/ui/campo";
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

/** Con qué abre el diálogo cuando viene de un aviso de "mover stock". */
export interface TransferenciaInicial {
  desdeId: string | null;
  haciaId: string | null;
  lineas: { productoId: number; cantidad: number }[];
  sobrantes?: string[];
  faltanteIds: string[];
  pedidoId: string | null;
  /** "Para el pedido 25-0042". */
  motivo?: string;
}

interface Fila extends Ingresable {
  cantidad: string;
}

const entero = (t: string) => {
  const v = Number(t.trim());
  return t.trim() && Number.isInteger(v) && v > 0 && v <= 99_999 ? v : null;
};

/**
 * Pasar material de un almacén a otro. Al enviarla, sale del origen y queda en
 * camino; entra al destino cuando alguien allá la recibe (desde Movimientos).
 * Se mueven planchas y accesorios por unidades enteras, y sobrantes uno por uno.
 */
export function DialogoTransferencia({
  almacenes,
  productos,
  sobrantes,
  inicial,
  alCerrar,
}: {
  almacenes: Almacen[];
  productos: Ingresable[];
  sobrantes: Sobrante[];
  inicial?: TransferenciaInicial;
  alCerrar: () => void;
}) {
  const [desdeId, setDesdeId] = useState<string | null>(inicial?.desdeId ?? null);
  const [haciaId, setHaciaId] = useState<string | null>(inicial?.haciaId ?? null);
  const [filas, setFilas] = useState<Fila[]>(() =>
    (inicial?.lineas ?? []).flatMap((l) => {
      const p = productos.find((x) => x.productoId === l.productoId);
      return p ? [{ ...p, cantidad: String(l.cantidad) }] : [];
    }),
  );
  const [elegidos, setElegidos] = useState<Set<string>>(() => new Set(inicial?.sobrantes ?? []));
  const [nota, setNota] = useState(inicial?.motivo ?? "");
  const [consulta, setConsulta] = useState("");
  const [buscaSobrante, setBuscaSobrante] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  const opciones: Opcion[] = useMemo(() => {
    const palabras = consulta.split(/\s+/).map(compactar).filter(Boolean);
    if (palabras.length === 0) return [];
    return productos
      .filter((p) => !filas.some((f) => f.productoId === p.productoId))
      .filter((p) => palabras.every((x) => compactar(`${p.codigo} ${p.titulo}`).includes(x)))
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
            {desdeId && <span className="text-muted-foreground ml-auto text-xs">hay {fmt(p.porAlmacen[desdeId] ?? 0)}</span>}
          </span>
        ),
      }));
  }, [productos, consulta, filas, desdeId]);

  // Los sobrantes que se pueden mover: disponibles en el almacén de origen.
  const delOrigen = useMemo(() => {
    if (!desdeId) return [];
    const palabras = buscaSobrante.split(/\s+/).map(compactar).filter(Boolean);
    return sobrantes
      .filter((s) => s.almacenId === desdeId && s.estado === "disponible")
      .filter((s) => palabras.every((x) => compactar(`${s.codigo} ${s.material} ${medidaSobrante(s)} ${s.ubicacion ?? ""}`).includes(x)));
  }, [sobrantes, desdeId, buscaSobrante]);

  const cambiarOrigen = (id: string) => {
    setDesdeId(id);
    // Los sobrantes elegidos eran del otro almacén.
    setElegidos(new Set());
    setError(null);
  };

  const alternar = (codigo: string) =>
    setElegidos((e) => {
      const nuevo = new Set(e);
      if (nuevo.has(codigo)) nuevo.delete(codigo);
      else nuevo.add(codigo);
      return nuevo;
    });

  const enviar = () => {
    if (!desdeId) return setError("Elige de dónde sale.");
    if (!haciaId) return setError("Elige a dónde va.");
    if (desdeId === haciaId) return setError("El destino tiene que ser otro almacén.");
    if (filas.length === 0 && elegidos.size === 0) return setError("Agrega al menos un producto o un sobrante.");
    for (const f of filas) {
      const n = entero(f.cantidad);
      if (n === null) return setError(`Escribe cuántas unidades de ${f.codigo} (un número entero).`);
      const hay = f.porAlmacen[desdeId] ?? 0;
      if (n > hay) return setError(`En el origen hay ${fmt(hay)} de ${f.codigo}: no se pueden enviar ${n}.`);
    }
    iniciar(async () => {
      const r = await acciones.crearTransferencia({
        desdeId,
        haciaId,
        nota,
        lineas: filas.map((f) => ({ productoId: f.productoId, cantidad: entero(f.cantidad)! })),
        sobrantes: [...elegidos],
        faltanteIds: inicial?.faltanteIds ?? [],
        pedidoId: inicial?.pedidoId ?? null,
      });
      if (!r.ok) return setError(r.error);
      if (r.aviso) toast.warning(`${r.codigo} enviada`, { description: r.aviso, duration: 12_000 });
      else toast.success(`${r.codigo} enviada`, { description: "Ya salió del origen. Entra al destino cuando la reciban." });
      alCerrar();
    });
  };

  const unidades = filas.reduce((t, f) => t + (entero(f.cantidad) ?? 0), 0);

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && alCerrar()}>
      <DialogContent className="flex max-h-[92dvh] flex-col gap-0 p-0 sm:max-w-3xl">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>Transferir stock</DialogTitle>
          <DialogDescription>
            Sale del almacén de origen al enviarla y queda en camino. Entra al destino cuando allá la reciban.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 overflow-y-auto px-5 py-4">
          <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto_1fr]">
            <Campo grupo label="Sale de" requerido>
              <SelectorAlmacen almacenes={almacenes} valor={desdeId} alCambiar={cambiarOrigen} etiqueta="Sale de" />
            </Campo>
            <ArrowRight className="text-muted-foreground mb-2.5 hidden size-4 sm:block" />
            <Campo grupo label="Va a" requerido>
              <SelectorAlmacen
                almacenes={almacenes}
                valor={haciaId}
                alCambiar={(id) => {
                  setHaciaId(id);
                  setError(null);
                }}
                etiqueta="Va a"
              />
            </Campo>
          </div>

          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium">Planchas y accesorios</p>
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

          {filas.length > 0 && (
            <ul className="divide-y rounded-xl border" aria-label="Productos de la transferencia">
              {filas.map((f, i) => {
                const hay = desdeId ? (f.porAlmacen[desdeId] ?? 0) : null;
                return (
                  <li key={f.productoId} className="flex flex-wrap items-end gap-2 px-3 py-2.5">
                    <div className="min-w-0 flex-1 basis-56">
                      <p className="text-sm">
                        <span className="text-muted-foreground mr-2 font-mono text-xs">{f.codigo}</span>
                        {f.titulo}
                      </p>
                      {hay !== null && <p className="text-muted-foreground mt-0.5 text-xs">En el origen hay {fmt(hay)}</p>}
                    </div>
                    <Campo label="Envías" className="w-24">
                      <Input
                        inputMode="numeric"
                        value={f.cantidad}
                        onChange={(e) => {
                          setFilas((fs) => fs.map((x, j) => (j === i ? { ...x, cantidad: e.target.value } : x)));
                          setError(null);
                        }}
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

          {desdeId && (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium">
                Sobrantes del origen
                {elegidos.size > 0 && <span className="text-muted-foreground font-normal"> · {elegidos.size} elegidos</span>}
              </p>
              {sobrantes.some((s) => s.almacenId === desdeId && s.estado === "disponible") ? (
                <>
                  <Input
                    value={buscaSobrante}
                    onChange={(e) => setBuscaSobrante(e.target.value)}
                    placeholder="Filtrar: SOB-00012, cristal 3, 100×50…"
                    aria-label="Filtrar sobrantes"
                  />
                  <ul className="max-h-48 divide-y overflow-y-auto rounded-xl border" aria-label="Sobrantes del origen">
                    {delOrigen.slice(0, 80).map((s) => (
                      <li key={s.codigo}>
                        <label className="hover:bg-muted/40 flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                          <Checkbox checked={elegidos.has(s.codigo)} onCheckedChange={() => alternar(s.codigo)} aria-label={`Mover ${s.codigo}`} />
                          <span className="font-mono text-xs">{s.codigo}</span>
                          <span className="min-w-0 flex-1 truncate">{s.material}</span>
                          <span className="tnum text-muted-foreground text-xs">{medidaSobrante(s)} cm</span>
                        </label>
                      </li>
                    ))}
                    {delOrigen.length === 0 && <li className="text-muted-foreground px-3 py-2 text-xs">Ninguno coincide.</li>}
                  </ul>
                </>
              ) : (
                <p className="text-muted-foreground text-xs">No hay sobrantes disponibles en este almacén.</p>
              )}
            </div>
          )}

          <Campo label="Nota">
            <Textarea value={nota} onChange={(e) => setNota(e.target.value)} maxLength={500} rows={2} />
          </Campo>
          {error && (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          )}
        </div>

        <DialogFooter className="m-0 flex-row items-center border-t px-5 py-3">
          <p className="text-muted-foreground min-w-0 flex-1 text-xs">
            {unidades} {unidades === 1 ? "unidad" : "unidades"}
            {elegidos.size > 0 && ` · ${elegidos.size} ${elegidos.size === 1 ? "sobrante" : "sobrantes"}`}
          </p>
          <DialogClose render={<Button variant="outline" type="button" className="hidden sm:inline-flex" />}>Cancelar</DialogClose>
          <Button onClick={enviar} disabled={pendiente}>
            {pendiente ? "Enviando…" : "Enviar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
