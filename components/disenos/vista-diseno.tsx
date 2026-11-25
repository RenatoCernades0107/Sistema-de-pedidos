"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  Box,
  Calculator,
  History,
  Layers,
  LayoutGrid,
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
  Puzzle,
  SlidersHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDiseno } from "./diseno-contexto";
import { PanelChat } from "./panel-chat";
import { PanelCosto } from "./panel-costo";
import { PanelPlanchas } from "./panel-planchas";
import { MiniaturaDiseno } from "./miniatura-diseno";
import { BarraVistaPrevia, HistorialVersiones } from "./historial-versiones";
import { Button } from "@/components/ui/button";
import { BOTON_CABECERA } from "./estilos";
import {
  AvisoGeneracion,
  AvisoMotor,
  PestanaParametros,
  PestanaPiezas,
  SelectorPlantilla,
  VisorDiseno,
  useResumenDiseno,
} from "./panel-diseno";

export type PestanaDiseno = "chat" | "3d" | "modelo" | "parametros" | "piezas" | "planchas" | "costo" | "historial";

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
 * cambia entre las dos llega por props (la barra de arriba, la pestaña Modelo, el pie).
 *
 * El historial de versiones (`historial`) se abre con el botón de la barra o
 * desde la URL (`?historial=1`, `?version=N` del aviso "cambiaron tu diseño").
 * Mientras se mira una versión vieja, la barra de vista previa queda arriba de
 * todas las pestañas y lo demás no se puede editar.
 */
export function VistaDiseno({
  disenoId,
  volver,
  titulo,
  nombreDiseno,
  extra,
  nombreModelo,
  avisoMotor,
  modelo,
  pie,
  sinAgregarACotizacion = false,
  vigenteConFoto = false,
  conHistorial = false,
  abrirHistorial = false,
  verVersion = null,
  verCosto = true,
  className,
}: {
  disenoId: string;
  /** El botón de volver de la barra de arriba. */
  volver: ReactNode;
  /** El título de la barra. Sin él, el nombre del diseño (que el chat puede poner solo). */
  titulo?: ReactNode;
  nombreDiseno?: string;
  /** Lo que va a la derecha de la barra. */
  extra?: ReactNode;
  /** El nombre que se ve en el visor. Sin él, el de la plantilla. */
  nombreModelo?: string | null;
  avisoMotor?: string | null;
  /** El contenido de la pestaña Modelo. Por defecto, las plantillas del motor. */
  modelo?: ReactNode;
  /** Debajo del menú (en el celular, debajo de todo): la cantidad y el precio de un pedido. */
  pie?: ReactNode;
  /** En un pedido, el costo no lleva el botón "Agregar a cotización". */
  sinAgregarACotizacion?: boolean;
  /** Si la versión vigente ya tiene su foto PNG: al abrir no se saca otra. */
  vigenteConFoto?: boolean;
  /** Si se ofrece el historial de versiones (en `/disenos/[id]`). */
  conHistorial?: boolean;
  /** Abrir con el historial a la vista (`?historial=1`). */
  abrirHistorial?: boolean;
  /** Abrir mostrando esta versión en vista previa, con el historial (`?version=N`). */
  verVersion?: number | null;
  /** La pestaña Costo: solo para quien ve montos (Administración). */
  verCosto?: boolean;
  /** El alto. Por defecto, la pantalla menos la cabecera del shell. */
  className?: string;
}) {
  // El nombre puede llegar por el chat (el automático del primer mensaje).
  const [nombre, setNombre] = useState(nombreDiseno ?? "");
  const { plantilla, plantillas, resultado, vistaPrevia, alAbrirHistorial } = useDiseno();
  const resumen = useResumenDiseno();
  const pideHistorial = conHistorial && (abrirHistorial || verVersion !== null);
  // Sin modelo todavía, se arranca eligiéndolo; con uno, conversando (o en el historial, si lo pide la URL).
  const [pestana, setPestana] = useState<PestanaDiseno>(
    pideHistorial ? "historial" : plantilla === null && plantillas.length > 0 ? "modelo" : "chat",
  );
  // Un aviso abierto con el diseño ya en pantalla cambia la URL, no monta de nuevo.
  const [pedidoAntes, setPedidoAntes] = useState(pideHistorial);
  if (pideHistorial !== pedidoAntes) {
    setPedidoAntes(pideHistorial);
    if (pideHistorial) setPestana("historial");
  }
  // El "Ver historial" de los avisos de edición en paralelo.
  useEffect(() => {
    if (!conHistorial) return;
    alAbrirHistorial(() => setPestana("historial"));
    return () => alAbrirHistorial(null);
  }, [alAbrirHistorial, conHistorial]);

  // "3D" solo existe en el celular: si la ventana se agranda con ella abierta, se vuelve al chat.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 48rem)");
    const revisar = () => mq.matches && setPestana((p) => (p === "3d" ? "chat" : p));
    mq.addEventListener("change", revisar);
    return () => mq.removeEventListener("change", revisar);
  }, []);

  const en3d = pestana === "3d";
  // Ocultar el 3D (solo en pantallas anchas) deja todo el ancho al chat; el visor sigue montado.
  const [ver3d, setVer3d] = useState(true);
  const panel = "min-h-0 flex-1 overflow-y-auto px-4 py-4 data-[hidden]:hidden";
  // La pestaña activa, en el azul de la marca (texto y subrayado).
  const tab = "px-2.5 data-active:text-primary after:bg-primary dark:data-active:text-primary";

  return (
    <div
      className={cn(
        // El mismo alto fijo que el asistente de cotizaciones: la pantalla menos la
        // cabecera del shell y, en móvil, menos el hueco de las pestañas de abajo.
        "flex h-[calc(100dvh-3.5rem-1px-5rem)] min-h-0 flex-col md:h-[calc(100dvh-3.5rem-1px)]",
        className,
      )}
    >
      <MiniaturaDiseno vigenteConFoto={vigenteConFoto} />
      {/* La cabecera es el único bloque de color: el resto de la pantalla es blanco. */}
      <div className="bg-header text-header-foreground flex min-h-11 items-center gap-2 px-2 py-1.5">
        {volver}
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">{titulo ?? nombre}</h1>
        {conHistorial && (
          <Button
            variant="ghost"
            size="sm"
            className={BOTON_CABECERA}
            aria-pressed={pestana === "historial"}
            onClick={() => setPestana((p) => (p === "historial" ? "chat" : "historial"))}
          >
            <History />
            <span className="hidden sm:inline">Historial</span>
          </Button>
        )}
        {extra}
      </div>

      <Tabs
        value={pestana}
        onValueChange={(v) => setPestana(v as PestanaDiseno)}
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-0 md:grid md:grid-rows-[minmax(0,1fr)_auto]",
          ver3d ? "md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]" : "md:grid-cols-[minmax(0,1fr)]",
        )}
      >
        {/* Izquierda: el menú y lo de cada pestaña. */}
        <section
          aria-label="Diseño"
          className={cn(
            "bg-card flex min-h-0 flex-col md:col-start-1 md:row-start-1 md:flex-1",
            ver3d && "md:border-r",
            en3d ? "flex-none" : "flex-1",
          )}
        >
          <div className="flex shrink-0 items-center overflow-x-auto border-b px-2">
            <TabsList variant="line" className="h-11 gap-1">
              <TabsTrigger value="chat" className={tab}>
                <MessageSquare aria-hidden className="size-3.5 max-sm:hidden" />
                Chat
              </TabsTrigger>
              <TabsTrigger value="3d" className={cn(tab, "md:hidden")}>
                <Box aria-hidden className="size-3.5 max-sm:hidden" />
                3D
              </TabsTrigger>
              <TabsTrigger value="modelo" className={tab}>
                <LayoutGrid aria-hidden className="size-3.5 max-sm:hidden" />
                Modelo
              </TabsTrigger>
              <TabsTrigger value="parametros" className={tab}>
                <SlidersHorizontal aria-hidden className="size-3.5 max-sm:hidden" />
                Parámetros
              </TabsTrigger>
              <TabsTrigger value="piezas" className={tab}>
                <Puzzle aria-hidden className="size-3.5 max-sm:hidden" />
                Piezas
                {resumen.errores > 0 ? (
                  <span className="text-destructive tabular-nums" title="Errores del diseño">
                    {resumen.errores}
                  </span>
                ) : resumen.piezas > 0 ? (
                  <span className="text-muted-foreground font-normal tabular-nums">{resumen.piezas}</span>
                ) : null}
              </TabsTrigger>
              <TabsTrigger value="planchas" className={tab}>
                <Layers aria-hidden className="size-3.5 max-sm:hidden" />
                Planchas
                {resumen.problemasMaterial > 0 ? (
                  <span className="text-destructive tabular-nums">{resumen.problemasMaterial}</span>
                ) : resumen.planchas > 0 ? (
                  <span className="text-muted-foreground font-normal tabular-nums">{resumen.planchas}</span>
                ) : null}
              </TabsTrigger>
              {verCosto && (
                <TabsTrigger value="costo" className={tab}>
                  <Calculator aria-hidden className="size-3.5 max-sm:hidden" />
                  Costo
                </TabsTrigger>
              )}
            </TabsList>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground ml-auto hidden shrink-0 md:inline-flex"
              aria-pressed={!ver3d}
              aria-label={ver3d ? "Ocultar el modelo 3D" : "Mostrar el modelo 3D"}
              title={ver3d ? "Ocultar el modelo 3D" : "Mostrar el modelo 3D"}
              onClick={() => {
                // Una pantalla completa abierta no tiene sentido sin el visor.
                if (ver3d && document.fullscreenElement) void document.exitFullscreen();
                setVer3d((v) => !v);
              }}
            >
              {ver3d ? <PanelRightClose /> : <PanelRightOpen />}
            </Button>
          </div>

          <BarraVistaPrevia />
          <div className={cn("flex min-h-0 flex-1 flex-col", en3d && "hidden md:flex")}>
            {/* El error de generación se ve desde cualquier pestaña menos el chat (que tiene los suyos). */}
            {pestana !== "chat" && (
              <div className="px-4 pt-3 empty:hidden">
                <AvisoGeneracion />
              </div>
            )}
            {conHistorial && (
              <TabsContent value="historial" keepMounted className={panel}>
                <HistorialVersiones abierto={pestana === "historial"} verAlAbrir={verVersion} />
              </TabsContent>
            )}
            {/* Mirando una versión vieja, lo demás no se edita (el contexto tampoco guarda). */}
            <fieldset disabled={vistaPrevia !== null} className="contents">
              <TabsContent
                value="chat"
                keepMounted
                className="flex min-h-0 flex-1 flex-col data-[hidden]:hidden"
              >
                <PanelChat disenoId={disenoId} onNombre={setNombre} />
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
              {verCosto && (
                <TabsContent value="costo" keepMounted className={panel}>
                  {resultado ? (
                    <PanelCosto sinAgregar={sinAgregarACotizacion} />
                  ) : (
                    <p className="text-muted-foreground text-sm">El costo aparece al generar el diseño.</p>
                  )}
                </TabsContent>
              )}
            </fieldset>
          </div>
        </section>

        {/* Derecha: el modelo a todo el alto. En el celular, solo con la pestaña 3D. */}
        <section
          aria-label="Modelo 3D"
          className={cn(
            "min-h-0 flex-1 md:col-start-2 md:row-span-2 md:row-start-1",
            ver3d ? "md:block" : "md:hidden",
            en3d ? "block" : "hidden",
          )}
        >
          <VisorDiseno nombre={nombreModelo} avisoMotor={avisoMotor} />
        </section>

        {pie && <div className="bg-card shrink-0 border-t md:col-start-1 md:row-start-2 md:border-r">{pie}</div>}
      </Tabs>
    </div>
  );
}
