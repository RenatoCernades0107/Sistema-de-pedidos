"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import {
  ArrowLeft,
  CalendarClock,
  Check,
  History,
  IdCard,
  NotebookPen,
  Phone,
  Paperclip,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/store";
import {
  ESTADOS,
  LUGARES,
  METODOS,
  PAGOS,
  esTerminal,
  etiquetaComprobante,
  pasosDelFlujo,
  saldoDe,
  textoItem,
  venceCreditoEl,
  type Pedido,
} from "@/lib/dominio";
import { hoy } from "@/lib/fecha";
import {
  creditoVencido,
  fechaCompleta,
  fechaHora,
  money,
  urgenciaDe,
} from "@/lib/formato";
import { BARRA_ESTADO, EstadoBadge } from "@/components/estado-badge";
import { AccionesPedido } from "@/components/acciones-pedido";
import { EditarDatos, EditarEnvio } from "@/components/editar-pedido";
import { RegistrarAbono } from "@/components/registrar-abono";
import { AdjuntosPedido } from "@/components/adjuntos-pedido";
import { Button } from "@/components/ui/button";
import {
  ICONO_CLASE,
  PanelItem,
  cantidadDeLinea,
  claseDeLinea,
  nombreDeLinea,
} from "@/components/lineas-pedido";
import { CompartirMenu } from "@/components/compartir-menu";
import { ChatPedido } from "@/components/chat-pedido";
import type { ChatInicial } from "@/lib/chat/consultas";
import { asuntoSeguimiento, mensajeSeguimiento } from "@/lib/compartir";
import type { LineaDePedido, OdooDePedido } from "@/lib/pedido-lineas";
import type { Sobrante } from "@/lib/sobrantes";

/** Lo que se ve en el centro: un ítem, los archivos del pedido o su actividad. */
type Vista = { tipo: "item"; posicion: number } | { tipo: "archivos" } | { tipo: "actividad" };

/** `?item=2`, `?ver=archivos` o `?ver=actividad`. Sin nada (o con un ítem que no existe): el primero. */
function vistaDeUrl(params: URLSearchParams, lineas: LineaDePedido[]): Vista {
  const ver = params.get("ver");
  if (ver === "archivos" || ver === "actividad") return { tipo: ver };
  const item = Number(params.get("item"));
  if (lineas.some((l) => l.posicion === item)) return { tipo: "item", posicion: item };
  return lineas.length > 0 ? { tipo: "item", posicion: lineas[0].posicion } : { tipo: "archivos" };
}

const claveDe = (v: Vista) => (v.tipo === "item" ? `item-${v.posicion}` : v.tipo);

/**
 * El pedido como hoja de trabajo: en el centro el
 * ítem que se está mirando (plano, indicaciones y archivos), a la derecha sus
 * ítems y a la izquierda lo que se sigue a diario: el estado, la entrega y el
 * pago. El chat, cerrado, en un botón de la esquina. El cliente va en
 * la cabecera, con su documento y su teléfono junto al nombre.
 */
export function DetallePedido({
  codigo,
  lineas = null,
  odoo = null,
  retazoMin,
  sobrantes = [],
  tokenSeguimiento = null,
  chat = null,
  documentoCliente = null,
}: {
  codigo: string;
  /** El RUC o DNI del cliente. Solo llega a Administración y Logística. */
  documentoCliente?: string | null;
  /**
   * El chat del pedido (su conversación del chat del equipo). `null` si no se
   * pudo leer. `abrir`: se llegó desde un aviso y el panel se abre solo.
   */
  chat?: { conversacionId: string; usuarioId: string; inicial: ChatInicial | null; abrir?: boolean } | null;
  /**
   * El permiso del enlace público de seguimiento. Solo llega a quien coordina
   * con el cliente (Administración y Logística); sin él no sale el botón.
   */
  tokenSeguimiento?: string | null;
  /** El lado mínimo de un sobrante (de la configuración de cortes). */
  retazoMin?: number;
  /** Los sobrantes que este pedido devolvió al almacén. */
  sobrantes?: Sobrante[];
  /** Los productos y cortes del pedido. `null` si no se pudieron leer. */
  lineas?: LineaDePedido[] | null;
  odoo?: OdooDePedido | null;
}) {
  const { pedido, permisos } = useStore();
  const p = pedido(codigo);
  const params = useSearchParams();
  const items = lineas ?? [];
  const vista = vistaDeUrl(params, items);

  /* Cambiar de ítem no vuelve a pedir nada al servidor (el pedido, Odoo y el
     chat ya están): solo se reescribe la URL, para que el enlace lleve al
     mismo ítem. */
  const elegir = useCallback(
    (v: Vista) => {
      const siguientes = new URLSearchParams(params.toString());
      siguientes.delete("item");
      siguientes.delete("ver");
      if (v.tipo === "item") siguientes.set("item", String(v.posicion));
      else siguientes.set("ver", v.tipo);
      window.history.replaceState(null, "", `?${siguientes.toString()}`);
    },
    [params],
  );

  if (!p) {
    return (
      <div className="grid min-h-[60vh] place-items-center p-6 text-center">
        <div>
          <h1 className="text-lg font-semibold">
            No existe el pedido {codigo}
          </h1>
          <p className="text-muted-foreground mt-1.5 text-sm">
            Revisa el código o vuelve a la lista.
          </p>
          <Button
            render={<Link href="/pedidos" />}
            nativeButton={false}
            variant="outline"
            className="mt-4"
          >
            Volver a la lista
          </Button>
        </div>
      </div>
    );
  }

  const indice = vista.tipo === "item" ? items.findIndex((l) => l.posicion === vista.posicion) : -1;
  const linea = indice >= 0 ? items[indice] : null;
  const archivosVisibles = permisos.verEnvioCompleto
    ? p.adjuntos
    : p.adjuntos.filter((a) => a.tipo === "diseno" || a.tipo === "foto_entrega");

  // Sin el cliente, el título es el trabajo: lo que el taller necesita leer primero.
  const titulo = permisos.verCliente
    ? p.cliente
    : p.items.length > 0
      ? `${textoItem(p.items[0])}${p.items.length > 1 ? ` y ${p.items.length - 1} más` : ""}`
      : `Pedido ${p.codigo}`;

  return (
    /* En pantalla ancha la página ocupa justo el alto visible (bajo la barra de
       arriba de 3.5rem) y cada columna se desplaza por su cuenta: el estado, la
       entrega, el pago y el chat quedan siempre a la vista. */
    <div className="px-4 py-5 md:px-6 md:py-6 lg:flex lg:h-[calc(100dvh-3.5rem-1px)] lg:min-h-[38rem] lg:flex-col lg:py-4">
      <header className="mb-4 flex flex-col gap-1 lg:shrink-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              render={<Link href="/pedidos" />}
              nativeButton={false}
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground -ml-2"
              aria-label="Volver a la lista"
              title="Volver a la lista"
            >
              <ArrowLeft />
            </Button>
            <span className="text-primary text-base font-semibold tracking-tight tabular-nums">
              {p.codigo}
            </span>
            {p.esProvincia && (
              <span className="text-st-en_transito bg-st-en_transito-soft ring-st-en_transito/25 rounded-full px-2 py-0.5 text-2xs font-semibold tracking-wide ring-1 ring-inset">
                PROVINCIA
              </span>
            )}
            <EstadoBadge estado={p.estado} size="sm" />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:ml-auto">
            <Stepper pedido={p} />
            <FechaPrometida pedido={p} />
            {tokenSeguimiento && permisos.verTelefonoCliente && (
              <CompartirMenu
                etiqueta="Compartir seguimiento"
                ruta={`/seguimiento/${tokenSeguimiento}`}
                mensaje={(url) => mensajeSeguimiento(p.cliente, p.codigo, url)}
                asunto={asuntoSeguimiento(p.codigo)}
                telefono={p.telefonoCliente}
              />
            )}
          </div>
        </div>
        <h1 className="text-xl font-semibold tracking-tight">{titulo}</h1>
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          {documentoCliente && (
            <>
              <span className="inline-flex items-center gap-1.5">
                <IdCard className="size-3.5" aria-hidden />
                <span className="text-foreground tnum">{documentoCliente}</span>
              </span>
              <span aria-hidden>·</span>
            </>
          )}
          {permisos.verTelefonoCliente && (
            <>
              <span className="inline-flex items-center gap-1.5">
                <Phone className="size-3.5" aria-hidden />
                {p.telefonoCliente ? (
                  <a
                    href={`tel:${p.telefonoCliente.replace(/\s+/g, "")}`}
                    className="text-foreground tnum hover:underline"
                  >
                    {p.telefonoCliente}
                  </a>
                ) : (
                  <Vacio>Sin teléfono</Vacio>
                )}
              </span>
              <span aria-hidden>·</span>
            </>
          )}
          <span>
            Registrado el <span className="tnum">{fechaCompleta(p.fechaCreacion)}</span>
          </span>
          {p.fechaEntrega && (
            <span>
              · Entregado el <span className="tnum">{fechaCompleta(p.fechaEntrega)}</span>
            </span>
          )}
          {p.fechaAnulacion && (
            <span>
              · Anulado el <span className="tnum">{fechaCompleta(p.fechaAnulacion)}</span>
            </span>
          )}
          {permisos.editarTodo && !esTerminal(p.estado) && (
            <span className="ml-1">
              <EditarDatos pedido={p} />
            </span>
          )}
        </div>
      </header>

      {(p.estado === "observado" || p.estado === "anulado") && p.motivo && (
        <div
          className={cn(
            "mb-4 flex gap-2.5 rounded-xl border p-3 text-sm lg:shrink-0",
            p.estado === "anulado"
              ? "border-st-anulado/25 bg-st-anulado-soft"
              : "border-st-observado/25 bg-st-observado-soft",
          )}
        >
          <TriangleAlert
            className={cn(
              "mt-0.5 size-4 shrink-0",
              p.estado === "anulado" ? "text-st-anulado" : "text-st-observado",
            )}
          />
          <p>
            <span className="font-medium">{ESTADOS[p.estado]}.</span>{" "}
            <span className="text-muted-foreground">{p.motivo}</span>
          </p>
        </div>
      )}

      <div className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[18rem_minmax(0,1fr)_13rem] lg:grid-rows-[minmax(0,1fr)] xl:grid-cols-[21rem_minmax(0,1fr)_15rem]">
        {/* A la izquierda, lo que se sigue a diario: el estado, la entrega y el
            pago. En el celular se reparte: el estado va antes de los ítems y la
            entrega y el pago, después. */}
        <aside
          aria-label="Estado, entrega y pago"
          className="max-lg:contents lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:gap-3 lg:overflow-y-auto"
        >
          <div className="max-lg:order-1">
            <AccionesPedido
              pedido={p}
              cortes={items.filter((l) => l.corte)}
              terminados={items.filter((l) => l.terminado)}
              stockDescontado={odoo?.stockDescontado ?? false}
              retazoMin={retazoMin}
            />
          </div>
          <div className="flex flex-col gap-3 max-lg:order-4">
            <PanelEntrega pedido={p} cerrado={esTerminal(p.estado)} />
            {permisos.verMontos && <PanelPago pedido={p} />}
          </div>
        </aside>

        <div className="min-w-0 max-lg:order-3 lg:h-full lg:overflow-y-auto lg:rounded-xl">
          {lineas === null && vista.tipo === "archivos" && (
            <p className="text-muted-foreground mb-4 rounded-xl border border-dashed p-4 text-sm">
              No se pudieron leer los productos y cortes del pedido. Recarga la página.
            </p>
          )}
          {lineas !== null && items.length === 0 && vista.tipo === "archivos" && (
            <p className="text-muted-foreground mb-4 rounded-xl border border-dashed p-4 text-sm">
              Este pedido no tiene ítems de Odoo: se registró antes de la conexión.
            </p>
          )}
          <motion.div
            key={claveDe(vista)}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15 }}
          >
            {linea ? (
              <PanelItem
                pedido={p}
                lineas={items}
                linea={linea}
                odoo={odoo}
                sobrantes={sobrantes}
                archivos={<AdjuntosPedido pedido={p} lineas={items} posicion={linea.posicion} />}
                alAnterior={indice > 0 ? () => elegir({ tipo: "item", posicion: items[indice - 1].posicion }) : undefined}
                alSiguiente={
                  indice < items.length - 1
                    ? () => elegir({ tipo: "item", posicion: items[indice + 1].posicion })
                    : undefined
                }
              />
            ) : vista.tipo === "actividad" ? (
              <Actividad pedido={p} />
            ) : (
              <Panel titulo="Archivos del pedido" extra="Diseños, factura, guía y fotos de entrega">
                <AdjuntosPedido pedido={p} lineas={items} />
              </Panel>
            )}
          </motion.div>
        </div>


        <NavegadorPedido
          lineas={items}
          pedido={p}
          vista={vista}
          archivos={archivosVisibles.length}
          alElegir={elegir}
          className="max-lg:order-2 lg:h-full lg:overflow-y-auto"
        />
      </div>

      {chat && (
        <ChatPedido
          conversacionId={chat.conversacionId}
          codigo={p.codigo}
          usuarioId={chat.usuarioId}
          inicial={chat.inicial}
          abrirAlEntrar={chat.abrir}
        />
      )}
    </div>
  );
}

/* ── Navegación ── */

/**
 * La lista de lo que se puede mirar del pedido: sus ítems y, aparte, los
 * archivos y la actividad. En pantalla ancha es una columna; en el celular,
 * una fila de fichas que se desliza. Con ↑/↓ (o ←/→) se cambia de ítem.
 */
function NavegadorPedido({
  lineas,
  pedido: p,
  vista,
  archivos,
  alElegir,
  className,
}: {
  lineas: LineaDePedido[];
  pedido: Pedido;
  vista: Vista;
  archivos: number;
  alElegir: (v: Vista) => void;
  className?: string;
}) {
  const opciones: Vista[] = [
    ...lineas.map((l) => ({ tipo: "item" as const, posicion: l.posicion })),
    { tipo: "archivos" },
    { tipo: "actividad" },
  ];
  const actual = claveDe(vista);
  const botones = useRef(new Map<string, HTMLButtonElement>());
  const [conFoco, setConFoco] = useState(false);

  // Al moverse con el teclado, el foco sigue a la selección.
  useEffect(() => {
    if (conFoco) botones.current.get(actual)?.focus();
  }, [actual, conFoco]);

  const teclas = (e: React.KeyboardEvent) => {
    const paso = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (!paso) return;
    e.preventDefault();
    const i = opciones.findIndex((o) => claveDe(o) === actual);
    const siguiente = opciones[(i + paso + opciones.length) % opciones.length];
    setConFoco(true);
    alElegir(siguiente);
  };

  const archivosDeItem = (posicion: number) => p.adjuntos.filter((a) => a.lineaPosicion === posicion).length;

  const boton = (o: Vista, contenido: React.ReactNode, etiqueta: string) => {
    const clave = claveDe(o);
    const activo = clave === actual;
    return (
      <button
        key={clave}
        ref={(b) => {
          if (b) botones.current.set(clave, b);
          else botones.current.delete(clave);
        }}
        type="button"
        role="tab"
        aria-selected={activo}
        aria-label={etiqueta}
        tabIndex={activo ? 0 : -1}
        onClick={() => alElegir(o)}
        onBlur={() => setConFoco(false)}
        className={cn(
          "group relative flex shrink-0 items-start gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors",
          "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
          "lg:w-full lg:border-transparent",
          activo
            ? "border-primary bg-primary/[0.07] lg:border-primary/30"
            : "bg-card hover:bg-muted/60 lg:bg-transparent",
        )}
      >
        {activo && (
          <span className="bg-primary absolute top-2 bottom-2 -left-px hidden w-0.5 rounded-full lg:block" aria-hidden />
        )}
        {contenido}
      </button>
    );
  };

  return (
    <nav aria-label="Contenido del pedido" className={cn("min-w-0", className)}>
      <div
        role="tablist"
        aria-orientation="vertical"
        onKeyDown={teclas}
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:rounded-xl lg:border lg:bg-card lg:p-1.5 lg:pb-1.5"
      >
        {lineas.length > 0 && (
          <p className="eyebrow hidden px-2.5 pt-1.5 pb-1 lg:block">
            Ítems <span className="tnum">({lineas.length})</span>
          </p>
        )}
        {lineas.map((l) => {
          const Icono = ICONO_CLASE[claseDeLinea(l)];
          const nArchivos = archivosDeItem(l.posicion);
          const activo = actual === `item-${l.posicion}`;
          return boton(
            { tipo: "item", posicion: l.posicion },
            <>
              <span
                className={cn(
                  "tnum grid size-6 shrink-0 place-items-center rounded-md text-xs font-semibold transition-colors",
                  activo ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                )}
              >
                {l.posicion}
              </span>
              <span className="min-w-0 max-w-[11rem] lg:max-w-none lg:flex-1">
                <span className="flex items-center gap-1.5">
                  <Icono className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
                  <span className="truncate text-sm font-medium">{nombreDeLinea(l)}</span>
                </span>
                <span className="text-muted-foreground mt-0.5 flex items-center gap-2 text-xs">
                  <span className="tnum">{cantidadDeLinea(l)}</span>
                  {l.indicaciones && (
                    <NotebookPen className="size-3" aria-label="Tiene indicaciones" />
                  )}
                  {nArchivos > 0 && (
                    <span className="inline-flex items-center gap-0.5" title={`${nArchivos} archivos`}>
                      <Paperclip className="size-3" aria-hidden />
                      <span className="tnum">{nArchivos}</span>
                    </span>
                  )}
                </span>
              </span>
            </>,
            `Ítem ${l.posicion}: ${nombreDeLinea(l)}, ${cantidadDeLinea(l)}`,
          );
        })}
        {lineas.length > 0 && <span className="bg-border my-1 hidden h-px lg:block" aria-hidden />}
        {boton(
          { tipo: "archivos" },
          <>
            <Paperclip className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
            <span className="text-sm">
              Archivos del pedido <span className="text-muted-foreground tnum">({archivos})</span>
            </span>
          </>,
          `Archivos del pedido (${archivos})`,
        )}
        {boton(
          { tipo: "actividad" },
          <>
            <History className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
            <span className="text-sm">Actividad</span>
          </>,
          "Actividad: historial de estados y cambios",
        )}
      </div>
    </nav>
  );
}

/* ── Lateral: lo que se decidió al registrar ── */

function PanelEntrega({ pedido: p, cerrado }: { pedido: Pedido; cerrado: boolean }) {
  const { permisos } = useStore();
  const envio = p.esProvincia ? p.envio : undefined;
  const completo = !!envio && permisos.verEnvioCompleto;

  return (
    <Panel
      titulo="Entrega"
      accion={envio && permisos.editarEnvio && !cerrado ? <EditarEnvio pedido={p} /> : undefined}
    >
      <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
        <Fila etiqueta="Destino">
          {envio ? (
            <>
              {envio.departamento}
              {envio.provincia && `, ${envio.provincia}`}
            </>
          ) : (
            "Lima"
          )}
        </Fila>
        <Fila etiqueta="Entrega">
          {completo && envio.agencia ? `Agencia ${envio.agencia}` : LUGARES[p.entrega]}
          {completo && !envio.agencia && (
            <span className="text-st-observado ml-1.5 inline-flex items-center gap-1 text-xs font-medium">
              <TriangleAlert className="size-3" /> falta la agencia
            </span>
          )}
          {p.direccion && <span className="text-muted-foreground block text-xs">{p.direccion}</span>}
        </Fila>
        {completo && (
          <>
            {envio.personaQueRecoge && (
              <Fila etiqueta="Recoge">
                {envio.personaQueRecoge}
                {envio.numeroDocumento && (
                  <span className="text-muted-foreground tnum"> · {envio.tipoDocumento} {envio.numeroDocumento}</span>
                )}
                {envio.telefono && <span className="text-muted-foreground tnum block text-xs">{envio.telefono}</span>}
              </Fila>
            )}
            {envio.montoFlete > 0 && (
              <Fila etiqueta="Flete">
                <span className="tnum">{money(envio.montoFlete)}</span>
                <span className={envio.fletePagado ? "text-st-entregado" : "text-st-observado"}>
                  {" "}· {envio.fletePagado ? "pagado" : "por pagar"}
                </span>
              </Fila>
            )}
            {envio.observacionesEnvio && <FilaTexto etiqueta="Agencia" texto={envio.observacionesEnvio} />}
          </>
        )}
        {p.notasEntrega && <FilaTexto etiqueta="Notas" texto={p.notasEntrega} />}
        {p.observaciones && <FilaTexto etiqueta="Internas" texto={p.observaciones} />}
      </dl>
    </Panel>
  );
}

/** Un renglón de la columna derecha: la etiqueta a la izquierda y el valor al lado. */
function Fila({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground text-xs leading-5">{etiqueta}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

/** Un texto libre en dos renglones como mucho; el resto, al pasar el mouse (o al tocarlo). */
function FilaTexto({ etiqueta, texto }: { etiqueta: string; texto: string }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <Fila etiqueta={etiqueta}>
      <button
        type="button"
        title={texto}
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className={cn("text-left whitespace-pre-line", !abierto && "line-clamp-2")}
      >
        {texto}
      </button>
    </Fila>
  );
}

/* ── Centro: actividad ── */

function Actividad({ pedido: p }: { pedido: Pedido }) {
  const { permisos } = useStore();
  return (
    <div className="flex flex-col gap-4">
      <Panel titulo="Historial de estados">
        <ol className="flex flex-col">
          {[...p.historial].reverse().map((h, i, arr) => (
            <li
              key={`${h.estado}-${h.fecha}-${i}`}
              className="relative grid grid-cols-[auto_1fr] gap-3 pb-4 last:pb-0"
            >
              {i < arr.length - 1 && (
                <span
                  className="bg-border absolute top-4 left-[5px] h-full w-px"
                  aria-hidden
                />
              )}
              <span
                className={cn(
                  "ring-card z-10 mt-1 size-2.5 rounded-full ring-4",
                  BARRA_ESTADO[h.estado],
                )}
                aria-hidden
              />
              <div className="min-w-0">
                <p className="text-sm font-medium">{ESTADOS[h.estado]}</p>
                <p className="text-muted-foreground text-xs">
                  {h.usuario} ·{" "}
                  <span className="tnum">{fechaHora(h.fecha)}</span>
                </p>
                {h.motivo && (
                  <p className="text-muted-foreground mt-1 text-xs">
                    {h.motivo}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </Panel>

      {permisos.verAuditoria && (
        <Panel titulo="Auditoría" extra="inmutable">
          {p.auditoria.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Sin ediciones registradas después de la creación.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="eyebrow py-2 pr-3 text-left">Cuándo</th>
                    <th className="eyebrow py-2 pr-3 text-left">Quién</th>
                    <th className="eyebrow py-2 pr-3 text-left">Campo</th>
                    <th className="eyebrow py-2 text-left">Cambio</th>
                  </tr>
                </thead>
                <tbody>
                  {p.auditoria.map((a, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="tnum text-muted-foreground py-2 pr-3 text-xs whitespace-nowrap">
                        {fechaHora(a.fecha)}
                      </td>
                      <td className="py-2 pr-3 text-xs">{a.usuario}</td>
                      <td className="py-2 pr-3 font-mono text-xs">
                        {a.campo}
                      </td>
                      <td className="py-2 text-xs">
                        <span className="text-muted-foreground line-through">
                          {a.anterior}
                        </span>{" "}
                        <span className="text-st-entregado font-medium">
                          → {a.nuevo}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}

/** La fecha comprometida con el cliente, con cuánto falta: lo que ordena el trabajo del taller. */
function FechaPrometida({ pedido: p }: { pedido: Pedido }) {
  const urgencia = urgenciaDe(p);
  const dias = Math.round(
    (new Date(p.fechaPrometida).getTime() - new Date(hoy()).getTime()) / 86_400_000,
  );
  const cuanto =
    urgencia === "cerrado"
      ? null
      : dias < 0
        ? `venció hace ${-dias} ${dias === -1 ? "día" : "días"}`
        : dias === 0
          ? "vence hoy"
          : dias === 1
            ? "mañana"
            : `en ${dias} días`;
  const tono =
    urgencia === "vencido" ? "text-st-observado" : urgencia === "hoy" ? "text-st-en_transito" : "text-muted-foreground";
  return (
    <p
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm",
        urgencia === "vencido"
          ? "border-st-observado/40 bg-st-observado-soft"
          : urgencia === "hoy"
            ? "border-st-en_transito/40 bg-st-en_transito-soft"
            : "bg-card",
      )}
      title="Fecha prometida al cliente: no se cambia"
    >
      <CalendarClock className={cn("size-4 shrink-0", tono)} aria-hidden />
      <span className="sr-only">Fecha prometida:</span>
      <span className="tnum font-semibold">{fechaCompleta(p.fechaPrometida)}</span>
      {cuanto && <span className={cn("text-xs font-medium", tono)}>{cuanto}</span>}
    </p>
  );
}

/* ── Piezas ── */

/**
 * Por dónde va el pedido: un punto por paso con su nombre, unidos por un
 * trazo que se pinta de verde hasta el paso actual.
 */
function Stepper({ pedido: p }: { pedido: Pedido }) {
  if (p.estado === "anulado") return null;
  const pasos = pasosDelFlujo(p.esProvincia);
  const actual = pasos.indexOf(p.estado);

  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1" aria-label="Avance del pedido">
      {pasos.map((paso, i) => {
        const hecho = actual > i;
        const activo = actual === i;
        return (
          <li key={paso} className="flex items-center gap-2">
            {i > 0 && (
              <span
                className={cn("h-px w-4", hecho || activo ? "bg-st-entregado" : "bg-border")}
                aria-hidden
              />
            )}
            <span
              className={cn(
                "grid size-4 shrink-0 place-items-center rounded-full border",
                hecho && "bg-st-entregado border-transparent text-white",
                activo && "border-primary bg-primary ring-primary/20 ring-3",
                !hecho && !activo && "bg-card",
              )}
              aria-hidden
            >
              {hecho && <Check className="size-2.5" strokeWidth={3} />}
            </span>
            <span
              className={cn(
                "text-xs whitespace-nowrap",
                activo ? "text-foreground font-semibold" : "text-muted-foreground",
              )}
            >
              {ESTADOS[paso]}
              <span className="sr-only">{hecho ? " (hecho)" : activo ? " (actual)" : " (pendiente)"}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Panel({
  titulo,
  extra,
  accion,
  children,
}: {
  titulo: string;
  extra?: string;
  accion?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-card rounded-xl border">
      <header className="flex min-h-10 items-center gap-2 border-b py-1 pr-2 pl-4">
        <h2 className="text-sm font-medium">{titulo}</h2>
        {extra && (
          <span className="text-muted-foreground ml-auto text-xs">{extra}</span>
        )}
        {accion && <div className={extra ? "" : "ml-auto"}>{accion}</div>}
      </header>
      <div className="flex flex-col gap-4 p-3 px-4">{children}</div>
    </section>
  );
}

const Vacio = ({
  children = "Sin registrar",
}: {
  children?: React.ReactNode;
}) => <span className="text-muted-foreground/70 italic">{children}</span>;

function PanelPago({ pedido: p }: { pedido: Pedido }) {
  const saldo = saldoDe(p);
  const pct = p.montoTotal
    ? Math.min(100, Math.round((p.montoPagado / p.montoTotal) * 100))
    : 0;
  const vence = venceCreditoEl(p);
  const vencido = creditoVencido(p);

  return (
    <section className="bg-card rounded-xl border">
      <header className="flex min-h-10 flex-wrap items-center gap-x-2 border-b py-1 pr-4 pl-4">
        <h2 className="text-sm font-medium">Pago</h2>
        <span className="text-muted-foreground ml-auto text-xs">
          {PAGOS[p.tipoPago]}
          {p.plazoCredito ? ` · ${p.plazoCredito} días` : ""}
          {vence && (
            <span className={cn(vencido && "text-saldo-alerta font-semibold")}>
              {" "}· {vencido ? "venció el " : "vence el "}
              <span className="tnum">{fechaCompleta(vence)}</span>
            </span>
          )}
        </span>
      </header>
      <div className="flex flex-col gap-2.5 p-3 px-4">
        <dl className="grid grid-cols-3 gap-2">
          <div>
            <dt className="text-muted-foreground text-xs">Total</dt>
            <dd className="tnum text-sm font-medium">{money(p.montoTotal)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Abonado</dt>
            <dd className="tnum text-st-entregado text-sm font-medium">{money(p.montoPagado)}</dd>
          </div>
          <div className="text-right">
            <dt className="text-muted-foreground text-xs">Saldo</dt>
            <dd
              className={cn(
                "tnum text-sm",
                saldo > 0 ? "text-saldo-alerta parpadeo-alerta font-bold" : "text-st-entregado font-semibold",
              )}
            >
              {money(saldo)}
            </dd>
          </div>
        </dl>

        <div className="bg-muted h-1.5 overflow-hidden rounded-full">
          <motion.div
            className="bg-st-entregado h-full rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          />
        </div>

        {saldo > 0 && <RegistrarAbono pedido={p} />}

        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs">
          <p>
            <span className="text-muted-foreground">Comprobante </span>
            <span className="font-mono tabular-nums">
              {p.numeroComprobante ? etiquetaComprobante(p.numeroComprobante) : <Vacio>sin registrar</Vacio>}
            </span>
          </p>
          {p.abonos.length > 0 && (
            <details className="group w-full">
              <summary className="text-muted-foreground hover:text-foreground cursor-pointer select-none">
                Abonos ({p.abonos.length})
              </summary>
              <ul className="mt-1.5 flex flex-col gap-1.5">
                {p.abonos.map((a, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0">
                      <span className="tnum">{fechaCompleta(a.fecha)}</span> · {METODOS[a.metodo]}
                      <span className="text-muted-foreground"> · {a.usuario}</span>
                    </span>
                    <span className="tnum shrink-0 font-medium">{money(a.monto)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>
    </section>
  );
}
