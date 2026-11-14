"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import { Box, Loader2, RotateCw, TriangleAlert } from "lucide-react";
import { valoresPorDefecto } from "@/lib/cad/esquema";
import { nombreDeGrupo } from "@/lib/cortes/catalogo";
import type { FamiliaCad, PlantillaCad } from "@/lib/cad/tipos";
import { PLANTILLA_LIBRE } from "@/lib/cad/tipos";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Descargas } from "./descargas";
import { EditorCopia } from "./editor-copia";
import { DescargasLibre, DisenoLibre, InsigniaLibre } from "./diseno-libre";
import { useDiseno } from "./diseno-contexto";
import { FormularioParametros } from "./formulario-parametros";
import { ListaPiezas, ListaValidaciones } from "./lista-piezas";

/*
 * Las partes del diseño que se reparten en la pantalla: el visor, que ocupa
 * toda la columna derecha, y lo que va en cada pestaña del menú de la izquierda
 * (Modelo, Parámetros, Piezas). Planchas y Costo tienen sus propios archivos.
 * Las usan `/disenos/[id]` y el producto terminado de `/pedidos/nuevo`.
 */

// three necesita `window` y un `<canvas>`: el visor no se prerenderiza. `ssr:
// false` solo se admite desde un Client Component, y este lo es.
const Visor3D = dynamic(() => import("./visor-3d"), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-none" />,
});

export const FAMILIAS: Record<FamiliaCad, string> = {
  anforas: "Ánforas",
  cajas: "Cajas",
  displays: "Displays",
  porta_afiches: "Porta afiches",
  letras: "Letras",
  alzadores: "Alzadores",
  tarecos: "Tarecos",
  letreros: "Letreros",
  atriles: "Atriles",
};

export function Aviso({ children, accion }: { children: React.ReactNode; accion?: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="border-st-observado/25 bg-st-observado-soft flex items-start gap-2.5 rounded-lg border px-3 py-2 text-sm"
    >
      <TriangleAlert className="text-st-observado mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
      {accion}
    </div>
  );
}

/** El error de la última generación, con su "Reintentar". Va arriba de cualquier pestaña. */
export function AvisoGeneracion() {
  const { error, cargando, aplicar, plantilla, parametros } = useDiseno();
  if (!error || plantilla === null) return null;
  return (
    <Aviso
      accion={
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={cargando}
          onClick={() => void aplicar(plantilla, parametros, { guardar: false })}
        >
          <RotateCw />
          Reintentar
        </Button>
      }
    >
      {error}
    </Aviso>
  );
}

/** El motor no contestó al abrir: no hay plantillas que ofrecer. */
export function AvisoMotor({ avisoMotor }: { avisoMotor?: string | null }) {
  return (
    <Aviso>
      <p className="font-medium">El motor de diseños no está disponible</p>
      <p className="text-foreground/80">
        {avisoMotor ?? "No hay plantillas que mostrar."} Recarga la página en unos minutos.
      </p>
    </Aviso>
  );
}

/** Pestaña Modelo de `/disenos`: de qué plantilla del motor parte el diseño. También se pide por el chat. */
export function SelectorPlantilla({ alElegir }: { alElegir?: () => void }) {
  const { plantillas, plantilla, aplicar, cargando } = useDiseno();

  const grupos = useMemo(() => {
    const porFamilia = new Map<string, PlantillaCad[]>();
    for (const p of plantillas) {
      porFamilia.set(p.familia, [...(porFamilia.get(p.familia) ?? []), p]);
    }
    return [...porFamilia.entries()];
  }, [plantillas]);

  return (
    <div className="flex flex-col gap-5">
      <p className="text-muted-foreground text-sm">
        Las plantillas del motor de diseños. O descríbele al asistente lo que necesitas y él la elige por ti.
      </p>

      {grupos.map(([familia, lista]) => (
        <section key={familia}>
          <h3 className="eyebrow mb-2">{FAMILIAS[familia as FamiliaCad] ?? familia}</h3>
          <ul className="grid gap-2 sm:grid-cols-2">
            {lista.map((p) => {
              const actual = p.codigo === plantilla;
              return (
                <li key={p.codigo}>
                  <button
                    type="button"
                    disabled={cargando}
                    aria-pressed={actual}
                    onClick={() => {
                      alElegir?.();
                      if (!actual) void aplicar(p.codigo, valoresPorDefecto(p.esquema));
                    }}
                    className={cn(
                      "bg-card hover:border-primary/40 hover:bg-primary/[0.04] focus-visible:ring-ring h-full w-full rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50",
                      actual && "border-primary bg-primary/[0.05] ring-primary/20 ring-2",
                    )}
                  >
                    <span className="block text-sm font-medium">{p.nombre}</span>
                    <span className="text-muted-foreground mt-0.5 block text-xs">{p.descripcion}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Pestaña Parámetros. */
export function PestanaParametros() {
  const { plantillas, plantilla } = useDiseno();
  const actual = plantillas.find((p) => p.codigo === plantilla) ?? null;
  if (plantilla === null) {
    return <p className="text-muted-foreground text-sm">Elige un modelo para ver sus parámetros.</p>;
  }
  if (plantilla === PLANTILLA_LIBRE) return <DisenoLibre />;
  if (!actual) {
    return (
      <p className="text-muted-foreground text-sm">
        La plantilla «{plantilla}» ya no existe en el motor. Elige otra en Modelo para seguir.
      </p>
    );
  }
  // Con `key`, cambiar de plantilla arranca un formulario limpio.
  return <FormularioParametros key={actual.codigo} plantilla={actual} />;
}

/** Pestaña Piezas: las validaciones (si hay) arriba y el despiece. */
export function PestanaPiezas() {
  const { resultado, piezaActiva, setPiezaActiva, plantilla } = useDiseno();
  if (!resultado) return <p className="text-muted-foreground text-sm">El despiece aparece al generar el diseño.</p>;
  return (
    <div className="flex flex-col gap-4">
      <div className="sm:hidden">{plantilla === PLANTILLA_LIBRE ? <DescargasLibre /> : <Descargas />}</div>
      {resultado.validaciones.length > 0 && (
        <ListaValidaciones
          validaciones={resultado.validaciones}
          piezas={resultado.piezas}
          piezaActiva={piezaActiva}
          alCambiarPieza={setPiezaActiva}
        />
      )}
      <ListaPiezas
        piezas={resultado.piezas}
        validaciones={resultado.validaciones}
        piezaActiva={piezaActiva}
        alCambiarPieza={setPiezaActiva}
      />
    </div>
  );
}

/** Los números que el menú enseña junto a cada pestaña. */
export function useResumenDiseno() {
  const { resultado, gruposPlanchas, problemasMaterial } = useDiseno();
  const errores = resultado?.validaciones.filter((v) => v.nivel === "error").length ?? 0;
  const avisos = (resultado?.validaciones.length ?? 0) - errores;
  const piezas = resultado?.piezas.reduce((n, p) => n + p.cantidad, 0) ?? 0;
  return {
    piezas,
    errores,
    avisos,
    planchas: gruposPlanchas.reduce((n, g) => n + (g.acomodo?.planchas.length ?? 0), 0),
    problemasMaterial: problemasMaterial.length,
  };
}

/**
 * El visor del diseño a todo el alto: el modelo, con una ficha arriba (qué es y
 * cuánto mide) y las descargas; abajo, el material y "Separar piezas".
 */
export function VisorDiseno({ nombre, avisoMotor }: { nombre?: string | null; avisoMotor?: string | null }) {
  const {
    plantillas,
    plantilla,
    resultado,
    cargando,
    piezaActiva,
    setPiezaActiva,
    tinte,
    tintes,
    grupo,
    copiaActiva,
    setCopiaActiva,
    modoCaras,
    setModoCaras,
    carasReferidas,
    alternarCara,
  } = useDiseno();
  const idsPiezas = useMemo(() => resultado?.piezas.map((p) => p.id) ?? [], [resultado]);
  const nombresPiezas = useMemo(
    () => Object.fromEntries(resultado?.piezas.map((p) => [p.id, p.nombre]) ?? []),
    [resultado],
  );
  const clavesCaras = useMemo(() => carasReferidas.map((c) => c.clave), [carasReferidas]);
  const actual = plantillas.find((p) => p.codigo === plantilla) ?? null;
  const esLibre = plantilla === PLANTILLA_LIBRE;
  const piezas = resultado?.piezas.reduce((n, p) => n + p.cantidad, 0) ?? 0;
  const d = resultado?.dimensiones;
  const mm = (x: number) => Math.round(x);

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden bg-gradient-to-b from-muted/30 to-muted/70">
      {resultado ? (
        <Visor3D
          glbBase64={resultado.glb_base64}
          dimensiones={resultado.dimensiones}
          idsPiezas={idsPiezas}
          piezaActiva={piezaActiva}
          alCambiarPieza={setPiezaActiva}
          tinte={tinte}
          tintes={tintes}
          nodoActivo={copiaActiva}
          alElegirCopia={(c) => setCopiaActiva(c?.nodo ?? null)}
          nombresPiezas={nombresPiezas}
          modoCaras={modoCaras}
          alCambiarModoCaras={setModoCaras}
          carasSeleccionadas={clavesCaras}
          alAlternarCara={alternarCara}
          sinMedidas
        />
      ) : cargando ? (
        <Skeleton className="h-full w-full rounded-none" />
      ) : (
        <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
          {plantillas.length === 0 ? (
            <div className="max-w-sm">
              <AvisoMotor avisoMotor={avisoMotor} />
            </div>
          ) : (
            <>
              <Box className="size-8 opacity-50" aria-hidden />
              <p className="text-foreground/80 text-sm font-medium">Todavía no hay un modelo que mostrar.</p>
              <p className="max-w-xs text-xs">Elige uno en la pestaña Modelo o descríbelo en el chat.</p>
            </>
          )}
        </div>
      )}

      {/* Arriba: qué es y cuánto mide; las descargas. */}
      {plantilla !== null && (
        <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start gap-2">
          <div className="bg-background/90 pointer-events-auto min-w-0 rounded-lg border px-3 py-1.5 shadow-xs backdrop-blur">
            {esLibre ? (
              <InsigniaLibre />
            ) : (
              <p className="truncate text-sm font-medium">{nombre || actual?.nombre || plantilla}</p>
            )}
            <p className="text-muted-foreground flex items-center gap-1.5 font-mono text-xs tabular-nums">
              {d ? `${mm(d.x)} × ${mm(d.y)} × ${mm(d.z)} mm` : "Sin medidas todavía"}
              {piezas > 0 && ` · ${piezas} ${piezas === 1 ? "pieza" : "piezas"}`}
              {cargando && (
                <span role="status" className="inline-flex items-center gap-1 font-sans">
                  · <Loader2 className="size-3 animate-spin" aria-hidden />
                  Generando…
                </span>
              )}
            </p>
            {grupo && <p className="text-muted-foreground truncate text-xs">{nombreDeGrupo(grupo)}</p>}
          </div>
          {/* En el celular no caben sobre el modelo: van arriba de la pestaña Piezas. */}
          <div className="bg-background/90 pointer-events-auto ml-auto hidden rounded-lg border p-1 shadow-xs backdrop-blur empty:hidden sm:block">
            {esLibre ? <DescargasLibre /> : <Descargas />}
          </div>
        </div>
      )}

      {/* La copia elegida en el modelo: su espesor y material propios. Debajo de la ficha. */}
      {resultado && !modoCaras && (
        <div className="pointer-events-none absolute inset-x-0 top-8 bottom-0 [&>*]:pointer-events-auto">
          <EditorCopia />
        </div>
      )}
    </div>
  );
}
