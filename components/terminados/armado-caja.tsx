"use client";

import { useRef, useState, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { armadoDeCaja, type Cara } from "@/lib/terminados/armado";
import type { Geometria, Medidas } from "@/lib/terminados/geometria";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/** Lo que mide el lado más largo de la caja en el dibujo, en px. */
const LADO = 150;
/** Cuánto se separa una cara antes de llegar a su lugar, en px. */
const LLEGADA = 70;

const VISTA_INICIAL = { giro: -35, inclinacion: -22 };

/**
 * Las caras como divs en un espacio 3D de CSS: cada una se centra en el origen y
 * se lleva a su lugar. `desde` es dónde aparece en el paso en que se agrega.
 */
function colocacion(cara: Cara, W: number, D: number, H: number) {
  switch (cara) {
    case "base":
      return {
        w: W,
        h: D,
        hasta: `translateY(${H / 2}px) rotateX(90deg)`,
        desde: `translateY(${H / 2 + LLEGADA}px) rotateX(90deg)`,
      };
    case "tapa":
      return {
        w: W,
        h: D,
        hasta: `translateY(${-H / 2}px) rotateX(90deg)`,
        desde: `translateY(${-H / 2 - LLEGADA}px) rotateX(90deg)`,
      };
    case "frente":
      return { w: W, h: H, hasta: `translateZ(${D / 2}px)`, desde: `translateZ(${D / 2 + LLEGADA}px)` };
    case "fondo":
      return { w: W, h: H, hasta: `translateZ(${-D / 2}px)`, desde: `translateZ(${-D / 2 - LLEGADA}px)` };
    case "izquierda":
      return {
        w: D,
        h: H,
        hasta: `translateX(${-W / 2}px) rotateY(90deg)`,
        desde: `translateX(${-W / 2 - LLEGADA}px) rotateY(90deg)`,
      };
    case "derecha":
      return {
        w: D,
        h: H,
        hasta: `translateX(${W / 2}px) rotateY(90deg)`,
        desde: `translateX(${W / 2 + LLEGADA}px) rotateY(90deg)`,
      };
  }
}

/** Las caras a dibujar: `nueva` es la que se agrega en el paso que se mira. */
type CaraVisible = { cara: Cara; nueva: boolean };

/**
 * El escenario 3D: las caras dadas, una vista que se gira arrastrando y un botón
 * para volver a la vista inicial. Lo comparten la vista armada y los pasos.
 */
function Escena({
  medidas,
  caras,
  clave,
  lado,
  etiqueta,
  className,
}: {
  medidas: { largo: number; ancho: number; alto: number };
  caras: CaraVisible[];
  /** Cambia con el paso: así las caras nuevas vuelven a animarse. */
  clave: number;
  lado: number;
  etiqueta: string;
  className?: string;
}) {
  const [vista, setVista] = useState(VISTA_INICIAL);
  const arrastre = useRef<{ x: number; y: number; giro: number; inclinacion: number } | null>(null);

  const escala = lado / Math.max(medidas.largo, medidas.ancho, medidas.alto);
  const [W, D, H] = [medidas.largo * escala, medidas.ancho * escala, medidas.alto * escala];

  return (
    <div
      role="img"
      aria-label={etiqueta}
      className={cn(
        "bg-muted/30 relative cursor-grab touch-none overflow-hidden rounded-lg border select-none active:cursor-grabbing",
        className,
      )}
      style={{ perspective: `${lado * 6}px` }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        arrastre.current = { x: e.clientX, y: e.clientY, ...vista };
      }}
      onPointerMove={(e) => {
        const a = arrastre.current;
        if (!a) return;
        setVista({
          giro: a.giro + (e.clientX - a.x) * 0.5,
          inclinacion: Math.max(-80, Math.min(10, a.inclinacion - (e.clientY - a.y) * 0.4)),
        });
      }}
      onPointerUp={() => (arrastre.current = null)}
      onPointerCancel={() => (arrastre.current = null)}
    >
      <style>{`
        @keyframes armado-llega { from { transform: var(--desde); opacity: 0 } to { transform: var(--hasta); opacity: 1 } }
        .armado-nueva { animation: armado-llega 700ms cubic-bezier(.2,.7,.2,1) both }
        @media (prefers-reduced-motion: reduce) { .armado-nueva { animation: none } }
      `}</style>
      <div
        className="absolute top-1/2 left-1/2"
        style={{
          transformStyle: "preserve-3d",
          transform: `rotateX(${vista.inclinacion}deg) rotateY(${vista.giro}deg)`,
        }}
      >
        {caras.map(({ cara, nueva }) => {
          const c = colocacion(cara, W, D, H);
          return (
            <div
              key={nueva ? `${cara}-${clave}` : cara}
              className={cn(
                "absolute rounded-[2px] border-[1.5px]",
                nueva ? "armado-nueva bg-primary/30 border-primary" : "bg-primary/10 border-primary/60",
              )}
              style={
                {
                  width: c.w,
                  height: c.h,
                  marginLeft: -c.w / 2,
                  marginTop: -c.h / 2,
                  transform: c.hasta,
                  "--desde": c.desde,
                  "--hasta": c.hasta,
                } as CSSProperties
              }
            />
          );
        })}
      </div>
      <p className="text-muted-foreground pointer-events-none absolute bottom-1.5 left-2.5 text-[11px]">
        Arrastra para girar
      </p>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="absolute top-1 right-1"
        aria-label="Volver a la vista inicial"
        onClick={() => setVista(VISTA_INICIAL)}
      >
        <RotateCcw />
      </Button>
    </div>
  );
}

/**
 * La caja armada, entera, para verla de un vistazo junto a la ficha. Sin medidas
 * completas, o si no es una caja, no se dibuja nada.
 */
export function Caja3D({
  geometria,
  medidas,
  className,
}: {
  geometria: Geometria;
  medidas: Medidas;
  className?: string;
}) {
  const armado = armadoDeCaja(geometria, medidas);
  if (!armado) return null;
  return (
    <Escena
      medidas={armado}
      caras={armado.pasos.flatMap((p) => p.caras.map((cara) => ({ cara, nueva: false })))}
      clave={0}
      lado={95}
      etiqueta={`La caja armada: ${armado.largo} × ${armado.ancho} × ${armado.alto} cm`}
      className={cn("h-44", className)}
    />
  );
}

/**
 * Cómo se arma una caja, en 3D y paso a paso: cada paso agrega sus caras (más
 * marcadas, llegando a su lugar) sobre lo ya armado. Se gira arrastrando.
 */
export function ArmadoCaja({
  geometria,
  medidas,
  className,
}: {
  geometria: Geometria;
  medidas: Medidas;
  className?: string;
}) {
  const armado = armadoDeCaja(geometria, medidas);
  const [paso, setPaso] = useState(0);
  if (!armado) return null;
  const actual = Math.min(paso, armado.pasos.length - 1);
  const p = armado.pasos[actual];
  const visibles = armado.pasos
    .slice(0, actual + 1)
    .flatMap((x, i) => x.caras.map((cara) => ({ cara, nueva: i === actual })));

  return (
    <div className={cn("flex flex-col gap-3", className)} data-testid="armado-caja">
      <Escena
        medidas={armado}
        caras={visibles}
        clave={actual}
        lado={LADO}
        etiqueta={`Paso ${actual + 1} de ${armado.pasos.length}: ${p.titulo}, ${p.cantidad} × ${p.medida}`}
        className="h-72"
      />

      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1" aria-live="polite">
          <p className="text-sm font-medium">
            <span className="text-muted-foreground font-normal">
              Paso {actual + 1} de {armado.pasos.length} ·{" "}
            </span>
            {p.titulo}{" "}
            <span className="tnum text-muted-foreground font-normal">
              ({p.cantidad} × {p.medida})
            </span>
          </p>
          <p className="text-muted-foreground mt-0.5 text-sm">{p.indicacion}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Paso anterior"
            disabled={actual === 0}
            onClick={() => setPaso(actual - 1)}
          >
            <ChevronLeft />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Paso siguiente"
            disabled={actual === armado.pasos.length - 1}
            onClick={() => setPaso(actual + 1)}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>

      <ol className="flex gap-1.5" aria-label="Pasos del armado">
        {armado.pasos.map((x, i) => (
          <li key={x.titulo} className="flex-1">
            <button
              type="button"
              onClick={() => setPaso(i)}
              aria-current={i === actual ? "step" : undefined}
              aria-label={`Paso ${i + 1}: ${x.titulo}`}
              className={cn("h-1.5 w-full rounded-full", i <= actual ? "bg-primary" : "bg-muted")}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}
