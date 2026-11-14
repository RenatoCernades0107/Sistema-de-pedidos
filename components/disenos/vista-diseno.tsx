"use client";

import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDiseno } from "./diseno-contexto";
import { PanelChat } from "./panel-chat";
import { PanelCosto } from "./panel-costo";
import { PanelPlanchas } from "./panel-planchas";
import {
  AvisoGeneracion,
  AvisoMotor,
  PestanaParametros,
  PestanaPiezas,
  SelectorPlantilla,
  VisorDiseno,
  useResumenDiseno,
} from "./panel-diseno";

export type PestanaDiseno = "chat" | "3d" | "modelo" | "parametros" | "piezas" | "planchas" | "costo";

/**
 * La pantalla de un diseño, partida en dos:
 *
 *   - a la izquierda, un menú (Chat · Modelo · Parámetros · Piezas · Planchas ·
 *     Costo) y lo de la pestaña elegida;
 *   - a la derecha, el modelo 3D a todo el alto.
 *
 * En el celular no caben las dos columnas: el modelo pasa a ser una pestaña más
 * ("3D") y el `pie`, si lo hay, queda siempre abajo.
 *
 * Todas las pestañas quedan montadas y la que no toca solo se oculta: si el chat
 * se desmontara perdería lo que se está escribiendo, y el visor tendría que
 * volver a cargar el modelo.
 *
 * La usan `/disenos/[id]` y el producto terminado de `/pedidos/nuevo`; lo que
 * cambia entre las dos llega por props (la cabecera, la pestaña Modelo, el pie).
 */
export function VistaDiseno({
  disenoId,
  cabecera,
  nombre,
  avisoMotor,
  modelo,
  pie,
  sinAgregarACotizacion = false,
  className,
}: {
  disenoId: string;
  /** Lo de la barra de arriba: volver, el título y lo que haga falta. */
  cabecera: ReactNode;
  /** El nombre que se ve en el visor. Sin él, el de la plantilla. */
  nombre?: string | null;
  avisoMotor?: string | null;
  /** El contenido de la pestaña Modelo. Por defecto, las plantillas del motor. */
  modelo?: ReactNode;
  /** Debajo del menú (en el celular, debajo de todo): la cantidad y el precio de un pedido. */
  pie?: ReactNode;
  /** En un pedido, el costo no lleva el botón "Agregar a cotización". */
  sinAgregarACotizacion?: boolean;
  /** El alto. Por defecto, la pantalla menos la cabecera del shell. */
  className?: string;
}) {
  const { plantilla, plantillas, resultado } = useDiseno();
  const resumen = useResumenDiseno();
  // Sin modelo todavía, se arranca eligiéndolo; con uno, conversando.
  const [pestana, setPestana] = useState<PestanaDiseno>(plantilla === null && plantillas.length > 0 ? "modelo" : "chat");

  // "3D" solo existe en el celular: si la ventana se agranda con ella abierta, se vuelve al chat.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 48rem)");
    const revisar = () => mq.matches && setPestana((p) => (p === "3d" ? "chat" : p));
    mq.addEventListener("change", revisar);
    return () => mq.removeEventListener("change", revisar);
  }, []);

  const en3d = pestana === "3d";
  const panel = "min-h-0 flex-1 overflow-y-auto px-4 py-4 data-[hidden]:hidden";

  return (
    <div
      className={cn(
        // El mismo alto fijo que el asistente de cotizaciones: la pantalla menos la
        // cabecera del shell y, en móvil, menos el hueco de las pestañas de abajo.
        "flex h-[calc(100dvh-3.5rem-1px-5rem)] min-h-0 flex-col md:h-[calc(100dvh-3.5rem-1px)]",
        className,
      )}
    >
      <div className="bg-background flex min-h-11 items-center gap-2 border-b px-2 py-1.5">{cabecera}</div>

      <Tabs
        value={pestana}
        onValueChange={(v) => setPestana(v as PestanaDiseno)}
        className="flex min-h-0 flex-1 flex-col gap-0 md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] md:grid-rows-[minmax(0,1fr)_auto]"
      >
        {/* Izquierda: el menú y lo de cada pestaña. */}
        <section
          aria-label="Diseño"
          className={cn(
            "bg-background flex min-h-0 flex-col md:col-start-1 md:row-start-1 md:flex-1 md:border-r",
            en3d ? "flex-none" : "flex-1",
          )}
        >
          <div className="shrink-0 overflow-x-auto border-b px-2">
            <TabsList variant="line" className="h-11 gap-1">
              <TabsTrigger value="chat" className="px-2.5">
                Chat
              </TabsTrigger>
              <TabsTrigger value="3d" className="px-2.5 md:hidden">
                3D
              </TabsTrigger>
              <TabsTrigger value="modelo" className="px-2.5">
                Modelo
              </TabsTrigger>
              <TabsTrigger value="parametros" className="px-2.5">
                Parámetros
              </TabsTrigger>
              <TabsTrigger value="piezas" className="px-2.5">
                Piezas
                {resumen.errores > 0 ? (
                  <span className="text-destructive tabular-nums" title="Errores del diseño">
                    {resumen.errores}
                  </span>
                ) : resumen.piezas > 0 ? (
                  <span className="text-muted-foreground font-normal tabular-nums">{resumen.piezas}</span>
                ) : null}
              </TabsTrigger>
              <TabsTrigger value="planchas" className="px-2.5">
                Planchas
                {resumen.problemasMaterial > 0 ? (
                  <span className="text-destructive tabular-nums">{resumen.problemasMaterial}</span>
                ) : resumen.planchas > 0 ? (
                  <span className="text-muted-foreground font-normal tabular-nums">{resumen.planchas}</span>
                ) : null}
              </TabsTrigger>
              <TabsTrigger value="costo" className="px-2.5">
                Costo
              </TabsTrigger>
            </TabsList>
          </div>

          <div className={cn("flex min-h-0 flex-1 flex-col", en3d && "hidden md:flex")}>
            {/* El error de generación se ve desde cualquier pestaña menos el chat (que tiene los suyos). */}
            {pestana !== "chat" && (
              <div className="px-4 pt-3 empty:hidden">
                <AvisoGeneracion />
              </div>
            )}
            <TabsContent
              value="chat"
              keepMounted
              className="flex min-h-0 flex-1 flex-col data-[hidden]:hidden"
            >
              <PanelChat disenoId={disenoId} />
            </TabsContent>
            <TabsContent value="modelo" keepMounted className={panel}>
              {plantillas.length === 0 ? (
                <AvisoMotor avisoMotor={avisoMotor} />
              ) : (
                (modelo ?? <SelectorPlantilla alElegir={() => setPestana("parametros")} />)
              )}
            </TabsContent>
            <TabsContent value="parametros" keepMounted className={panel}>
              <PestanaParametros />
            </TabsContent>
            <TabsContent value="piezas" keepMounted className={panel}>
              <PestanaPiezas />
            </TabsContent>
            <TabsContent value="planchas" keepMounted className={panel}>
              {resultado ? (
                <PanelPlanchas />
              ) : (
                <p className="text-muted-foreground text-sm">Las planchas aparecen al generar el diseño.</p>
              )}
            </TabsContent>
            <TabsContent value="costo" keepMounted className={panel}>
              {resultado ? (
                <PanelCosto sinAgregar={sinAgregarACotizacion} />
              ) : (
                <p className="text-muted-foreground text-sm">El costo aparece al generar el diseño.</p>
              )}
            </TabsContent>
          </div>
        </section>

        {/* Derecha: el modelo a todo el alto. En el celular, solo con la pestaña 3D. */}
        <section
          aria-label="Modelo 3D"
          className={cn(
            "min-h-0 flex-1 md:col-start-2 md:row-span-2 md:row-start-1 md:block",
            en3d ? "block" : "hidden",
          )}
        >
          <VisorDiseno nombre={nombre} avisoMotor={avisoMotor} />
        </section>

        {pie && <div className="bg-background shrink-0 border-t md:col-start-1 md:row-start-2 md:border-r">{pie}</div>}
      </Tabs>
    </div>
  );
}
