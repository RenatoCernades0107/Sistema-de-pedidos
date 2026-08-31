"use client";

import Link from "next/link";
import { motion } from "motion/react";
import {
  ArrowLeft,
  Check,
  FileText,
  ImageIcon,
  Lock,
  Paperclip,
  Receipt,
  ScrollText,
  Trash2,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/store";
import {
  DOCUMENTOS,
  ESTADOS,
  LUGARES,
  METODOS,
  PAGOS,
  PRODUCTOS,
  UBICACIONES,
  esTerminal,
  etiquetaTipos,
  pasosDelFlujo,
  saldoDe,
  venceCreditoEl,
  type Adjunto,
  type Pedido,
} from "@/lib/dominio";
import {
  cantidadTexto,
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
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export function DetallePedido({ codigo }: { codigo: string }) {
  const { pedido, permisos } = useStore();
  const p = pedido(codigo);

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
            render={<Link href="/admin" />}
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

  // Entregado o anulado: el pedido ya tiene factura o motivo de cierre. No se toca.
  const cerrado = esTerminal(p.estado);

  return (
    <div className="px-4 py-5 md:px-6 md:py-6">
      <Button
        render={<Link href={`/${permisos.vistaInicial}`} />}
        nativeButton={false}
        variant="ghost"
        size="sm"
        className="text-muted-foreground -ml-2 mb-3 gap-1.5"
      >
        <ArrowLeft className="size-3.5" />
        Volver a la lista
      </Button>

      <header className="mb-5">
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
        {/* Sin el cliente, el título es el trabajo: es lo que el taller
            necesita leer primero y el código ya está justo encima. */}
        <h1 className="mt-1 text-xl font-semibold tracking-tight">
          {permisos.verCliente
            ? p.cliente
            : `${etiquetaTipos(p.tipos)}${p.producto ? ` · ${PRODUCTOS[p.producto]}` : ""}`}
        </h1>
      </header>

      {(p.estado === "observado" || p.estado === "anulado") && p.motivo && (
        <div
          className={cn(
            "mb-5 flex gap-2.5 rounded-xl border p-3 text-sm",
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

      <Stepper pedido={p} />

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="order-2 flex flex-col gap-4 lg:order-1">
          <Panel
            titulo="Datos del pedido"
            accion={
              permisos.editarTodo && !cerrado ? <EditarDatos pedido={p} /> : undefined
            }
          >
            <dl className="grid gap-4 sm:grid-cols-2">
              {permisos.verCliente && (
                <Dato etiqueta="Cliente" bloqueado={!permisos.editarTodo}>
                  {p.cliente}
                </Dato>
              )}
              {/* Logística lo lee para coordinar la entrega; corregirlo es de Administración. */}
              {permisos.verTelefonoCliente && (
                <Dato etiqueta="Teléfono del cliente" bloqueado={!permisos.editarTodo}>
                  {p.telefonoCliente ? (
                    <a
                      href={`tel:${p.telefonoCliente.replace(/\s+/g, "")}`}
                      className="tnum hover:underline"
                    >
                      {p.telefonoCliente}
                    </a>
                  ) : (
                    <Vacio>Sin teléfono</Vacio>
                  )}
                </Dato>
              )}
              <Dato
                etiqueta="Responsable en taller"
                bloqueado={!permisos.asignarResponsable}
              >
                {p.responsable ?? <Vacio>Sin asignar</Vacio>}
              </Dato>
              <Dato etiqueta="Tipo de pedido" bloqueado={!permisos.editarTodo}>
                {etiquetaTipos(p.tipos)}
                {p.producto ? ` · ${PRODUCTOS[p.producto]}` : ""}
              </Dato>
              <Dato etiqueta="Cantidad" bloqueado={!permisos.editarTodo}>
                <span className="tnum">{cantidadTexto(p)}</span>
              </Dato>
              <Dato
                etiqueta="Lugar de entrega"
                bloqueado={!permisos.editarTodo}
              >
                {LUGARES[p.entrega]}
                {p.direccion && (
                  <span className="text-muted-foreground block text-xs">
                    {p.direccion}
                  </span>
                )}
              </Dato>
              <Dato
                etiqueta="Ubicación actual"
                bloqueado={!permisos.editarUbicacion}
              >
                {UBICACIONES[p.ubicacion]}
              </Dato>
              {/* Inmutable para todos los roles: es el compromiso con el cliente */}
              <Dato etiqueta="Fecha prometida" bloqueado>
                <span
                  className={cn(
                    "tnum",
                    urgenciaDe(p) === "vencido" &&
                      "text-st-observado font-medium",
                    urgenciaDe(p) === "hoy" &&
                      "text-st-en_transito font-medium",
                  )}
                >
                  {fechaCompleta(p.fechaPrometida)}
                </span>
              </Dato>
              <Dato etiqueta="Creado" bloqueado>
                <span className="tnum">{fechaCompleta(p.fechaCreacion)}</span>
              </Dato>
              {p.fechaEntrega && (
                <Dato etiqueta="Entregado" bloqueado>
                  <span className="tnum">{fechaCompleta(p.fechaEntrega)}</span>
                </Dato>
              )}
              {p.fechaAnulacion && (
                <Dato etiqueta="Anulado" bloqueado>
                  <span className="tnum">{fechaCompleta(p.fechaAnulacion)}</span>
                </Dato>
              )}
              {/* El detalle es lo que más se consulta del pedido, así que abre
                  el bloque de datos en vez de vivir tres paneles más abajo. */}
              <Dato etiqueta="Detalle del pedido" ancho bloqueado={!permisos.editarTodo}>
                {p.detalle || <Vacio />}
              </Dato>
              <Dato etiqueta="Observaciones" ancho bloqueado={!permisos.editarTodo}>
                {p.observaciones || <Vacio>Sin observaciones</Vacio>}
              </Dato>
            </dl>
          </Panel>

          {p.esProvincia && p.envio && (
            <Panel
              titulo={
                permisos.verEnvioCompleto ? "Envío a provincia" : "Destino"
              }
              extra={
                permisos.verEnvioCompleto
                  ? p.envio.agencia
                    ? "Agencia asignada"
                    : "Falta agencia"
                  : undefined
              }
              accion={
                permisos.editarEnvio && !cerrado ? <EditarEnvio pedido={p} /> : undefined
              }
            >
              <dl className="grid gap-4 sm:grid-cols-2">
                <Dato etiqueta="Departamento">{p.envio.departamento}</Dato>
                <Dato etiqueta="Provincia">
                  {p.envio.provincia ?? <Vacio />}
                </Dato>
                {permisos.verEnvioCompleto && (
                  <>
                    <Dato etiqueta="Agencia">
                      {p.envio.agencia ?? <Vacio />}
                    </Dato>
                    <Dato etiqueta="Flete">
                      {p.envio.montoFlete > 0 ? (
                        <>
                          <span className="tnum">
                            {money(p.envio.montoFlete)}
                          </span>{" "}
                          <span
                            className={
                              p.envio.fletePagado
                                ? "text-st-entregado"
                                : "text-st-observado"
                            }
                          >
                            · {p.envio.fletePagado ? "pagado" : "por pagar"}
                          </span>
                        </>
                      ) : (
                        <Vacio />
                      )}
                    </Dato>
                    <Dato etiqueta="Persona que recoge">
                      {p.envio.personaQueRecoge ?? <Vacio />}
                    </Dato>
                    <Dato etiqueta="Documento del que recoge">
                      {p.envio.numeroDocumento ? (
                        <>
                          <span className="tnum">
                            {p.envio.tipoDocumento} {p.envio.numeroDocumento}
                          </span>
                          {/* "DNI" ya se lee en la sigla; el nombre largo solo
                              aporta cuando la sigla no se explica sola. */}
                          {DOCUMENTOS[p.envio.tipoDocumento] !== p.envio.tipoDocumento && (
                            <span className="text-muted-foreground block text-xs">
                              {DOCUMENTOS[p.envio.tipoDocumento]}
                            </span>
                          )}
                        </>
                      ) : (
                        <Vacio />
                      )}
                    </Dato>
                    <Dato etiqueta="Teléfono">
                      {p.envio.telefono ? (
                        <span className="tnum">{p.envio.telefono}</span>
                      ) : (
                        <Vacio />
                      )}
                    </Dato>
                    {p.envio.observacionesEnvio && (
                      <Dato etiqueta="Observaciones del envío" ancho>
                        {p.envio.observacionesEnvio}
                      </Dato>
                    )}
                  </>
                )}
              </dl>
            </Panel>
          )}

          <Panel titulo="Archivos">
            <Adjuntos pedido={p} />
          </Panel>

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

        <div className="order-1 flex flex-col gap-4 lg:order-2 lg:sticky lg:top-20">
          <AccionesPedido pedido={p} />
          {permisos.verMontos && <PanelPago pedido={p} />}
        </div>
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
    <ol className="bg-card flex flex-wrap items-center gap-x-2 gap-y-2 rounded-xl border p-3">
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
      <header className="flex items-center gap-2 border-b py-2 pr-2 pl-4">
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
    <div className={cn("min-w-0", ancho && "sm:col-span-2")}>
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

const ICONO_ADJUNTO = {
  diseno: FileText,
  factura: Receipt,
  guia: ScrollText,
  foto_entrega: ImageIcon,
} as const;

function Adjuntos({ pedido: p }: { pedido: Pedido }) {
  const { permisos } = useStore();
  const visibles: Adjunto[] = permisos.verEnvioCompleto
    ? p.adjuntos
    : p.adjuntos.filter(
        (a) => a.tipo === "diseno" || a.tipo === "foto_entrega",
      );

  if (visibles.length === 0) {
    return (
      <div className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
        <Paperclip className="mx-auto mb-2 size-4 opacity-50" />
        Sin archivos todavía
      </div>
    );
  }

  return (
    <ul className="flex flex-wrap gap-2">
      {visibles.map((a) => {
        const Icono = ICONO_ADJUNTO[a.tipo];
        return (
          <li key={a.nombre}>
            <div className="bg-muted/40 focus-within:border-ring/40 hover:border-ring/40 flex items-center gap-2.5 rounded-lg border py-2 pr-1.5 pl-2.5 transition-colors">
              <button
                type="button"
                className="focus-visible:ring-ring flex min-w-0 items-center gap-2.5 rounded text-left focus-visible:ring-2 focus-visible:outline-none"
              >
                <span className="bg-card grid size-7 shrink-0 place-items-center rounded-md border">
                  <Icono className="text-muted-foreground size-3.5" />
                </span>
                <span className="min-w-0">
                  <span className="block max-w-[16ch] truncate text-xs font-medium">
                    {a.nombre}
                  </span>
                  <span className="text-muted-foreground block text-2xs">
                    {a.peso}
                  </span>
                </span>
              </button>
              {permisos.editarTodo && <EliminarAdjunto pedido={p} adjunto={a} />}
            </div>
          </li>
        );
      })}
      <li>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground h-full gap-1.5"
        >
          <Upload className="size-3.5" />
          Subir
        </Button>
      </li>
    </ul>
  );
}

/**
 * Borrar un archivo no se deshace: el archivo sale de Storage y no vuelve.
 * Solo Administración, y siempre detrás de una confirmación que nombra el archivo.
 */
function EliminarAdjunto({
  pedido: p,
  adjunto: a,
}: {
  pedido: Pedido;
  adjunto: Adjunto;
}) {
  const { eliminarAdjunto } = useStore();

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-destructive shrink-0"
          />
        }
        nativeButton
        aria-label={`Eliminar ${a.nombre}`}
      >
        <Trash2 className="size-3.5" />
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar este archivo?</AlertDialogTitle>
          <AlertDialogDescription>
            Se eliminará <span className="text-foreground font-medium">{a.nombre}</span> del
            pedido {p.codigo} de forma permanente. No se puede deshacer y el archivo no se
            puede recuperar. Quedará registrado en la auditoría quién lo eliminó y cuándo.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel render={<Button variant="outline" />} nativeButton>
            Cancelar
          </AlertDialogCancel>
          <AlertDialogAction
            render={<Button variant="destructive" />}
            nativeButton
            onClick={() => eliminarAdjunto(p.codigo, a.nombre)}
          >
            Eliminar definitivamente
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function PanelPago({ pedido: p }: { pedido: Pedido }) {
  const saldo = saldoDe(p);
  const pct = p.montoTotal
    ? Math.min(100, Math.round((p.montoPagado / p.montoTotal) * 100))
    : 0;
  const vence = venceCreditoEl(p);
  const vencido = creditoVencido(p);

  return (
    <section className="bg-card rounded-xl border">
      <header className="flex items-center gap-2 border-b px-4 py-3">
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
          <p className="eyebrow">Número de factura</p>
          <p className="mt-0.5 font-mono text-sm tabular-nums">
            {p.numeroFactura ?? <Vacio />}
          </p>
        </div>
      </div>
    </section>
  );
}
