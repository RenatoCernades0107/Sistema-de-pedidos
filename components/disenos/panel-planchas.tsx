"use client";

import { useMemo, useState } from "react";
import { Download, Info, Loader2, TriangleAlert } from "lucide-react";
import type { PlanchaUsada } from "@/lib/cad/acomodo";
import { PARAMETRO_ESPESOR } from "@/lib/cad/acomodo";
import type { PlanchasDeGrupo } from "@/lib/cad/materiales";
import { nombreArchivo } from "@/lib/cad/esquema";
import { PLANTILLA_LIBRE } from "@/lib/cad/tipos";
import { Button } from "@/components/ui/button";
import { colorDe, espesorTexto, type GrupoPlancha } from "@/lib/cortes/catalogo";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDiseno } from "./diseno-contexto";
import { bajarDxfPlanchas, sufijoDeGrupo } from "./dxf-planchas";
import { OpcionesFormato } from "./opciones-formato";

const n = (x: number, d = 0) => x.toLocaleString("es-PE", { maximumFractionDigits: d });
const unicos = (xs: string[]) => [...new Set(xs)];

/**
 * Una plancha con sus piezas, a escala y apaisada. Cada pieza es su contorno
 * real si el motor lo manda (`PiezaCad.contorno`) o, si no, su caja
 * envolvente; el resto de la plancha es merma o retazo.
 *
 * Todo se dibuja en coordenadas de la plancha (Y hacia abajo, como el acomodo).
 * Una plancha más alta que ancha se gira 90° para verla apaisada: es un giro,
 * no un cambio de ejes, para que las piezas no se vean espejadas.
 */
function DibujoPlancha({
  plancha: p,
  titulo,
  nombres,
  contornos,
  piezaActiva,
  alCambiarPieza,
}: {
  plancha: PlanchaUsada;
  titulo: string;
  nombres: Map<string, string>;
  contornos: Map<string, string>;
  piezaActiva: string | null;
  alCambiarPieza: (id: string | null) => void;
}) {
  const girar = p.altoMm > p.anchoMm;
  const W = girar ? p.altoMm : p.anchoMm;
  const H = girar ? p.anchoMm : p.altoMm;
  const letra = Math.max(W, H) / 40;
  const trazo = Math.max(W, H) / 500;
  // De la plancha a la vista: (x, y) → (y, ancho − x) si se gira.
  const aVista = (x: number, y: number) => (girar ? { x: y, y: p.anchoMm - x } : { x, y });

  return (
    <svg
      viewBox={`${-trazo} ${-trazo} ${W + 2 * trazo} ${H + 2 * trazo}`}
      role="img"
      aria-label={titulo}
      className="block h-auto w-full"
    >
      <title>{titulo}</title>
      <rect x={0} y={0} width={W} height={H} className="fill-muted stroke-border" strokeWidth={trazo} />
      <g transform={girar ? `matrix(0 -1 1 0 0 ${p.anchoMm})` : undefined}>
        {p.piezas.map((c) => {
          const activa = piezaActiva === c.id;
          const nombre = nombres.get(c.id) ?? c.id;
          const contorno = contornos.get(c.id);
          // Girada, la pieza va 90° antihoraria como en el DXF; su ancho original es el alto colocado.
          const forma = `translate(${c.xMm} ${c.yMm})${c.rotada ? ` matrix(0 -1 1 0 0 ${c.altoMm})` : ""}`;
          return (
            <g
              key={`${c.id}-${c.indice}`}
              className="cursor-pointer"
              onClick={() => alCambiarPieza(activa ? null : c.id)}
            >
              <title>{`${nombre}${c.rotada ? " (girada)" : ""} · ${n(c.anchoMm)} × ${n(c.altoMm)} mm`}</title>
              <rect
                x={c.xMm}
                y={c.yMm}
                width={c.anchoMm}
                height={c.altoMm}
                strokeWidth={trazo}
                strokeDasharray={contorno ? `${trazo * 4} ${trazo * 4}` : undefined}
                className={cn(
                  contorno
                    ? activa
                      ? "fill-amber-300/10 stroke-amber-700/40"
                      : "fill-transparent stroke-primary/25"
                    : activa
                      ? "fill-amber-300/70 stroke-amber-700"
                      : "fill-primary/15 stroke-primary/70",
                )}
              />
              {contorno && (
                <path
                  d={contorno}
                  transform={forma}
                  fillRule="evenodd"
                  strokeWidth={trazo}
                  strokeLinejoin="round"
                  className={activa ? "fill-amber-300/70 stroke-amber-700" : "fill-primary/15 stroke-primary/70"}
                />
              )}
            </g>
          );
        })}
      </g>
      {p.piezas.map((c) => {
        const nombre = nombres.get(c.id) ?? c.id;
        const centro = aVista(c.xMm + c.anchoMm / 2, c.yMm + c.altoMm / 2);
        const w = girar ? c.altoMm : c.anchoMm;
        const h = girar ? c.anchoMm : c.altoMm;
        const cabe = w > letra * Math.min(nombre.length, 14) * 0.6 && h > letra * 1.4;
        if (!cabe) return null;
        return (
          <text
            key={`${c.id}-${c.indice}-nombre`}
            x={centro.x}
            y={centro.y}
            fontSize={letra}
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-foreground pointer-events-none"
          >
            {nombre.length > 14 ? `${nombre.slice(0, 13)}…` : nombre}
          </text>
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
    gruposPlanchas,
    problemasMaterial,
    avisosMaterial,
    parametros,
    resultado,
    cargando,
    piezaActiva,
    setPiezaActiva,
    unidades,
  } = useDiseno();

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
  const contornos = useMemo(
    () =>
      new Map(
        (resultado?.piezas ?? []).flatMap((p) => (p.contorno ? [[p.id, p.contorno] as const] : [])),
      ),
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
    // Cada color tiene su grupo (y su código): no hay color aparte que guardar.
    void elegirMaterial({ grupoPlanchaId: g.id, color: null });
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

      {avisosMaterial.length > 0 && (
        <ul
          className="flex flex-col gap-1 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
          data-testid="avisos-material"
        >
          {avisosMaterial.map((a) => (
            <li key={a} className="flex items-start gap-2">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              {a}
            </li>
          ))}
        </ul>
      )}

      {unidades > 1 && gruposPlanchas.length > 0 && (
        <p className="bg-primary/5 border-primary/20 rounded-lg border px-3 py-2 text-sm" data-testid="lote-planchas">
          Acomodo para <strong className="tabular-nums">{unidades} unidades</strong> (
          {n(gruposPlanchas.reduce((s, g) => s + g.copias, 0))} piezas), la cantidad del pie. El DXF baja el lote completo.
        </p>
      )}
      {gruposPlanchas.length > 1 && (
        <p className="text-muted-foreground text-sm">
          Las piezas van en {gruposPlanchas.length} tipos de plancha: algunas copias tienen otro espesor o material
          (se cambian tocándolas en el visor).
        </p>
      )}
      {gruposPlanchas.map((g) => (
        <SeccionGrupo
          key={g.clave}
          grupo={g}
          varios={gruposPlanchas.length > 1}
          nombres={nombres}
          contornos={contornos}
          piezaActiva={piezaActiva}
          alCambiarPieza={setPiezaActiva}
        />
      ))}
    </div>
  );
}

/** Un grupo de plancha (material × espesor): su acomodo, sus planchas y, si hay varios, su DXF. */
function SeccionGrupo({
  grupo: g,
  varios,
  nombres,
  contornos,
  piezaActiva,
  alCambiarPieza,
}: {
  grupo: PlanchasDeGrupo;
  varios: boolean;
  nombres: Map<string, string>;
  contornos: Map<string, string>;
  piezaActiva: string | null;
  alCambiarPieza: (id: string | null) => void;
}) {
  const { resultado, disenoId, corte, cargando, plantilla } = useDiseno();
  const [bajando, setBajando] = useState(false);
  const acomodo = g.acomodo;
  if (!acomodo) return null;

  const errores = resultado?.validaciones.some((v) => v.nivel === "error") ?? false;
  const libre = plantilla === PLANTILLA_LIBRE;
  async function bajar() {
    if (!resultado || bajando) return;
    setBajando(true);
    const base = libre ? "diseno-personalizado" : nombreArchivo(resultado.plantilla, resultado.dimensiones, "dxf").replace(/\.dxf$/, "");
    await bajarDxfPlanchas({
      resultado,
      disenoId,
      grupos: [g],
      kerfMm: corte.kerfMm,
      parcial: true,
      nombre: `${base}-${sufijoDeGrupo(g.etiqueta)}.dxf`,
    });
    setBajando(false);
  }

  return (
    <section className="flex flex-col gap-3" aria-label={g.etiqueta}>
      {varios && (
        <header className="flex flex-wrap items-center gap-2 border-t pt-3">
          <h3 className="min-w-0 flex-1 text-sm font-medium">
            {g.etiqueta}
            <span className="text-muted-foreground ml-1.5 text-xs font-normal">
              {g.copias} {g.copias === 1 ? "pieza" : "piezas"}
            </span>
          </h3>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={cargando || bajando || errores || acomodo.noCaben.length > 0 || (libre && !resultado)}
            onClick={() => void bajar()}
            title="Solo las planchas de este material y espesor"
          >
            {bajando ? <Loader2 className="animate-spin" /> : <Download />}
            DXF
          </Button>
        </header>
      )}
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
      <OpcionesFormato grupo={g} />
      {acomodo.noCaben.length > 0 && (
        <p className="text-destructive text-sm">
          {acomodo.noCaben.length === 1 ? "1 pieza no entra" : `${acomodo.noCaben.length} piezas no entran`} en la
          plancha.
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
              titulo={`${varios ? `${g.etiqueta} · ` : ""}Plancha ${i + 1} de ${acomodo.planchas.length}`}
              nombres={nombres}
              contornos={contornos}
              piezaActiva={piezaActiva}
              alCambiarPieza={alCambiarPieza}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
