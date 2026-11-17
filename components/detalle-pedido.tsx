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
  Lock,
  NotebookPen,
  Paperclip,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/store";
import {
  DOCUMENTOS,
  ESTADOS,
  LUGARES,
  METODOS,
  PAGOS,
  UBICACIONES,
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
 * El pedido como hoja de trabajo: a la izquierda sus ítems, en el centro el
 * ítem que se está mirando (plano, indicaciones y archivos) y a la derecha lo
 * que se decidió al registrarlo, en el mismo orden que el formulario:
 * ① cliente, ② entrega y ③ pago, debajo de las acciones del estado.
 */
export function DetallePedido({
  codigo,
  lineas = null,
  odoo = null,
  retazoMin,
  sobrantes = [],
  tokenSeguimiento = null,
  chat = null,
}: {
  codigo: string;
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
    <div className="px-4 py-5 md:px-6 md:py-6">
      <Button
        render={<Link href="/pedidos" />}
        nativeButton={false}
        variant="ghost"
        size="sm"
        className="text-muted-foreground -ml-2 mb-3 gap-1.5"
      >
        <ArrowLeft className="size-3.5" />
        Volver a la lista
      </Button>

      <header className="mb-4 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
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
          <h1 className="mt-1 text-xl font-semibold tracking-tight">{titulo}</h1>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Registrado el <span className="tnum">{fechaCompleta(p.fechaCreacion)}</span>
            {p.fechaEntrega && (
              <>
                {" "}· entregado el <span className="tnum">{fechaCompleta(p.fechaEntrega)}</span>
              </>
            )}
            {p.fechaAnulacion && (
              <>
                {" "}· anulado el <span className="tnum">{fechaCompleta(p.fechaAnulacion)}</span>
              </>
            )}
          </p>
        </div>
        {tokenSeguimiento && permisos.verTelefonoCliente && (
          <CompartirMenu
            etiqueta="Compartir seguimiento"
            ruta={`/seguimiento/${tokenSeguimiento}`}
            mensaje={(url) => mensajeSeguimiento(p.cliente, p.codigo, url)}
            asunto={asuntoSeguimiento(p.codigo)}
            telefono={p.telefonoCliente}
          />
        )}
      </header>

      {(p.estado === "observado" || p.estado === "anulado") && p.motivo && (
        <div
          className={cn(
            "mb-4 flex gap-2.5 rounded-xl border p-3 text-sm",
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

      <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
        <Stepper pedido={p} />
        <FechaPrometida pedido={p} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[14rem_minmax(0,1fr)_20rem] lg:items-start xl:grid-cols-[16rem_minmax(0,1fr)_21rem]">
        {/* En el celular las acciones van primero; en pantalla ancha, arriba a la derecha. */}
        <div className="lg:col-start-3 lg:row-start-1">
          <AccionesPedido
            pedido={p}
            cortes={items.filter((l) => l.corte)}
            terminados={items.filter((l) => l.terminado)}
            stockDescontado={odoo?.stockDescontado ?? false}
            retazoMin={retazoMin}
          />
        </div>

        <NavegadorPedido
          lineas={items}
          pedido={p}
          vista={vista}
          archivos={archivosVisibles.length}
          alElegir={elegir}
          className="lg:sticky lg:top-20 lg:col-start-1 lg:row-span-2 lg:row-start-1"
        />

        <div className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1">
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

        <div className="flex flex-col gap-4 lg:col-start-3 lg:row-start-2">
          <PanelCliente pedido={p} cerrado={esTerminal(p.estado)} />
          <PanelEntrega pedido={p} cerrado={esTerminal(p.estado)} />
          {permisos.verMontos && <PanelPago pedido={p} />}
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
      </div>
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

function PanelCliente({ pedido: p, cerrado }: { pedido: Pedido; cerrado: boolean }) {
  const { permisos } = useStore();
  if (!permisos.verCliente) return null;
  return (
    <Panel
      n={1}
      titulo="Cliente"
      accion={permisos.editarTodo && !cerrado ? <EditarDatos pedido={p} /> : undefined}
    >
      <dl className="grid gap-3">
        <Dato etiqueta="Nombre" bloqueado={!permisos.editarTodo}>
          {p.cliente}
        </Dato>
        {permisos.verTelefonoCliente && (
          <Dato etiqueta="Teléfono" bloqueado={!permisos.editarTodo}>
            {p.telefonoCliente ? (
              <a href={`tel:${p.telefonoCliente.replace(/\s+/g, "")}`} className="tnum hover:underline">
                {p.telefonoCliente}
              </a>
            ) : (
              <Vacio>Sin teléfono</Vacio>
            )}
          </Dato>
        )}
      </dl>
    </Panel>
  );
}

function PanelEntrega({ pedido: p, cerrado }: { pedido: Pedido; cerrado: boolean }) {
  const { permisos } = useStore();
  const envio = p.esProvincia ? p.envio : undefined;
  // Si no hay panel de cliente, este lleva el botón de editar los datos.
  const editaDatos = !permisos.verCliente && permisos.editarTodo && !cerrado;
  const editaEnvio = !!envio && permisos.editarEnvio && !cerrado;

  return (
    <Panel
      n={permisos.verCliente ? 2 : 1}
      titulo="Entrega"
      accion={
        editaDatos || editaEnvio ? (
          <div className="flex gap-1">
            {editaDatos && <EditarDatos pedido={p} />}
            {editaEnvio && <EditarEnvio pedido={p} />}
          </div>
        ) : undefined
      }
    >
      <dl className="grid grid-cols-2 gap-3">
        <Dato etiqueta="Está en" bloqueado={!permisos.editarUbicacion}>
          {UBICACIONES[p.ubicacion]}
        </Dato>
        <Dato etiqueta="Responsable" bloqueado={!permisos.asignarResponsable}>
          {p.responsable ?? <Vacio>Sin asignar</Vacio>}
        </Dato>
        <Dato etiqueta="Destino" ancho>
          {envio ? (
            <>
              Provincia · {envio.departamento}
              {envio.provincia && `, ${envio.provincia}`}
            </>
          ) : (
            "Lima"
          )}
        </Dato>
        <Dato etiqueta="Cómo se entrega" ancho bloqueado={!permisos.editarTodo}>
          {envio ? (permisos.verEnvioCompleto && envio.agencia ? `Agencia ${envio.agencia}` : LUGARES[p.entrega]) : LUGARES[p.entrega]}
          {p.direccion && <span className="text-muted-foreground block text-xs">{p.direccion}</span>}
        </Dato>

        {envio && permisos.verEnvioCompleto && (
          <>
            {!envio.agencia && (
              <p className="text-st-observado col-span-2 flex items-center gap-1.5 text-xs font-medium">
                <TriangleAlert className="size-3.5" /> Falta la agencia
              </p>
            )}
            <Dato etiqueta="Recoge" ancho>
              {envio.personaQueRecoge ?? <Vacio />}
              {envio.numeroDocumento && (
                <span className="text-muted-foreground tnum block text-xs">
                  {DOCUMENTOS[envio.tipoDocumento] !== envio.tipoDocumento
                    ? DOCUMENTOS[envio.tipoDocumento]
                    : envio.tipoDocumento}{" "}
                  {envio.numeroDocumento}
                </span>
              )}
            </Dato>
            <Dato etiqueta="Teléfono">
              {envio.telefono ? <span className="tnum">{envio.telefono}</span> : <Vacio />}
            </Dato>
            <Dato etiqueta="Flete">
              {envio.montoFlete > 0 ? (
                <>
                  <span className="tnum">{money(envio.montoFlete)}</span>
                  <span
                    className={cn(
                      "block text-xs",
                      envio.fletePagado ? "text-st-entregado" : "text-st-observado",
                    )}
                  >
                    {envio.fletePagado ? "pagado" : "por pagar"}
                  </span>
                </>
              ) : (
                <Vacio />
              )}
            </Dato>
            {envio.observacionesEnvio && (
              <Dato etiqueta="Para la agencia" ancho>
                {envio.observacionesEnvio}
              </Dato>
            )}
          </>
        )}

        {p.notasEntrega && (
          <Dato etiqueta="Notas de la entrega" ancho bloqueado={!permisos.editarTodo}>
            <span className="whitespace-pre-line">{p.notasEntrega}</span>
          </Dato>
        )}
        {p.observaciones && (
          <Dato etiqueta="Observaciones internas" ancho bloqueado={!permisos.editarTodo}>
            <span className="whitespace-pre-line">{p.observaciones}</span>
          </Dato>
        )}
      </dl>
    </Panel>
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
  return (
    <div
      className={cn(
        "bg-card flex shrink-0 items-center gap-3 rounded-xl border px-4 py-2.5",
        urgencia === "vencido" && "border-st-observado/40 bg-st-observado-soft",
        urgencia === "hoy" && "border-st-en_transito/40 bg-st-en_transito-soft",
      )}
    >
      <CalendarClock
        className={cn(
          "size-5 shrink-0",
          urgencia === "vencido"
            ? "text-st-observado"
            : urgencia === "hoy"
              ? "text-st-en_transito"
              : "text-muted-foreground",
        )}
        aria-hidden
      />
      <div>
        <p className="eyebrow flex items-center gap-1.5">
          Fecha prometida <Lock className="size-3 opacity-60" aria-label="solo lectura" />
        </p>
        <p className="text-sm font-semibold">
          <span className="tnum">{fechaCompleta(p.fechaPrometida)}</span>
          {cuanto && (
            <span
              className={cn(
                "ml-1.5 text-xs font-medium",
                urgencia === "vencido"
                  ? "text-st-observado"
                  : urgencia === "hoy"
                    ? "text-st-en_transito"
                    : "text-muted-foreground",
              )}
            >
              {cuanto}
            </span>
          )}
        </p>
      </div>
    </div>
  );
}

/* ── Piezas ── */

function Stepper({ pedido: p }: { pedido: Pedido }) {
  if (esTerminal(p.estado) && p.estado === "anulado") return null;
  const pasos = pasosDelFlujo(p.esProvincia);
  const actual = pasos.indexOf(p.estado);

  return (
    <ol className="bg-card flex flex-1 flex-wrap items-center gap-x-2 gap-y-2 rounded-xl border p-3">
      {pasos.map((paso, i) => {
        const hecho = actual > i;
        const activo = actual === i;
        return (
          <li key={paso} className="flex items-center gap-2">
            {i > 0 && (
              <span className="bg-border mr-1 h-px w-4 sm:w-6" aria-hidden />
            )}
            <span
              className={cn(
                "grid size-5 shrink-0 place-items-center rounded-full border text-2xs font-medium",
                hecho && "bg-st-entregado border-transparent text-white",
                activo && "border-primary text-primary ring-primary/20 ring-3",
                !hecho && !activo && "text-muted-foreground",
              )}
            >
              {hecho ? <Check className="size-3" /> : i + 1}
            </span>
            <span
              className={cn(
                "text-xs whitespace-nowrap",
                activo
                  ? "text-foreground font-medium"
                  : "text-muted-foreground",
              )}
            >
              {ESTADOS[paso]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Panel({
  n,
  titulo,
  extra,
  accion,
  children,
}: {
  /** El paso del formulario de registro del que viene: ① cliente, ② entrega, ③ pago. */
  n?: number;
  titulo: string;
  extra?: string;
  accion?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-card rounded-xl border">
      <header className="flex min-h-11 items-center gap-2 border-b py-1.5 pr-2 pl-4">
        {n !== undefined && (
          <span className="bg-muted text-muted-foreground text-2xs grid size-5 shrink-0 place-items-center rounded-full font-semibold">
            {n}
          </span>
        )}
        <h2 className="text-sm font-medium">{titulo}</h2>
        {extra && (
          <span className="text-muted-foreground ml-auto text-xs">{extra}</span>
        )}
        {accion && <div className={extra ? "" : "ml-auto"}>{accion}</div>}
      </header>
      <div className="flex flex-col gap-4 p-4">{children}</div>
    </section>
  );
}

function Dato({
  etiqueta,
  bloqueado,
  ancho,
  children,
}: {
  etiqueta: string;
  bloqueado?: boolean;
  ancho?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("min-w-0", ancho && "col-span-2")}>
      <dt className="eyebrow flex items-center gap-1.5">
        {etiqueta}
        {bloqueado && (
          <Lock className="size-3 opacity-60" aria-label="solo lectura" />
        )}
      </dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
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
      <header className="flex min-h-11 items-center gap-2 border-b py-1.5 pr-4 pl-4">
        <span className="bg-muted text-muted-foreground text-2xs grid size-5 shrink-0 place-items-center rounded-full font-semibold">
          3
        </span>
        <h2 className="text-sm font-medium">Pago</h2>
        <span className="text-muted-foreground ml-auto text-xs">
          {PAGOS[p.tipoPago]}
          {p.plazoCredito ? ` · ${p.plazoCredito} días` : ""}
        </span>
      </header>
      <div className="flex flex-col gap-3 p-4">
        {vence && (
          <p
            className={cn(
              "text-xs",
              vencido ? "text-saldo-alerta font-semibold" : "text-muted-foreground",
            )}
          >
            {vencido ? "Venció el " : "Vence el "}
            <span className="tnum">{fechaCompleta(vence)}</span>
          </p>
        )}
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-muted-foreground">Total</span>
          <span className="tnum font-medium">{money(p.montoTotal)}</span>
        </div>
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-muted-foreground">Abonado</span>
          <span className="tnum text-st-entregado font-medium">
            {money(p.montoPagado)}
          </span>
        </div>

        <div className="bg-muted h-1.5 overflow-hidden rounded-full">
          <motion.div
            className="bg-st-entregado h-full rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          />
        </div>

        <div className="flex items-baseline justify-between border-t pt-3">
          <span className="text-sm font-medium">Saldo</span>
          <span
            className={cn(
              "tnum text-base",
              saldo > 0
                ? "text-saldo-alerta parpadeo-alerta font-bold"
                : "text-st-entregado font-semibold",
            )}
          >
            {money(saldo)}
          </span>
        </div>

        {p.abonos.length > 0 && (
          <ul className="flex flex-col gap-2 border-t pt-3">
            <li className="eyebrow">Abonos</li>
            {p.abonos.map((a, i) => (
              <li
                key={i}
                className="flex items-baseline justify-between gap-2 text-xs"
              >
                <span className="min-w-0">
                  <span className="tnum">{fechaCompleta(a.fecha)}</span> ·{" "}
                  {METODOS[a.metodo]}
                  <span className="text-muted-foreground block">
                    {a.usuario}
                  </span>
                </span>
                <span className="tnum shrink-0 font-medium">
                  {money(a.monto)}
                </span>
              </li>
            ))}
          </ul>
        )}

        {saldo > 0 && <RegistrarAbono pedido={p} />}

        <div className="border-t pt-3">
          <p className="eyebrow">Comprobante</p>
          <p className="mt-0.5 font-mono text-sm tabular-nums">
            {p.numeroComprobante ? etiquetaComprobante(p.numeroComprobante) : <Vacio />}
          </p>
        </div>
      </div>
    </section>
  );
}
