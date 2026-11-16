"use client";

import { useState } from "react";
import { Package, Plus, X } from "lucide-react";
import type { Resultado } from "@/app/(app)/acciones";
import { almacenDeLugar, type Almacen } from "@/lib/almacenes";
import { nombreDeGrupo, type GrupoPlancha } from "@/lib/cortes/catalogo";
import type { LineaDePedido } from "@/lib/pedido-lineas";
import { normalizarMedidas } from "@/lib/sobrantes";
import type { ProductoOdoo } from "@/lib/odoo/tipos";
import { materialesADescontar, tituloTerminado } from "@/lib/terminados/guardado";
import { BuscadorProducto } from "@/components/cotizaciones/buscador-producto";
import { SelectorAlmacen } from "@/components/almacen/comun";
import type { SobrantesGuardados } from "@/components/planchas-usadas";
import { Button } from "@/components/ui/button";
import { Campo } from "@/components/ui/campo";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  almacenes = [],
  catalogo = [],
  retazoMin = 30,
  alConfirmar,
}: {
  abierto: boolean;
  alCambiar: (abierto: boolean) => void;
  terminados: LineaDePedido[];
  alPasarAListo?: boolean;
  /** Después vienen las planchas de los cortes: este paso no cierra el pedido todavía. */
  siguePlanchas?: boolean;
  pendiente: boolean;
  /** Para los sobrantes que quedan al pasar a Listo: a qué almacén se fue cada uno… */
  almacenes?: Almacen[];
  /** …y de qué material es. */
  catalogo?: GrupoPlancha[];
  /** El lado mínimo de un sobrante: con menos, es retazo. */
  retazoMin?: number;
  alConfirmar: (materiales: MaterialesAnotados, sobrantes: SobrantesGuardados) => Promise<Resultado> | void;
}) {
  return (
    <Dialog open={abierto} onOpenChange={alCambiar} triggerId={null}>
      <DialogContent className="flex max-h-[92dvh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{alPasarAListo ? "Pasar a Listo: materiales usados" : "Materiales usados"}</DialogTitle>
          <DialogDescription>
            {alPasarAListo
              ? "Confirma lo que de verdad se usó en cada producto terminado —eso es lo que se descuenta del stock en Odoo— y, si quedaron pedazos de plancha, a qué almacén se fueron."
              : "Lo que se descontará del stock en Odoo cuando el pedido pase a Listo."}
          </DialogDescription>
        </DialogHeader>
        {/* Se monta al abrir: así cada vez llega con lo último anotado. */}
        {abierto && (
          <Formulario
            terminados={terminados}
            etiqueta={siguePlanchas ? "Siguiente" : alPasarAListo ? "Pasar a Listo" : "Guardar"}
            pendiente={pendiente}
            conSobrantes={!!alPasarAListo && almacenes.length > 0}
            almacenes={almacenes}
            catalogo={catalogo}
            retazoMin={retazoMin}
            alConfirmar={async (materiales, sobrantes) => {
              const r = await alConfirmar(materiales, sobrantes);
              if (!r || r.ok) alCambiar(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

interface SobranteEnEdicion {
  clave: number;
  grupoId: string | null;
  largo: string;
  ancho: string;
  ubicacion: string;
  almacenId: string | null;
}

let siguienteClave = 1;

/** Una medida en cm, si es válida. */
const medida = (texto: string) => {
  const v = Number(texto.trim().replace(",", "."));
  return texto.trim() && Number.isFinite(v) && v > 0 ? v : null;
};

function Formulario({
  terminados,
  etiqueta,
  pendiente,
  conSobrantes,
  almacenes,
  catalogo,
  retazoMin,
  alConfirmar,
}: {
  terminados: LineaDePedido[];
  etiqueta: string;
  pendiente: boolean;
  conSobrantes: boolean;
  almacenes: Almacen[];
  catalogo: GrupoPlancha[];
  retazoMin: number;
  alConfirmar: (materiales: MaterialesAnotados, sobrantes: SobrantesGuardados) => Promise<void>;
}) {
  // Los productos terminados se fabrican en el taller: ahí vuelven sus sobrantes, salvo que se diga otra cosa.
  const taller = almacenDeLugar(almacenes, "taller")?.id ?? null;
  const [sobrantes, setSobrantes] = useState<SobranteEnEdicion[][]>(() => terminados.map(() => []));
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

  /** Los materiales de los que puede ser un sobrante: el del producto y las planchas usadas. */
  const gruposDe = (i: number) => {
    const ids = new Set<string>();
    const propio = terminados[i].terminado?.material?.grupoId;
    if (propio) ids.add(propio);
    for (const f of filas[i]) {
      for (const g of catalogo) if (f.codigo && g.formatos.some((x) => x.codigo === f.codigo)) ids.add(g.id);
    }
    return catalogo.filter((g) => ids.has(g.id));
  };

  const cambiarSobrante = (i: number, clave: number, cambios: Partial<SobranteEnEdicion>) => {
    setError(null);
    setSobrantes((prev) => prev.map((lista, j) => (j === i ? lista.map((s) => (s.clave === clave ? { ...s, ...cambios } : s)) : lista)));
  };

  const enviar = (e: React.FormEvent) => {
    e.preventDefault();
    const guardados: SobrantesGuardados = [];
    if (conSobrantes) {
      for (const [i, l] of terminados.entries()) {
        const piezas = [];
        for (const s of sobrantes[i]) {
          const largo = medida(s.largo);
          const ancho = medida(s.ancho);
          if (!s.grupoId) return setError("Elige de qué material es cada sobrante.");
          if (!largo || !ancho) return setError("Escribe el largo y el ancho de cada sobrante, o quítalo.");
          const m = normalizarMedidas(largo, ancho);
          if (m.ancho < retazoMin) return setError(`${n(m.largo)}×${n(m.ancho)} es retazo (un lado de menos de ${retazoMin} cm): quítalo.`);
          if (!s.almacenId) return setError("Elige a qué almacén se fue cada sobrante.");
          piezas.push({ ...m, ubicacion: s.ubicacion.trim() || null, almacenId: s.almacenId, grupoId: s.grupoId });
        }
        // Una línea sin sobrantes también va: así se limpia lo de un intento anterior.
        guardados.push({ posicion: l.posicion, piezas });
      }
    }
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
    void alConfirmar(materiales, guardados);
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

              {conSobrantes && (
                <fieldset className="flex flex-col gap-2 border-t pt-2">
                  <legend className="text-xs font-medium">¿Quedaron sobrantes de plancha?</legend>
                  {sobrantes[i].length === 0 && (
                    <p className="text-muted-foreground text-xs">Ninguno. Si guardaste un pedazo, agrégalo con su medida.</p>
                  )}
                  {sobrantes[i].map((s, k) => {
                    const grupos = gruposDe(i);
                    const grupo = catalogo.find((g) => g.id === s.grupoId) ?? null;
                    return (
                      <div key={s.clave} className="flex flex-wrap items-end gap-2" role="group" aria-label={`Sobrante ${k + 1}`}>
                        <Campo grupo label="Material" className="min-w-48 flex-1">
                          <Select value={s.grupoId} onValueChange={(v) => v && cambiarSobrante(i, s.clave, { grupoId: v })}>
                            <SelectTrigger aria-label={`Material del sobrante ${k + 1}`} className="w-full">
                              <SelectValue>{grupo ? nombreDeGrupo(grupo) : "Elige el material"}</SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {grupos.map((g) => (
                                <SelectItem key={g.id} value={g.id}>
                                  {nombreDeGrupo(g)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Campo>
                        <Campo label="Largo" className="w-20">
                          <Input inputMode="decimal" className="tnum" value={s.largo} onChange={(e) => cambiarSobrante(i, s.clave, { largo: e.target.value })} />
                        </Campo>
                        <Campo label="Ancho" className="w-20">
                          <Input inputMode="decimal" className="tnum" value={s.ancho} onChange={(e) => cambiarSobrante(i, s.clave, { ancho: e.target.value })} />
                        </Campo>
                        <Campo grupo label="Se fue a" className="w-40">
                          <SelectorAlmacen
                            almacenes={almacenes}
                            valor={s.almacenId}
                            alCambiar={(id) => cambiarSobrante(i, s.clave, { almacenId: id })}
                            etiqueta={`Almacén del sobrante ${k + 1}`}
                          />
                        </Campo>
                        <Campo label="Ubicación" className="min-w-28 flex-1">
                          <Input
                            value={s.ubicacion}
                            maxLength={80}
                            placeholder="Rack 2"
                            onChange={(e) => cambiarSobrante(i, s.clave, { ubicacion: e.target.value })}
                          />
                        </Campo>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Quitar el sobrante ${k + 1}`}
                          onClick={() => setSobrantes((prev) => prev.map((lista, j) => (j === i ? lista.filter((x) => x.clave !== s.clave) : lista)))}
                        >
                          <X className="size-4" />
                        </Button>
                      </div>
                    );
                  })}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 self-start"
                    onClick={() => {
                      const grupos = gruposDe(i);
                      setSobrantes((prev) =>
                        prev.map((lista, j) =>
                          j === i
                            ? [
                                ...lista,
                                {
                                  clave: siguienteClave++,
                                  grupoId: grupos.length === 1 ? grupos[0].id : (l.terminado?.material?.grupoId ?? null),
                                  largo: "",
                                  ancho: "",
                                  ubicacion: "",
                                  almacenId: taller,
                                },
                              ]
                            : lista,
                        ),
                      );
                    }}
                  >
                    <Plus className="size-3.5" />
                    Agregar sobrante
                  </Button>
                </fieldset>
              )}
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
