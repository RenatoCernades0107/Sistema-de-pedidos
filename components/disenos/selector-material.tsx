"use client";

import { useMemo, useState } from "react";
import { ChevronsUpDown } from "lucide-react";
import { colorDeMaterial, grupoPara, mismoMaterial, nombreMaterial, type MaterialRef } from "@/lib/cad/materiales";
import { espesorTexto, type GrupoPlancha } from "@/lib/cortes/catalogo";
import { compararColores } from "@/lib/cortes/seleccion-material";
import { coincide, normalizar } from "@/lib/busqueda";
import { cn } from "@/lib/utils";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type MaterialCatalogo = MaterialRef & { grupos: GrupoPlancha[] };

interface Opcion {
  m: MaterialCatalogo;
  color: string;
  /** El catálogo lo tiene en el espesor de la copia. */
  hay: boolean;
  espesores: number[];
}

interface Tipo {
  nombre: string;
  opciones: Opcion[];
  hay: boolean;
  espesores: number[];
}

const unicos = (xs: number[]) => [...new Set(xs)].sort((a, b) => a - b);
const listaEspesores = (xs: number[]) => xs.map(espesorTexto).join(", ");

/**
 * El material de una copia en dos pasos: primero el tipo (Acrílico ECO,
 * PREMIUM…) y después el color. Por defecto solo salen los que el catálogo tiene
 * en el espesor de la copia; si se busca uno que no, se dice que no existe en
 * ese espesor y en cuáles sí.
 */
export function SelectorMaterial({
  materiales,
  material,
  espesorMm,
  deshabilitado,
  alElegir,
}: {
  materiales: readonly MaterialCatalogo[];
  /** El material vigente de la copia (propio o del diseño). */
  material: MaterialRef | null;
  espesorMm: number;
  deshabilitado: boolean;
  alElegir: (m: MaterialCatalogo) => void;
}) {
  const tipos = useMemo(() => {
    const porNombre = new Map<string, Tipo>();
    for (const m of materiales) {
      const espesores = unicos(m.grupos.map((g) => g.espesorMm));
      const opcion: Opcion = { m, color: colorDeMaterial(m), hay: grupoPara(m, espesorMm, m.grupos) !== null, espesores };
      const clave = normalizar(m.material);
      const tipo = porNombre.get(clave);
      if (tipo) {
        tipo.opciones.push(opcion);
        tipo.hay ||= opcion.hay;
        tipo.espesores = unicos([...tipo.espesores, ...espesores]);
      } else {
        porNombre.set(clave, { nombre: m.material, opciones: [opcion], hay: opcion.hay, espesores });
      }
    }
    const lista = [...porNombre.values()];
    for (const t of lista) t.opciones.sort((a, b) => compararColores(a.color, b.color));
    return lista.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  }, [materiales, espesorMm]);

  const [elegido, setElegido] = useState<string | null>(material?.material ?? null);
  const tipo = tipos.find((t) => elegido !== null && normalizar(t.nombre) === normalizar(elegido)) ?? null;
  const [abiertoTipo, setAbiertoTipo] = useState(false);
  const [abiertoColor, setAbiertoColor] = useState(false);

  const colorActual =
    material && tipo && normalizar(material.material) === normalizar(tipo.nombre) ? colorDeMaterial(material) : null;

  return (
    <div className="flex flex-col gap-1.5">
      <Combo
        etiqueta="Tipo de material"
        valor={tipo?.nombre ?? null}
        marcador="Elige el tipo"
        abierto={abiertoTipo}
        alAbrir={setAbiertoTipo}
        deshabilitado={deshabilitado}
        buscar="Buscar tipo…"
        elementos={tipos.map((t) => ({
          clave: t.nombre,
          texto: t.nombre,
          hay: t.hay,
          detalle: `${t.opciones.filter((o) => o.hay).length} colores`,
          aviso: `No existe ${t.nombre} en ${espesorTexto(espesorMm)}${t.espesores.length ? ` (hay en ${listaEspesores(t.espesores)})` : ""}.`,
          marcado: tipo?.nombre === t.nombre,
        }))}
        sinNada={`Ningún tipo de material en ${espesorTexto(espesorMm)}.`}
        alElegir={(clave) => {
          setElegido(clave);
          setAbiertoTipo(false);
          if (!material || normalizar(material.material) !== normalizar(clave)) setAbiertoColor(true);
        }}
      />
      <Combo
        etiqueta="Color"
        valor={colorActual}
        marcador={tipo ? "Elige el color" : "Primero elige el tipo"}
        abierto={abiertoColor}
        alAbrir={setAbiertoColor}
        deshabilitado={deshabilitado || !tipo}
        buscar="Buscar color…"
        elementos={(tipo?.opciones ?? []).map((o, i) => ({
          clave: String(i),
          texto: o.color,
          hay: o.hay,
          aviso: `No existe ${nombreMaterial(o.m)} en ${espesorTexto(espesorMm)}${o.espesores.length ? ` (hay en ${listaEspesores(o.espesores)})` : ""}.`,
          marcado: !!material && mismoMaterial({ ...o.m, color: null }, { ...material, color: null }),
        }))}
        sinNada={tipo ? `${tipo.nombre} no tiene colores en ${espesorTexto(espesorMm)}.` : ""}
        alElegir={(clave) => {
          const o = tipo?.opciones[Number(clave)];
          if (!o) return;
          setAbiertoColor(false);
          alElegir(o.m);
        }}
      />
    </div>
  );
}

interface Elemento {
  clave: string;
  texto: string;
  hay: boolean;
  detalle?: string;
  /** Lo que se dice si se busca y no existe en el espesor. */
  aviso: string;
  marcado: boolean;
}

function Combo({
  etiqueta,
  valor,
  marcador,
  abierto,
  alAbrir,
  deshabilitado,
  buscar,
  elementos,
  sinNada,
  alElegir,
}: {
  etiqueta: string;
  valor: string | null;
  marcador: string;
  abierto: boolean;
  alAbrir: (v: boolean) => void;
  deshabilitado: boolean;
  buscar: string;
  elementos: Elemento[];
  sinNada: string;
  alElegir: (clave: string) => void;
}) {
  const [consulta, setConsulta] = useState("");
  const buscando = consulta.trim() !== "";
  const coinciden = elementos.filter((e) => coincide(e.texto, consulta));
  const disponibles = coinciden.filter((e) => e.hay);
  // Los que no hay en el espesor solo se mencionan si se buscan.
  const ausentes = buscando ? coinciden.filter((e) => !e.hay) : [];

  return (
    <Popover
      open={abierto}
      onOpenChange={(v) => {
        alAbrir(v);
        if (!v) setConsulta("");
      }}
    >
      <PopoverTrigger
        aria-label={etiqueta}
        disabled={deshabilitado}
        className={cn(
          "border-input dark:bg-input/30 flex h-8 w-full min-w-0 items-center gap-2 rounded-lg border bg-transparent px-2.5 text-left text-sm transition-colors outline-none",
          "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        <span className="text-muted-foreground shrink-0 text-xs">{etiqueta.split(" ")[0]}</span>
        <span className={cn("min-w-0 flex-1 truncate text-right", !valor && "text-muted-foreground")} title={valor ?? undefined}>
          {valor ?? marcador}
        </span>
        <ChevronsUpDown className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--anchor-width) min-w-56 gap-0 p-0">
        <Command shouldFilter={false} label={etiqueta}>
          <CommandInput placeholder={buscar} value={consulta} onValueChange={setConsulta} />
          <CommandList className="max-h-64">
            {disponibles.length === 0 && ausentes.length === 0 && (
              <CommandEmpty className="text-muted-foreground px-3 py-4 text-xs">
                {buscando ? "Sin resultados." : sinNada}
              </CommandEmpty>
            )}
            {disponibles.length > 0 && (
              <CommandGroup>
                {disponibles.map((e) => (
                  <CommandItem
                    key={e.clave}
                    value={e.clave}
                    data-checked={e.marcado}
                    onSelect={() => alElegir(e.clave)}
                    className="items-start"
                  >
                    <span className="min-w-0 flex-1 break-words whitespace-normal">{e.texto}</span>
                    {e.detalle && <span className="text-muted-foreground shrink-0 text-xs">{e.detalle}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {ausentes.length > 0 && (
              <div className="border-t p-1" role="note">
                {ausentes.map((e) => (
                  <p key={e.clave} className="text-muted-foreground px-2 py-1.5 text-xs break-words">
                    {e.aviso}
                  </p>
                ))}
              </div>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
