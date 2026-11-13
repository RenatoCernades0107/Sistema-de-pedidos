"use client";

import { useMemo, useState } from "react";
import { TriangleAlert } from "lucide-react";
import type { PlanchaUsada } from "@/lib/cad/acomodo";
import { PARAMETRO_ESPESOR } from "@/lib/cad/acomodo";
import { colorDe, espesorTexto, pideColor, type GrupoPlancha } from "@/lib/cortes/catalogo";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDiseno } from "./diseno-contexto";

const n = (x: number, d = 0) => x.toLocaleString("es-PE", { maximumFractionDigits: d });
const unicos = (xs: string[]) => [...new Set(xs)];

/**
 * Una plancha con sus piezas, a escala y apaisada. Cada pieza es su caja
 * envolvente con el nombre (si cabe); el resto de la plancha es merma o retazo.
 */
function DibujoPlancha({
  plancha: p,
  titulo,
  nombres,
  piezaActiva,
  alCambiarPieza,
}: {
  plancha: PlanchaUsada;
  titulo: string;
  nombres: Map<string, string>;
  piezaActiva: string | null;
  alCambiarPieza: (id: string | null) => void;
}) {
  const girar = p.altoMm > p.anchoMm;
  const W = girar ? p.altoMm : p.anchoMm;
  const H = girar ? p.anchoMm : p.altoMm;
  const letra = Math.max(W, H) / 40;
  const trazo = Math.max(W, H) / 500;

  return (
    <svg
      viewBox={`${-trazo} ${-trazo} ${W + 2 * trazo} ${H + 2 * trazo}`}
      role="img"
      aria-label={titulo}
      className="block h-auto w-full"
    >
      <title>{titulo}</title>
      <rect x={0} y={0} width={W} height={H} className="fill-muted stroke-border" strokeWidth={trazo} />
      {p.piezas.map((c) => {
        const x = girar ? c.yMm : c.xMm;
        const y = girar ? c.xMm : c.yMm;
        const w = girar ? c.altoMm : c.anchoMm;
        const h = girar ? c.anchoMm : c.altoMm;
        const activa = piezaActiva === c.id;
        const nombre = nombres.get(c.id) ?? c.id;
        const cabe = w > letra * Math.min(nombre.length, 14) * 0.6 && h > letra * 1.4;
        return (
          <g
            key={`${c.id}-${c.indice}`}
            className="cursor-pointer"
            onClick={() => alCambiarPieza(activa ? null : c.id)}
          >
            <title>{`${nombre}${c.rotada ? " (girada)" : ""} · ${n(c.anchoMm)} × ${n(c.altoMm)} mm`}</title>
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              strokeWidth={trazo}
              className={cn(
                activa ? "fill-amber-300/70 stroke-amber-700" : "fill-primary/15 stroke-primary/70",
              )}
            />
            {cabe && (
              <text
                x={x + w / 2}
                y={y + h / 2}
                fontSize={letra}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-foreground pointer-events-none"
              >
                {nombre.length > 14 ? `${nombre.slice(0, 13)}…` : nombre}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** Elegir la plancha del catálogo y ver cómo se acomodan las piezas en ella. */
export function PanelPlanchas() {
  const {
    catalogo,
    material,
    grupo,
    elegirMaterial,
    acomodo,
    problemasMaterial,
    parametros,
    resultado,
    cargando,
    piezaActiva,
    setPiezaActiva,
  } = useDiseno();
  const [colorLibre, setColorLibre] = useState(material?.color ?? "");

  const materiales = useMemo(() => unicos(catalogo.map((g) => g.material)), [catalogo]);
  const elegidoMaterial = grupo?.material ?? null;
  const colores = useMemo(
    () => unicos(catalogo.filter((g) => g.material === elegidoMaterial).map(colorDe)),
    [catalogo, elegidoMaterial],
  );
  const elegidoColor = grupo ? colorDe(grupo) : null;
  const espesores = useMemo(
    () => catalogo.filter((g) => g.material === elegidoMaterial && colorDe(g) === elegidoColor),
    [catalogo, elegidoMaterial, elegidoColor],
  );
  const nombres = useMemo(
    () => new Map((resultado?.piezas ?? []).map((p) => [p.id, p.nombre])),
    [resultado],
  );

  if (catalogo.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No se pudo leer el catálogo de planchas. Recarga la página para elegir el material.
      </p>
    );
  }

  const espesorParametro = parametros[PARAMETRO_ESPESOR];
  /** El grupo más parecido al que se pide: mismo espesor que el diseño si lo hay. */
  const elegirEntre = (grupos: GrupoPlancha[]) =>
    grupos.find((g) => g.espesorMm === espesorParametro) ?? grupos[0];
  const elegir = (g: GrupoPlancha | undefined) => {
    if (!g) return;
    const color = pideColor(g) ? colorLibre.trim() || null : null;
    void elegirMaterial({ grupoPlanchaId: g.id, color });
  };

  const sinEspesorEnCatalogo =
    grupo &&
    typeof espesorParametro === "number" &&
    !espesores.some((g) => g.espesorMm === espesorParametro)
      ? `No hay ${elegidoMaterial} ${elegidoColor?.toLowerCase()} de ${espesorTexto(espesorParametro)}: elige uno de ${espesores.map((g) => espesorTexto(g.espesorMm)).join(", ")}.`
      : null;
  const problemas = [...(sinEspesorEnCatalogo ? [sinEspesorEnCatalogo] : []), ...problemasMaterial];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-2 sm:grid-cols-3">
        <Select
          value={elegidoMaterial}
          onValueChange={(v) => elegir(elegirEntre(catalogo.filter((g) => g.material === v)))}
        >
          <SelectTrigger aria-label="Material" disabled={cargando} className="w-full">
            <SelectValue>{elegidoMaterial ?? "Material"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {materiales.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={elegidoColor}
          onValueChange={(v) =>
            elegir(elegirEntre(catalogo.filter((g) => g.material === elegidoMaterial && colorDe(g) === v)))
          }
        >
          <SelectTrigger aria-label="Color" disabled={cargando || !grupo} className="w-full">
            <SelectValue>{elegidoColor ?? "Color"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {colores.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={grupo?.id ?? null} onValueChange={(v) => elegir(espesores.find((g) => g.id === v))}>
          <SelectTrigger aria-label="Espesor" disabled={cargando || !grupo} className="w-full">
            <SelectValue>{grupo ? espesorTexto(grupo.espesorMm) : "Espesor"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {espesores.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {espesorTexto(g.espesorMm)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {grupo && pideColor(grupo) && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground text-xs">Color (el código de la plancha es el mismo para todos)</span>
          <Input
            value={colorLibre}
            maxLength={80}
            placeholder="Rojo, azul, negro…"
            onChange={(e) => setColorLibre(e.target.value)}
            onBlur={() => {
              const color = colorLibre.trim() || null;
              if (color !== (material?.color ?? null)) void elegirMaterial({ grupoPlanchaId: grupo.id, color });
            }}
          />
        </label>
      )}

      {!grupo && (
        <p className="text-muted-foreground text-sm">
          {material
            ? "El material guardado ya no está en el catálogo. Elige otro."
            : "Elige el material para ver cuántas planchas hacen falta y bajar el DXF por plancha."}
        </p>
      )}

      {problemas.length > 0 && (
        <ul role="alert" className="border-destructive/30 bg-destructive/5 flex flex-col gap-1 rounded-lg border px-3 py-2 text-sm">
          {problemas.map((p) => (
            <li key={p} className="flex items-start gap-2">
              <TriangleAlert className="text-destructive mt-0.5 size-4 shrink-0" aria-hidden />
              {p}
            </li>
          ))}
        </ul>
      )}

      {acomodo && (
        <>
          <dl className="grid grid-cols-3 gap-2 text-sm">
            <div className="bg-card rounded-lg border px-3 py-2">
              <dt className="text-muted-foreground text-xs">Planchas</dt>
              <dd className="font-medium tabular-nums">
                {acomodo.planchas.length} · {n(acomodo.anchoMm / 10, 1)}×{n(acomodo.altoMm / 10, 1)} cm
              </dd>
            </div>
            <div className="bg-card rounded-lg border px-3 py-2">
              <dt className="text-muted-foreground text-xs">Área de piezas</dt>
              <dd className="font-medium tabular-nums">{n(acomodo.areaPiezasMm2 / 1e6, 3)} m²</dd>
            </div>
            <div className="bg-card rounded-lg border px-3 py-2">
              <dt className="text-muted-foreground text-xs">Merma</dt>
              <dd className="font-medium tabular-nums">{n(acomodo.mermaPct, 1)} %</dd>
            </div>
          </dl>
          {acomodo.noCaben.length > 0 && (
            <p className="text-destructive text-sm">
              {acomodo.noCaben.length === 1 ? "1 pieza no entra" : `${acomodo.noCaben.length} piezas no entran`} en
              la plancha.
            </p>
          )}
          <ul className="flex flex-col gap-3">
            {acomodo.planchas.map((p, i) => (
              <li key={i} className="bg-card rounded-lg border p-2">
                <p className="text-muted-foreground mb-1.5 flex justify-between text-xs tabular-nums">
                  <span>
                    Plancha {i + 1} · {p.piezas.length} {p.piezas.length === 1 ? "pieza" : "piezas"} · uso{" "}
                    {n(p.usoPct, 1)} %
                  </span>
                  {p.mayorRetazo && (
                    <span>
                      Retazo mayor {n(p.mayorRetazo.anchoMm)}×{n(p.mayorRetazo.altoMm)} mm
                    </span>
                  )}
                </p>
                <DibujoPlancha
                  plancha={p}
                  titulo={`Plancha ${i + 1} de ${acomodo.planchas.length}`}
                  nombres={nombres}
                  piezaActiva={piezaActiva}
                  alCambiarPieza={setPiezaActiva}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
