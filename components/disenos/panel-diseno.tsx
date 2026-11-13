"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { ArrowLeftRight, Loader2, RotateCw, TriangleAlert } from "lucide-react";
import { valoresPorDefecto } from "@/lib/cad/esquema";
import type { FamiliaCad, PlantillaCad } from "@/lib/cad/tipos";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Descargas } from "./descargas";
import { useDiseno } from "./diseno-contexto";
import { FormularioParametros } from "./formulario-parametros";
import { ListaPiezas, ListaValidaciones } from "./lista-piezas";

// three necesita `window` y un `<canvas>`: el visor no se prerenderiza. `ssr:
// false` solo se admite desde un Client Component, y este lo es.
const Visor3D = dynamic(() => import("./visor-3d"), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-none" />,
});

const FAMILIAS: Record<FamiliaCad, string> = {
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

function Aviso({ children, accion }: { children: React.ReactNode; accion?: React.ReactNode }) {
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

/** Elegir de qué plantilla parte el diseño. También se puede pedir por el chat. */
function SelectorPlantilla({ alCancelar }: { alCancelar?: () => void }) {
  const { plantillas, aplicar, cargando } = useDiseno();

  const grupos = useMemo(() => {
    const porFamilia = new Map<string, PlantillaCad[]>();
    for (const p of plantillas) {
      porFamilia.set(p.familia, [...(porFamilia.get(p.familia) ?? []), p]);
    }
    return [...porFamilia.entries()];
  }, [plantillas]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">Elige una plantilla</h2>
          <p className="text-muted-foreground mt-0.5 text-sm">
            O descríbele al asistente lo que necesitas y él la elige por ti.
          </p>
        </div>
        {alCancelar && (
          <Button variant="ghost" size="sm" onClick={alCancelar}>
            Cancelar
          </Button>
        )}
      </div>

      {grupos.map(([familia, lista]) => (
        <section key={familia}>
          <h3 className="eyebrow mb-2">{FAMILIAS[familia as FamiliaCad] ?? familia}</h3>
          <ul className="grid gap-2 sm:grid-cols-2">
            {lista.map((p) => (
              <li key={p.codigo}>
                <button
                  type="button"
                  disabled={cargando}
                  onClick={() => {
                    alCancelar?.();
                    void aplicar(p.codigo, valoresPorDefecto(p.esquema));
                  }}
                  className="bg-card hover:border-primary/40 hover:bg-primary/[0.04] focus-visible:ring-ring h-full w-full rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
                >
                  <span className="block text-sm font-medium">{p.nombre}</span>
                  <span className="text-muted-foreground mt-0.5 block text-xs">{p.descripcion}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * La mitad derecha de `/disenos/[id]`: el render arriba y, debajo, los
 * parámetros, el despiece y las validaciones del diseño vigente.
 *
 * `avisoMotor` llega cuando el servidor no pudo hablar con el motor CAD al
 * cargar la página: la pantalla se pinta igual, con el motivo a la vista.
 */
export function PanelDiseno({ avisoMotor }: { avisoMotor?: string | null }) {
  const {
    plantillas,
    plantilla,
    parametros,
    resultado,
    cargando,
    error,
    piezaActiva,
    setPiezaActiva,
    aplicar,
  } = useDiseno();
  const [cambiando, setCambiando] = useState(false);
  const [pestana, setPestana] = useState("parametros");

  const actual = plantillas.find((p) => p.codigo === plantilla) ?? null;
  const idsPiezas = useMemo(() => resultado?.piezas.map((p) => p.id) ?? [], [resultado]);

  if (plantillas.length === 0) {
    return (
      <div className="p-4">
        <Aviso>
          <p className="font-medium">El motor de diseños no está disponible</p>
          <p className="text-foreground/80">
            {avisoMotor ?? "No hay plantillas que mostrar."} Recarga la página en unos minutos.
          </p>
        </Aviso>
      </div>
    );
  }

  if (plantilla === null || cambiando) {
    return (
      <div className="h-full overflow-y-auto p-4">
        <SelectorPlantilla alCancelar={plantilla !== null ? () => setCambiando(false) : undefined} />
      </div>
    );
  }

  const errores = resultado?.validaciones.filter((v) => v.nivel === "error").length ?? 0;
  const avisos = (resultado?.validaciones.length ?? 0) - errores;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="bg-muted/40 relative h-[42%] min-h-48 shrink-0 border-b">
        {resultado ? (
          <Visor3D
            glbBase64={resultado.glb_base64}
            dimensiones={resultado.dimensiones}
            idsPiezas={idsPiezas}
            piezaActiva={piezaActiva}
            alCambiarPieza={setPiezaActiva}
          />
        ) : cargando ? (
          <Skeleton className="h-full w-full rounded-none" />
        ) : (
          <p className="text-muted-foreground grid h-full place-items-center p-6 text-center text-sm">
            Todavía no hay un modelo que mostrar.
          </p>
        )}
        {cargando && resultado && (
          <span
            role="status"
            className="bg-background/80 text-muted-foreground absolute top-2 right-2 inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs backdrop-blur"
          >
            <Loader2 className="size-3 animate-spin" />
            Generando…
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{actual?.nombre ?? plantilla}</p>
          {actual && <p className="text-muted-foreground truncate text-xs">{actual.descripcion}</p>}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground gap-1.5"
          onClick={() => setCambiando(true)}
        >
          <ArrowLeftRight />
          Cambiar plantilla
        </Button>
        <Descargas />
      </div>

      <Tabs
        value={pestana}
        onValueChange={(v) => setPestana(String(v))}
        className="min-h-0 flex-1 gap-0"
      >
        <div className="px-4 pt-3">
          <TabsList>
            <TabsTrigger value="parametros">Parámetros</TabsTrigger>
            <TabsTrigger value="piezas">
              Piezas
              {resultado && <span className="text-muted-foreground tabular-nums">{resultado.piezas.length}</span>}
            </TabsTrigger>
            <TabsTrigger value="validaciones">
              Validaciones
              {errores > 0 ? (
                <span className="text-destructive tabular-nums">{errores}</span>
              ) : avisos > 0 ? (
                <span className="text-st-observado tabular-nums">{avisos}</span>
              ) : null}
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {error && (
            <div className="mb-3">
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
            </div>
          )}

          <TabsContent value="parametros">
            {actual ? (
              // Con `key`, cambiar de plantilla arranca un formulario limpio.
              <FormularioParametros key={actual.codigo} plantilla={actual} />
            ) : (
              <p className="text-muted-foreground text-sm">
                La plantilla «{plantilla}» ya no existe en el motor. Elige otra para seguir.
              </p>
            )}
          </TabsContent>
          <TabsContent value="piezas">
            {resultado ? (
              <ListaPiezas
                piezas={resultado.piezas}
                validaciones={resultado.validaciones}
                piezaActiva={piezaActiva}
                alCambiarPieza={setPiezaActiva}
              />
            ) : (
              <p className="text-muted-foreground text-sm">El despiece aparece al generar el diseño.</p>
            )}
          </TabsContent>
          <TabsContent value="validaciones">
            {resultado ? (
              <ListaValidaciones
                validaciones={resultado.validaciones}
                piezas={resultado.piezas}
                piezaActiva={piezaActiva}
                alCambiarPieza={setPiezaActiva}
              />
            ) : (
              <p className="text-muted-foreground text-sm">Las validaciones aparecen al generar el diseño.</p>
            )}
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
