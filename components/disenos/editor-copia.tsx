"use client";

import { useMemo, useState } from "react";
import { Loader2, X } from "lucide-react";
import { espesoresDe, ESPESOR_MAX_MM, ESPESOR_MIN_MM, claveEspesor } from "@/lib/cad/espesores";
import { numeroDeNodo } from "@/lib/cad/esquema";
import {
  espesoresDeMaterial,
  grupoPara,
  materialesDelCatalogo,
  mismoMaterial,
  nombreMaterial,
  type MaterialRef,
} from "@/lib/cad/materiales";
import { espesorTexto } from "@/lib/cortes/catalogo";
import { PLANTILLA_LIBRE } from "@/lib/cad/tipos";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDiseno } from "./diseno-contexto";

const DEL_DISENO = "__diseno__";

/**
 * La copia de pieza tocada en el visor, con su espesor y su material, que se
 * cambian por separado: lo normal es que todas las piezas compartan los del
 * diseño, pero cada copia puede llevar otro espesor, otro material, o los dos.
 *
 * El espesor cambia la geometría (regenera con `"espesor@<nodo>"`); el
 * material, solo las planchas en que se corta. En un diseño libre el espesor lo
 * fija el código: se cambia desde el chat.
 */
export function EditorCopia() {
  const {
    copiaActiva,
    setCopiaActiva,
    copias,
    parametros,
    plantilla,
    catalogo,
    materialesPorCopia,
    cambiarEspesor,
    cambiarMaterial,
    cargando,
    erroresCampo,
  } = useDiseno();

  const copia = copias.find((c) => c.nodo === copiaActiva) ?? null;
  // Las copias hermanas: las de la misma pieza de la plantilla, aunque se hayan separado por espesor.
  const hermanas = useMemo(() => {
    if (!copia) return [];
    const origen = copia.pieza.origen ?? copia.pieza.id;
    return copias
      .filter((c) => (c.pieza.origen ?? c.pieza.id) === origen)
      .sort((a, b) => numeroDeNodo(a.nodo) - numeroDeNodo(b.nodo));
  }, [copias, copia]);
  const materiales = useMemo(() => materialesDelCatalogo(catalogo), [catalogo]);

  if (!copia) return null;
  // `key`: cambiar de copia arranca el formulario limpio.
  return (
    <TarjetaCopia
      key={copia.nodo}
      nodo={copia.nodo}
      nombre={copia.pieza.nombre.replace(/ \([\d.,]+ mm\)$/, "")}
      numero={hermanas.findIndex((c) => c.nodo === copia.nodo) + 1}
      de={hermanas.length}
      espesorMm={copia.espesorMm}
      espesorPropio={espesoresDe(parametros)[copia.nodo] !== undefined}
      material={copia.material}
      materialPropio={materialesPorCopia[copia.nodo] !== undefined}
      tienePlancha={copia.grupo !== null}
      hermanas={hermanas.map((c) => c.nodo)}
      libre={plantilla === PLANTILLA_LIBRE}
      materiales={materiales}
      catalogo={catalogo}
      cargando={cargando}
      errorEspesor={erroresCampo[claveEspesor(copia.nodo)]}
      alCerrar={() => setCopiaActiva(null)}
      alCambiarEspesor={cambiarEspesor}
      alCambiarMaterial={cambiarMaterial}
    />
  );
}

function TarjetaCopia({
  nodo,
  nombre,
  numero,
  de,
  espesorMm,
  espesorPropio,
  material,
  materialPropio,
  tienePlancha,
  hermanas,
  libre,
  materiales,
  catalogo,
  cargando,
  errorEspesor,
  alCerrar,
  alCambiarEspesor,
  alCambiarMaterial,
}: {
  nodo: string;
  nombre: string;
  numero: number;
  de: number;
  espesorMm: number;
  espesorPropio: boolean;
  material: MaterialRef | null;
  materialPropio: boolean;
  tienePlancha: boolean;
  hermanas: string[];
  libre: boolean;
  materiales: ReturnType<typeof materialesDelCatalogo>;
  catalogo: Parameters<typeof espesoresDeMaterial>[1];
  cargando: boolean;
  errorEspesor?: string;
  alCerrar: () => void;
  alCambiarEspesor: (nodos: readonly string[], mm: number | null) => Promise<void>;
  alCambiarMaterial: (nodos: readonly string[], material: MaterialRef | null) => Promise<void>;
}) {
  const [texto, setTexto] = useState(String(espesorMm));
  const [todas, setTodas] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const nodos = todas ? hermanas : [nodo];
  const ocupado = cargando || guardando;

  const valor = Number(texto.trim().replace(",", "."));
  const errorLocal =
    texto.trim() === "" || !Number.isFinite(valor)
      ? "Escribe un número."
      : valor < ESPESOR_MIN_MM || valor > ESPESOR_MAX_MM
        ? `Entre ${ESPESOR_MIN_MM} y ${ESPESOR_MAX_MM} mm.`
        : null;

  // Los espesores que el catálogo tiene en el material de la copia; sin material, todos.
  const sugeridos = useMemo(() => {
    const lista = material
      ? espesoresDeMaterial(material, catalogo)
      : [...new Set(catalogo.map((g) => g.espesorMm))].sort((a, b) => a - b);
    return lista.slice(0, 8);
  }, [material, catalogo]);

  const indiceMaterial = material ? materiales.findIndex((m) => mismoMaterial({ ...m, color: null }, { ...material, color: null })) : -1;

  async function hacer(accion: () => Promise<void>) {
    setGuardando(true);
    try {
      await accion();
    } finally {
      setGuardando(false);
    }
  }

  function aplicarEspesor(mm: number) {
    if (Math.abs(mm - espesorMm) < 1e-6 && !todas) return;
    void hacer(() => alCambiarEspesor(nodos, mm));
  }

  function elegirMaterial(v: string | null) {
    if (v === null) return;
    if (v === DEL_DISENO) {
      void hacer(() => alCambiarMaterial(nodos, null));
      return;
    }
    const m = materiales[Number(v)];
    if (!m) return;
    void hacer(() =>
      alCambiarMaterial(nodos, { material: m.material, variante: m.variante, detalle: m.detalle, color: null }),
    );
  }

  const sinPlanchaEnEspesor =
    material && !tienePlancha
      ? `El catálogo no tiene ${nombreMaterial(material)} de ${espesorTexto(espesorMm)}: cambia el espesor o el material.`
      : null;

  return (
    <section
      aria-label={`${nombre}, copia ${numero} de ${de}`}
      className="bg-background/95 absolute top-10 right-2 z-10 flex w-72 max-w-[calc(100%-1rem)] flex-col gap-3 rounded-lg border p-3 text-sm shadow-md backdrop-blur"
    >
      <header className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{nombre}</p>
          <p className="text-muted-foreground text-xs">
            {de > 1 ? `Copia ${numero} de ${de}` : "Una sola copia"}
            {ocupado && <Loader2 className="ml-1.5 inline size-3 animate-spin" aria-label="Guardando" />}
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={alCerrar} aria-label="Cerrar">
          <X />
        </Button>
      </header>

      {de > 1 && (
        <label className="flex items-center gap-2 text-xs">
          <Checkbox checked={todas} onCheckedChange={(v) => setTodas(v === true)} />
          Aplicar a las {de} copias de esta pieza
        </label>
      )}

      {/* Espesor */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs font-medium">Espesor</span>
          {espesorPropio && <Badge variant="outline">propio</Badge>}
        </div>
        {libre ? (
          <p className="text-muted-foreground text-xs">
            {espesorTexto(espesorMm)}. En un diseño personalizado el espesor lo fija el código: pídeselo al asistente.
          </p>
        ) : (
          <>
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!errorLocal) aplicarEspesor(valor);
              }}
            >
              <div className="relative flex-1">
                <Input
                  value={texto}
                  inputMode="decimal"
                  aria-label="Espesor en mm"
                  aria-invalid={!!(errorLocal ?? errorEspesor)}
                  onChange={(e) => setTexto(e.target.value)}
                  className="pr-9 tabular-nums"
                  disabled={ocupado}
                />
                <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs">
                  mm
                </span>
              </div>
              <Button type="submit" size="sm" disabled={ocupado || !!errorLocal}>
                Aplicar
              </Button>
            </form>
            {(errorLocal ?? errorEspesor) && (
              <p className="text-destructive text-xs">{errorLocal ?? errorEspesor}</p>
            )}
            {sugeridos.length > 0 && (
              <div className="flex flex-wrap gap-1" aria-label="Espesores del catálogo">
                {sugeridos.map((mm) => (
                  <button
                    key={mm}
                    type="button"
                    disabled={ocupado}
                    onClick={() => {
                      setTexto(String(mm));
                      aplicarEspesor(mm);
                    }}
                    className={cn(
                      "rounded-md border px-1.5 py-0.5 text-xs tabular-nums transition-colors disabled:opacity-50",
                      Math.abs(mm - espesorMm) < 1e-6
                        ? "border-primary bg-primary/10 text-primary"
                        : "hover:bg-muted",
                    )}
                  >
                    {espesorTexto(mm)}
                  </button>
                ))}
              </div>
            )}
            {(espesorPropio || todas) && (
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground self-start text-xs underline-offset-2 hover:underline disabled:opacity-50"
                disabled={ocupado}
                onClick={() => void hacer(() => alCambiarEspesor(nodos, null))}
              >
                Usar el espesor del diseño
              </button>
            )}
            <p className="text-muted-foreground text-xs">
              La copia crece hacia fuera; las uniones con las piezas vecinas no se reajustan.
            </p>
          </>
        )}
      </div>

      {/* Material */}
      <div className="flex flex-col gap-1.5 border-t pt-3">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs font-medium">Material</span>
          {materialPropio && <Badge variant="outline">propio</Badge>}
        </div>
        {materiales.length === 0 ? (
          <p className="text-muted-foreground text-xs">No se pudo leer el catálogo de planchas.</p>
        ) : (
          <Select value={materialPropio && indiceMaterial >= 0 ? String(indiceMaterial) : DEL_DISENO} onValueChange={elegirMaterial}>
            <SelectTrigger aria-label="Material de la copia" disabled={ocupado} className="w-full">
              <SelectValue>
                {materialPropio && material ? nombreMaterial(material) : material ? `Del diseño (${nombreMaterial(material)})` : "Del diseño (sin elegir)"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEL_DISENO}>Del diseño</SelectItem>
              {materiales.map((m, i) => {
                const hay = grupoPara(m, espesorMm, m.grupos) !== null;
                return (
                  <SelectItem key={i} value={String(i)}>
                    {nombreMaterial(m)}
                    {!hay && <span className="text-muted-foreground ml-1 text-xs">(sin {espesorTexto(espesorMm)})</span>}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        )}
        {sinPlanchaEnEspesor && <p className="text-destructive text-xs">{sinPlanchaEnEspesor}</p>}
      </div>
    </section>
  );
}
