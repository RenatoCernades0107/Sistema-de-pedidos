"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import { ChevronsUpDown } from "lucide-react";
import { buscarGrupos, colorDe, espesorTexto, medidaDe, nombreDeGrupo, type GrupoPlancha } from "@/lib/cortes/catalogo";
import {
  SIN_SELECCION,
  coloresDe,
  elegirColor,
  elegirEspesor,
  elegirMaterial,
  espesoresDe,
  materialesDe,
  pasoPendiente,
  resolverGrupo,
  type SeleccionMaterial,
} from "@/lib/cortes/seleccion-material";
import { coincide } from "@/lib/busqueda";
import { cn } from "@/lib/utils";
import { ComboBusqueda, type Opcion } from "@/components/cotizaciones/combo-busqueda";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type Paso = "material" | "color" | "espesor";

/**
 * El material de un corte, un terminado o un sobrante en tres pasos
 * encadenados: Material → Color → Espesor. Cada paso es un desplegable con
 * búsqueda (se puede escribir para filtrar) y lo que ofrece depende de lo
 * elegido antes. Al elegir el espesor queda resuelto el grupo de planchas.
 *
 * - Un paso con una sola opción se elige solo.
 * - Después de cada elección se abre el paso que sigue.
 * - Debajo hay una búsqueda rápida para quien ya sabe qué quiere ("eco cristal
 *   3"): al elegir un resultado resuelve los tres pasos de una vez.
 * - Con el grupo elegido se muestra su nombre y un `Cambiar`.
 */
export function SelectorMaterialPasos({
  catalogo,
  grupo,
  alElegir,
  alCambiar,
  testId = "material-elegido",
  opcional,
  espesorRecomendado,
  ayuda,
  autoFocus,
  className,
}: {
  catalogo: GrupoPlancha[];
  /** El grupo que ya está elegido, si lo hay. */
  grupo: GrupoPlancha | null;
  alElegir: (g: GrupoPlancha) => void;
  /** Se pidió cambiar el material: quien llama borra el grupo (y lo que dependía de él). */
  alCambiar: () => void;
  /** El `data-testid` del material elegido. */
  testId?: string;
  /** Se dice que el material es opcional. */
  opcional?: boolean;
  /** Para marcar los espesores que conviene al producto. */
  espesorRecomendado?: (espesorMm: number) => boolean;
  /** Una nota debajo de los pasos (los espesores y colores recomendados). */
  ayuda?: ReactNode;
  /** Llevar el foco al primer paso al montarse. */
  autoFocus?: boolean;
  className?: string;
}) {
  const [sel, setSel] = useState<SeleccionMaterial>(SIN_SELECCION);
  const [abierto, setAbierto] = useState<Paso | null>(null);
  const [consulta, setConsulta] = useState("");

  const materiales = useMemo(() => materialesDe(catalogo), [catalogo]);
  const colores = useMemo(() => coloresDe(catalogo, sel.material), [catalogo, sel.material]);
  const espesores = useMemo(() => espesoresDe(catalogo, sel.material, sel.color), [catalogo, sel.material, sel.color]);

  /** Termina una elección: si ya hay grupo se entrega, y si no se abre el paso que falta. */
  const avanzar = (s: SeleccionMaterial) => {
    const g = resolverGrupo(catalogo, s);
    if (g) {
      setSel(SIN_SELECCION);
      setAbierto(null);
      alElegir(g);
      return;
    }
    setSel(s);
    setAbierto(pasoPendiente(s));
  };

  const cambiar = () => {
    setSel(SIN_SELECCION);
    setConsulta("");
    // Así se puede escribir el material sin otro clic.
    setAbierto("material");
    alCambiar();
  };

  const busqueda: Opcion[] = buscarGrupos(catalogo, consulta).map((g) => ({
    valor: g.id,
    alElegir: () => {
      setConsulta("");
      setSel(SIN_SELECCION);
      setAbierto(null);
      alElegir(g);
    },
    contenido: (
      <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
        <span className="font-medium">{g.material}</span>
        <span>{colorDe(g)}</span>
        <span className="tnum">{espesorTexto(g.espesorMm)}</span>
        {espesorRecomendado?.(g.espesorMm) ? (
          <span className="text-primary ml-auto text-xs">Espesor recomendado</span>
        ) : (
          <span className="text-muted-foreground ml-auto text-xs">{g.formatos.map(medidaDe).join(" · ")}</span>
        )}
      </span>
    ),
  }));

  if (grupo) {
    return (
      <div className={cn("flex flex-wrap items-end gap-3", className)}>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium">Material</p>
          <p className="bg-muted/50 mt-1.5 flex min-h-9 items-center gap-2 rounded-lg border px-3 text-sm" data-testid={testId}>
            <span className="min-w-0 flex-1 font-medium">{nombreDeGrupo(grupo)}</span>
            <Button type="button" variant="ghost" size="xs" onClick={cambiar}>
              Cambiar
            </Button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <p className="text-xs font-medium">
        Material {opcional && <span className="text-muted-foreground font-normal">(opcional)</span>}
      </p>

      <div className="grid gap-2 sm:grid-cols-3">
        <Combo
          etiqueta="Material"
          testId="paso-material"
          valor={sel.material}
          marcador="Elige el material"
          abierto={abierto === "material"}
          alAbrir={(v) => setAbierto(v ? "material" : null)}
          buscar="Buscar material…"
          autoFocus={autoFocus}
          elementos={materiales.map((m) => ({
            clave: m.nombre,
            texto: m.nombre,
            detalle: m.colores === 1 ? "1 color" : `${m.colores} colores`,
            marcado: sel.material === m.nombre,
          }))}
          sinNada="Todavía no hay materiales. Se administran en Configuración."
          alElegir={(clave) => avanzar(elegirMaterial(catalogo, clave))}
        />
        <Combo
          etiqueta="Color"
          testId="paso-color"
          valor={sel.color}
          marcador={sel.material ? "Elige el color" : "Primero el material"}
          abierto={abierto === "color"}
          alAbrir={(v) => setAbierto(v ? "color" : null)}
          deshabilitado={!sel.material}
          buscar="Buscar color…"
          elementos={colores.map((c) => ({
            clave: c.nombre,
            texto: c.nombre,
            detalle: c.espesores === 1 ? "1 espesor" : `${c.espesores} espesores`,
            marcado: sel.color === c.nombre,
          }))}
          sinNada="Este material no tiene colores."
          alElegir={(clave) => avanzar(elegirColor(catalogo, sel, clave))}
        />
        <Combo
          etiqueta="Espesor"
          testId="paso-espesor"
          valor={sel.espesorMm === null ? null : espesorTexto(sel.espesorMm)}
          marcador={sel.color ? "Elige el espesor" : "Primero el color"}
          abierto={abierto === "espesor"}
          alAbrir={(v) => setAbierto(v ? "espesor" : null)}
          deshabilitado={!sel.color}
          buscar="Buscar espesor…"
          elementos={espesores.map((e) => ({
            clave: String(e.espesorMm),
            texto: espesorTexto(e.espesorMm),
            // Los formatos son solo para saber qué hay: la plancha se elige después.
            detalle: e.medidas.join(" · "),
            aviso: espesorRecomendado?.(e.espesorMm) ? "Recomendado" : undefined,
            marcado: sel.espesorMm === e.espesorMm,
          }))}
          sinNada="Este color no tiene espesores."
          alElegir={(clave) => avanzar(elegirEspesor(catalogo, sel, Number(clave)))}
        />
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-muted-foreground text-xs">¿Ya sabes cuál es? Escríbelo junto:</p>
        <ComboBusqueda
          etiqueta="Buscar material"
          placeholder="Material, color y espesor: eco cristal 3…"
          consulta={consulta}
          alEscribir={setConsulta}
          opciones={busqueda}
          cargando={false}
          error={null}
          vacio="Ningún material coincide. Los materiales se administran en Configuración."
          fresco
          enLinea
        />
      </div>

      {ayuda}
    </div>
  );
}

export interface Elemento {
  clave: string;
  texto: string;
  detalle?: string;
  /** Una marca destacada junto al detalle ("Recomendado"). */
  aviso?: string;
  marcado: boolean;
}

/** Un desplegable con búsqueda: el botón muestra lo elegido y la lista se filtra al escribir. */
export function Combo({
  etiqueta,
  testId,
  valor,
  marcador,
  abierto,
  alAbrir,
  deshabilitado,
  buscar,
  elementos,
  sinNada,
  alElegir,
  autoFocus,
}: {
  etiqueta: string;
  testId: string;
  valor: string | null;
  marcador: string;
  abierto: boolean;
  alAbrir: (v: boolean) => void;
  deshabilitado?: boolean;
  buscar: string;
  elementos: Elemento[];
  sinNada: string;
  alElegir: (clave: string) => void;
  autoFocus?: boolean;
}) {
  const [filtro, setFiltro] = useState("");
  const idEtiqueta = useId();
  const idValor = useId();
  const visibles = elementos.filter((e) => coincide(e.texto, filtro));

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span id={idEtiqueta} className="text-muted-foreground text-xs">
        {etiqueta}
      </span>
      <Popover
        open={abierto}
        onOpenChange={(v) => {
          alAbrir(v);
          if (!v) setFiltro("");
        }}
      >
        <PopoverTrigger
          data-testid={testId}
          aria-labelledby={`${idEtiqueta} ${idValor}`}
          disabled={deshabilitado}
          autoFocus={autoFocus}
          className={cn(
            "border-input dark:bg-input/30 flex h-10 w-full min-w-0 items-center gap-2 rounded-lg border bg-transparent px-3 text-left text-base transition-colors outline-none md:text-sm",
            "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          <span id={idValor} className={cn("min-w-0 flex-1 truncate", !valor && "text-muted-foreground")} title={valor ?? undefined}>
            {valor ?? marcador}
          </span>
          <ChevronsUpDown className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-(--anchor-width) min-w-60 gap-0 p-0">
          <Command shouldFilter={false} label={`Opciones: ${etiqueta.toLowerCase()}`}>
            <CommandInput
              placeholder={buscar}
              value={filtro}
              onValueChange={setFiltro}
              className="text-base md:text-sm"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <CommandList className="max-h-64">
              {visibles.length === 0 && (
                <CommandEmpty className="text-muted-foreground px-3 py-4 text-xs">
                  {filtro.trim() ? "Sin resultados." : sinNada}
                </CommandEmpty>
              )}
              {visibles.length > 0 && (
                <CommandGroup>
                  {visibles.map((e) => (
                    <CommandItem
                      key={e.clave}
                      value={e.clave}
                      data-checked={e.marcado}
                      onSelect={() => alElegir(e.clave)}
                      className="items-start py-2 md:py-1.5"
                    >
                      <span className="min-w-0 flex-1 break-words whitespace-normal">{e.texto}</span>
                      {e.aviso && <span className="text-primary shrink-0 text-xs">{e.aviso}</span>}
                      {e.detalle && <span className="text-muted-foreground shrink-0 text-xs">{e.detalle}</span>}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
