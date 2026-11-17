"use client";

import { useMemo, useState } from "react";
import { Pencil, Search } from "lucide-react";
import * as acciones from "@/app/(app)/almacen/acciones";
import type { Almacen } from "@/lib/almacenes";
import { compactar } from "@/lib/busqueda-inteligente";
import { espesorTexto } from "@/lib/cortes/catalogo";
import { money } from "@/lib/formato";
import { valoresDe, type PlanchaInventario } from "@/lib/inventario";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CeldasStock, DialogoPrecio, EncabezadosStock, type PermisosAlmacen } from "./comun";

const TODOS = "__todos";

/** Un filtro de la lista: "Todos" o uno de los valores. */
function Filtro<T extends string | number>({
  etiqueta,
  valores,
  valor,
  alCambiar,
  texto = String,
}: {
  etiqueta: string;
  valores: T[];
  valor: T | null;
  alCambiar: (v: T | null) => void;
  texto?: (v: T) => string;
}) {
  return (
    <Select
      value={valor === null ? TODOS : String(valor)}
      onValueChange={(v) => alCambiar(v === TODOS || v === null ? null : (valores.find((x) => String(x) === v) ?? null))}
    >
      <SelectTrigger aria-label={etiqueta} className="w-full sm:w-auto sm:min-w-36">
        <SelectValue>{valor === null ? `${etiqueta}: todos` : texto(valor)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={TODOS}>{`${etiqueta}: todos`}</SelectItem>
        {valores.map((v) => (
          <SelectItem key={String(v)} value={String(v)}>
            {texto(v)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Las planchas con su stock en cada almacén. Se agrupan por material y se
 * filtran por espesor, color y formato; la búsqueda entiende el código y las
 * palabras del nombre ("eco cristal 3").
 */
export function TablaPlanchas({
  planchas,
  almacenes,
  permisos,
  conFuera,
  enCamino = {},
}: {
  planchas: PlanchaInventario[];
  almacenes: Almacen[];
  permisos: PermisosAlmacen;
  conFuera: boolean;
  /** Lo que viene en camino a cada almacén, por producto. */
  enCamino?: Record<number, Record<string, number>>;
}) {
  const [texto, setTexto] = useState("");
  const [material, setMaterial] = useState<string | null>(null);
  const [espesor, setEspesor] = useState<number | null>(null);
  const [color, setColor] = useState<string | null>(null);
  const [formato, setFormato] = useState<string | null>(null);
  const [conStock, setConStock] = useState(false);
  const [inactivas, setInactivas] = useState(false);
  const [preciando, setPreciando] = useState<PlanchaInventario | null>(null);
  const activos = almacenes.filter((a) => a.activo);

  // Cada filtro ofrece lo que queda con los demás filtros puestos.
  const base = planchas.filter((p) => inactivas || p.activo);
  const deMaterial = base.filter((p) => !material || p.material === material);
  const materiales = valoresDe(base, "material");
  const espesores = valoresDe(deMaterial, "espesorMm").sort((a, b) => a - b);
  const colores = valoresDe(deMaterial.filter((p) => espesor === null || p.espesorMm === espesor), "color").sort();
  const formatos = valoresDe(deMaterial, "formato").sort();

  const visibles = useMemo(() => {
    const palabras = texto.split(/\s+/).map(compactar).filter(Boolean);
    return base.filter((p) => {
      if (material && p.material !== material) return false;
      if (espesor !== null && p.espesorMm !== espesor) return false;
      if (color && p.color !== color) return false;
      if (formato && p.formato !== formato) return false;
      if (conStock && !(p.stock && p.stock.total > 0)) return false;
      const donde = compactar(`${p.codigo} ${p.material} ${p.color} ${p.espesorMm} ${p.formato} ${p.nombre}`);
      return palabras.every((x) => donde.includes(x));
    });
  }, [base, texto, material, espesor, color, formato, conStock]);

  const porMaterial = useMemo(() => {
    const mapa = new Map<string, PlanchaInventario[]>();
    for (const p of visibles) mapa.set(p.material, [...(mapa.get(p.material) ?? []), p]);
    return [...mapa.entries()];
  }, [visibles]);

  const limpiar = () => {
    setTexto("");
    setMaterial(null);
    setEspesor(null);
    setColor(null);
    setFormato(null);
    setConStock(false);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative min-w-0 sm:min-w-56 sm:flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            aria-label="Buscar plancha"
            placeholder="Código o nombre: eco cristal 3"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            className="pl-9"
          />
        </div>
        <Filtro
          etiqueta="Material"
          valores={materiales}
          valor={material}
          alCambiar={(v) => {
            setMaterial(v);
            setEspesor(null);
            setColor(null);
            setFormato(null);
          }}
        />
        <Filtro etiqueta="Espesor" valores={espesores} valor={espesor} alCambiar={setEspesor} texto={espesorTexto} />
        <Filtro etiqueta="Color" valores={colores} valor={color} alCambiar={setColor} />
        <Filtro etiqueta="Formato" valores={formatos} valor={formato} alCambiar={setFormato} texto={(f) => `${f} cm`} />
      </div>
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <label className="flex cursor-pointer items-center gap-2">
          <Checkbox checked={conStock} onCheckedChange={(v) => setConStock(v === true)} />
          Solo con stock
        </label>
        <label className="flex cursor-pointer items-center gap-2">
          <Checkbox checked={inactivas} onCheckedChange={(v) => setInactivas(v === true)} />
          Incluir formatos desactivados
        </label>
        <span aria-live="polite">
          {visibles.length} de {base.length} planchas
        </span>
        {(texto || material || espesor !== null || color || formato || conStock) && (
          <Button variant="link" size="xs" onClick={limpiar} className="h-auto p-0">
            Quitar filtros
          </Button>
        )}
      </div>

      {porMaterial.length === 0 && (
        <p className="text-muted-foreground rounded-xl border border-dashed px-4 py-8 text-center text-sm">
          Ninguna plancha coincide con los filtros.
        </p>
      )}

      {porMaterial.map(([nombre, lista]) => (
        <section key={nombre} className="bg-card overflow-hidden rounded-xl border">
          <header className="bg-muted/40 flex flex-wrap items-baseline gap-x-3 border-b px-4 py-2.5">
            <h2 className="text-sm font-medium">{nombre}</h2>
            <span className="text-muted-foreground text-xs">
              {lista.length} {lista.length === 1 ? "plancha" : "planchas"} ·{" "}
              {lista.reduce((t, p) => t + (p.stock?.total ?? 0), 0).toLocaleString("es-PE")} en stock
            </span>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground text-left text-xs">
                  <th className="px-4 py-2 font-medium">Color</th>
                  <th className="px-2 py-2 font-medium">Espesor</th>
                  <th className="px-2 py-2 font-medium">Formato (cm)</th>
                  <th className="px-2 py-2 font-medium">Código</th>
                  <EncabezadosStock almacenes={activos} conFuera={conFuera} />
                  {permisos.verPrecios && <th className="px-2 py-2 text-right font-medium">Precio</th>}
                  {permisos.editarPrecios && <th className="w-10" />}
                </tr>
              </thead>
              <tbody>
                {lista.map((p) => (
                  <tr key={p.formatoId} className={cn("border-t", !p.activo && "text-muted-foreground")}>
                    <td className="px-4 py-2 font-medium">{p.color}</td>
                    <td className="tnum px-2 py-2 whitespace-nowrap">{espesorTexto(p.espesorMm)}</td>
                    <td className="tnum px-2 py-2 whitespace-nowrap">
                      {p.formato}
                      {!p.activo && <span className="ml-1.5 text-2xs">(desactivado)</span>}
                    </td>
                    <td className="px-2 py-2">
                      <span className={cn("font-mono text-xs", !p.productoId && "text-destructive")} title={p.productoId ? p.nombre : "No existe en Odoo"}>
                        {p.codigo}
                      </span>
                    </td>
                    <CeldasStock stock={p.stock} almacenes={activos} conFuera={conFuera} enCamino={p.productoId ? enCamino[p.productoId] : undefined} />
                    {permisos.verPrecios && (
                      <td className="tnum px-2 py-2 text-right whitespace-nowrap">{p.precio === null ? "—" : money(p.precio)}</td>
                    )}
                    {permisos.editarPrecios && (
                      <td className="py-1 pr-2">
                        {p.productoId && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground size-8"
                            aria-label={`Cambiar el precio de ${p.codigo}`}
                            onClick={() => setPreciando(p)}
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
          descripcion={`${preciando.material} · ${preciando.color} · ${espesorTexto(preciando.espesorMm)} · ${preciando.formato} cm. Se cambia en Odoo: vale para las cotizaciones nuevas.`}
          actual={preciando.precio}
          alGuardar={(precio) => acciones.cambiarPrecio({ productoId: preciando.productoId, precio })}
          alCerrar={() => setPreciando(null)}
        />
      )}
    </div>
  );
}
