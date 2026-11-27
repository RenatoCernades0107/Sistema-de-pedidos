"use client";

import Link from "next/link";
import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  FileDown,
  GitBranch,
  MessageSquareText,
  Pencil,
  Plus,
  RotateCw,
  Scissors,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import {
  cambiarAlmacenDeCotizacion,
  marcarCotizacionEnviada,
  nuevaVersionDeCotizacion,
  refrescarCotizacionEnOdoo,
  reintentarCambiosEnOdoo,
  reintentarConfirmacion,
  reintentarSincronizacion,
} from "@/app/(app)/cotizaciones/acciones";
import type { Almacen } from "@/lib/almacenes";
import { MOTIVOS_FALTANTE, type Faltante } from "@/lib/faltantes";
import { SelectorAlmacen, nombreDeAlmacen } from "@/components/almacen/comun";
import {
  admiteVersionNueva,
  esEditable,
  etiquetaVersion,
  motivoNoEnviable,
  referenciaDe,
  sumaLineas,
  type Cotizacion,
} from "@/lib/cotizaciones";
import { momentoEnLima } from "@/lib/fecha";
import { fechaHora, money, numero } from "@/lib/formato";
import { Button } from "@/components/ui/button";
import { TerminadoGuardadoVista } from "@/components/terminados/terminado-guardado";
import { CorteGuardadoVista } from "@/components/cortes/corte-guardado";
import type { CuentaPublica } from "@/lib/cuentas-bancarias";
import { CompartirMenu } from "@/components/compartir-menu";
import { asuntoCotizacion, mensajeCotizacion, nombreArchivoCotizacion, textoCotizacion } from "@/lib/compartir";
import { CodigoProducto } from "./buscador-producto";
import { CanalBadge, EstadoDeCotizacion, EstadoSincronizacion } from "./estado-cotizacion";

export function DetalleCotizacion({
  cotizacion: c,
  enlaceOdoo,
  puedeAsistente,
  puedeCrearPedido,
  validezDias,
  cuentasPdf = [],
  almacenes = [],
  despachoId = null,
  faltantes = null,
  siguiente = null,
  anterior = null,
}: {
  cotizacion: Cotizacion;
  /** Calculado en el servidor: la URL de Odoo no viaja en el bundle. */
  enlaceOdoo: string | null;
  puedeAsistente: boolean;
  puedeCrearPedido: boolean;
  /** La validez que va en el PDF y en el texto (de /configuracion). */
  validezDias: number;
  /** Las cuentas que se pueden elegir al ver o descargar el PDF. */
  cuentasPdf?: CuentaPublica[];
  /** Los almacenes, y del que sale la venta (el elegido o el de la regla). */
  almacenes?: Almacen[];
  despachoId?: string | null;
  /** Lo que faltaría con ese despacho (stock libre de Odoo). `null`: no se sabe. */
  faltantes?: Faltante[] | null;
  /** La versión nueva de esta cotización, si ya se hizo (en curso o enviada). */
  siguiente?: { id: string; version: number; estado: Cotizacion["estado"]; odooOrderName: string | null } | null;
  /** La cotización de la que esta es versión nueva. */
  anterior?: { id: string; version: number; odooOrderName: string | null } | null;
}) {
  const router = useRouter();
  const [reintentando, iniciar] = useTransition();
  const [confirmando, iniciarConfirmacion] = useTransition();
  const [, iniciarAlmacen] = useTransition();
  const [enviando, iniciarEnvio] = useTransition();
  const [versionando, iniciarVersion] = useTransition();
  const [reintentandoCambios, iniciarCambios] = useTransition();
  const [refrescando, iniciarRefresco] = useTransition();
  const despacho = almacenes.find((a) => a.id === despachoId) ?? null;
  const editable = esEditable(c);
  const motivoNoEnvio = motivoNoEnviable(c);
  /** Para que compartir por varias vías seguidas no intente enviarla dos veces. */
  const yaSeEnvio = useRef(false);

  const enviar = (alCompartir = false) => {
    if (yaSeEnvio.current) return;
    yaSeEnvio.current = true;
    iniciarEnvio(async () => {
      const r = await marcarCotizacionEnviada(c.id);
      if (!r.ok) {
        yaSeEnvio.current = false;
        toast.error("No se marcó como enviada", { description: r.error });
      } else {
        toast.success(
          alCompartir
            ? "Marcada como enviada: ya no se edita. Si hay que cambiarla, haz una versión nueva."
            : "Marcada como enviada: ya no se edita.",
        );
        if (r.anterior?.canceladaEnOdoo) {
          toast.info(`${r.anterior.orderName ?? "La versión anterior"} quedó reemplazada y se canceló en Odoo`);
        } else if (r.anterior) {
          toast.warning(`No se canceló ${r.anterior.orderName ?? "la versión anterior"} en Odoo`, {
            description: r.anterior.error ?? undefined,
          });
        }
      }
      router.refresh();
    });
  };

  /** Lo que salió hacia el cliente deja de ser un borrador, si se puede. */
  const alCompartir = () => {
    if (editable && !motivoNoEnvio) enviar(true);
  };

  const nuevaVersion = () =>
    iniciarVersion(async () => {
      const r = await nuevaVersionDeCotizacion(c.id);
      if (!r.ok) {
        toast.error("No se pudo hacer la versión nueva", { description: r.error });
        router.refresh();
        return;
      }
      if (!r.enOdoo && r.errorOdoo) toast.warning("Se hizo la versión nueva, pero Odoo no la aceptó", { description: r.errorOdoo });
      else toast.success("Versión nueva en borrador");
      router.push(`/cotizaciones/${r.id}/editar`);
    });

  const reintentarCambios = () =>
    iniciarCambios(async () => {
      const r = await reintentarCambiosEnOdoo(c.id);
      if (r.ok) toast.success(`${r.orderName} actualizada en Odoo`);
      else toast.error("Odoo volvió a rechazar los cambios", { description: r.error });
      router.refresh();
    });

  const cambiarAlmacen = (almacenId: string) =>
    iniciarAlmacen(async () => {
      const r = await cambiarAlmacenDeCotizacion(c.id, almacenId);
      if (r.ok) toast.success("Almacén de despacho cambiado");
      else toast.error("No se cambió el almacén", { description: r.error });
      router.refresh();
    });

  const confirmar = () =>
    iniciarConfirmacion(async () => {
      const r = await reintentarConfirmacion(c.id);
      if (r.ok) toast.success(`${referenciaDe(c)} confirmada en Odoo`);
      else toast.error("Odoo no la confirmó", { description: r.error });
      router.refresh();
    });

  const refrescar = () =>
    iniciarRefresco(async () => {
      const r = await refrescarCotizacionEnOdoo(c.id);
      if (r.ok) toast.success(`${r.orderName} refrescada en Odoo`);
      else toast.error("No se refrescó en Odoo", { description: r.error });
      router.refresh();
    });
  // Solo mientras en Odoo siga siendo cotización: con pedido, ya se confirmó (o está por confirmarse).
  const refrescable =
    !!c.odooOrderId && c.sincronizacion === "sincronizada" && !c.pedido && c.estado !== "reemplazada" && !c.errorEdicion;

  const reintentar = () =>
    iniciar(async () => {
      const r = await reintentarSincronizacion(c.id);
      if (r.ok) toast.success(`Cotización ${r.orderName} creada en Odoo`);
      else toast.error("Odoo volvió a rechazarla", { description: r.error });
      router.refresh();
    });

  const suma = sumaLineas(c.lineas);

  return (
    <div className="px-4 py-5 md:px-6 md:py-6">
      <Button
        render={<Link href="/cotizaciones" />}
        nativeButton={false}
        variant="ghost"
        size="sm"
        className="text-muted-foreground -ml-2 mb-3 gap-1.5"
      >
        <ArrowLeft className="size-3.5" />
        Cotizaciones
      </Button>

      <header className="mb-5 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="eyebrow">Cotización</p>
          <h1 className="mt-0.5 flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight">
            <span data-testid="referencia-cotizacion">{referenciaDe(c)}</span>
            <CanalBadge canal={c.canal} />
            <EstadoDeCotizacion cotizacion={c} />
            <EstadoSincronizacion estado={c.sincronizacion} />
          </h1>
          <p className="text-muted-foreground mt-1 text-xs">
            {fechaHora(momentoEnLima(c.creadoEn))}
            {c.creadoPor && ` · ${c.creadoPor}`}
            {c.chatAgenteId && " · desde el asistente"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {c.tokenPublico && (
            <CompartirMenu
              ruta={`/c/${c.tokenPublico}/pdf`}
              mensaje={(url) => mensajeCotizacion(c, url)}
              asunto={asuntoCotizacion(c)}
              telefono={c.cliente.telefono}
              esPdf
              cuentasPdf={cuentasPdf}
              texto={{ contenido: textoCotizacion(c, validezDias), nombre: nombreArchivoCotizacion(c, "txt") }}
              alCompartir={editable ? alCompartir : undefined}
            />
          )}
          {enlaceOdoo && c.odooOrderId && (
            <Button
              render={<a href={enlaceOdoo} target="_blank" rel="noreferrer" />}
              nativeButton={false}
              variant="outline"
              className="gap-1.5"
            >
              <ExternalLink />
              Abrir en Odoo
            </Button>
          )}
          {refrescable && (
            <Button
              onClick={refrescar}
              disabled={refrescando}
              title="Vuelve a escribir en Odoo las líneas de esta cotización, tal como están aquí"
              variant="outline"
              className="gap-1.5"
            >
              <RotateCw className={refrescando ? "animate-spin" : undefined} />
              {refrescando ? "Refrescando…" : "Refrescar en Odoo"}
            </Button>
          )}
          {editable && (
            <>
              <Button
                render={<Link href={`/cotizaciones/${c.id}/editar`} />}
                nativeButton={false}
                variant="outline"
                className="gap-1.5"
              >
                <Pencil />
                Editar
              </Button>
              <Button
                onClick={() => enviar()}
                disabled={enviando || !!motivoNoEnvio}
                title={motivoNoEnvio ?? "Bloquea la cotización: lo que se le ofreció al cliente no cambia"}
                variant="outline"
                className="gap-1.5"
              >
                <Send />
                {enviando ? "Marcando…" : "Marcar como enviada"}
              </Button>
            </>
          )}
          {admiteVersionNueva(c) &&
            (siguiente ? (
              <Button
                render={<Link href={`/cotizaciones/${siguiente.id}`} />}
                nativeButton={false}
                variant="outline"
                className="gap-1.5"
              >
                <GitBranch />
                Ver v{siguiente.version}
              </Button>
            ) : (
              <Button
                onClick={nuevaVersion}
                disabled={versionando}
                title="Copia esta cotización a un borrador nuevo para cambiarla"
                variant="outline"
                className="gap-1.5"
              >
                <GitBranch />
                {versionando ? "Creando…" : "Nueva versión"}
              </Button>
            ))}
          <Button
            render={<Link href="/cotizaciones/nueva" />}
            nativeButton={false}
            variant={puedeCrearPedido ? "outline" : "default"}
            className="gap-1.5"
          >
            <Plus />
            Nueva cotización
          </Button>
          {puedeCrearPedido &&
            (c.pedido ? (
              <Button
                render={<Link href={`/pedidos/${c.pedido.codigo}`} />}
                nativeButton={false}
                className="gap-1.5"
              >
                <ClipboardList />
                Ver pedido {c.pedido.codigo}
              </Button>
            ) : c.estado === "reemplazada" ? (
              <Button disabled className="gap-1.5" title="Ya la reemplaza una versión nueva">
                <ClipboardList />
                Crear pedido
              </Button>
            ) : c.errorEdicion ? (
              <Button disabled className="gap-1.5" title="Los últimos cambios todavía no están en Odoo">
                <ClipboardList />
                Crear pedido
              </Button>
            ) : c.sincronizacion === "sincronizada" ? (
              <Button
                render={<Link href={`/pedidos/nuevo?cotizacion=${c.id}`} />}
                nativeButton={false}
                className="gap-1.5"
              >
                <ClipboardList />
                Crear pedido
              </Button>
            ) : (
              // Sin orden en Odoo no hay qué confirmar al crear el pedido.
              <Button disabled className="gap-1.5" title="Primero tiene que crearse en Odoo">
                <ClipboardList />
                Crear pedido
              </Button>
            ))}
        </div>
      </header>

      <div className="flex max-w-3xl flex-col gap-4">
        {(anterior || c.estado === "reemplazada" || (admiteVersionNueva(c) && siguiente)) && (
          <section className="bg-card flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-4 py-3 text-sm">
            <GitBranch className="text-muted-foreground size-4 shrink-0" />
            <div className="min-w-0 flex-1">
              {anterior && (
                <p>
                  Versión {etiquetaVersion(c) ?? c.version} de{" "}
                  <Link href={`/cotizaciones/${anterior.id}`} className="text-primary hover:underline">
                    {anterior.odooOrderName ?? "la cotización anterior"}
                  </Link>
                  .{" "}
                  <span className="text-muted-foreground">
                    {c.estado === "borrador"
                      ? "La anterior sigue vigente hasta que envíes esta."
                      : "La anterior quedó reemplazada."}
                  </span>
                </p>
              )}
              {c.estado === "reemplazada" && siguiente && (
                <p>
                  Reemplazada por{" "}
                  <Link href={`/cotizaciones/${siguiente.id}`} className="text-primary hover:underline">
                    {siguiente.odooOrderName ?? `la v${siguiente.version}`}
                  </Link>
                  . <span className="text-muted-foreground">Queda de historial: no se edita ni genera pedido.</span>
                </p>
              )}
              {c.estado !== "reemplazada" && siguiente && (
                <p>
                  Hay una versión nueva en{" "}
                  <Link href={`/cotizaciones/${siguiente.id}`} className="text-primary hover:underline">
                    borrador (v{siguiente.version})
                  </Link>
                  . <span className="text-muted-foreground">Esta sigue vigente hasta que se envíe aquella.</span>
                </p>
              )}
            </div>
          </section>
        )}

        {c.errorEdicion && (
          <div
            role="alert"
            className="border-destructive/30 bg-destructive/10 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm"
          >
            <div className="min-w-0 flex-1">
              <p className="text-destructive font-medium">Odoo no tiene los últimos cambios</p>
              <p className="text-destructive/90 mt-0.5">{c.errorEdicion}</p>
              <p className="text-muted-foreground mt-1 text-xs">
                Lo editado está guardado aquí. Hasta que Odoo lo reciba no se puede enviar ni sacar un pedido.
              </p>
            </div>
            <Button onClick={reintentarCambios} disabled={reintentandoCambios} className="gap-1.5">
              <RotateCw className={reintentandoCambios ? "animate-spin" : undefined} />
              {reintentandoCambios ? "Reintentando…" : "Reintentar"}
            </Button>
          </div>
        )}

        {c.sincronizacion === "error" && (
          <div
            role="alert"
            className="border-destructive/30 bg-destructive/10 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm"
          >
            <div className="min-w-0 flex-1">
              <p className="text-destructive font-medium">No se creó en Odoo</p>
              <p className="text-destructive/90 mt-0.5">{c.errorSincronizacion}</p>
              <p className="text-muted-foreground mt-1 text-xs">
                Lo cotizado está guardado. Reintentar no la duplica en Odoo.
              </p>
            </div>
            <Button onClick={reintentar} disabled={reintentando} className="gap-1.5">
              <RotateCw className={reintentando ? "animate-spin" : undefined} />
              {reintentando ? "Reintentando…" : "Reintentar"}
            </Button>
          </div>
        )}

        {c.pedido && (
          <section
            className={
              c.errorConfirmacion
                ? "border-destructive/30 bg-destructive/10 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm"
                : "bg-card flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm"
            }
            role={c.errorConfirmacion ? "alert" : undefined}
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                Pedido{" "}
                <Link href={`/pedidos/${c.pedido.codigo}`} className="text-primary tnum hover:underline">
                  {c.pedido.codigo}
                </Link>
              </p>
              {c.confirmadaEnOdoo ? (
                <p className="text-muted-foreground mt-0.5 flex items-center gap-1.5">
                  <CheckCircle2 className="text-st-entregado size-3.5" />
                  Confirmada en Odoo como pedido de venta.
                </p>
              ) : c.errorConfirmacion ? (
                <>
                  <p className="text-destructive mt-0.5">No se confirmó en Odoo: {c.errorConfirmacion}</p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    El pedido ya está registrado. Confirmar no la duplica en Odoo.
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground mt-0.5">Todavía sin confirmar en Odoo.</p>
              )}
            </div>
            {!c.confirmadaEnOdoo && (
              <Button
                onClick={confirmar}
                disabled={confirmando}
                variant={c.errorConfirmacion ? "default" : "outline"}
                className="gap-1.5"
              >
                <RotateCw className={confirmando ? "animate-spin" : undefined} />
                {confirmando ? "Confirmando…" : "Confirmar en Odoo"}
              </Button>
            )}
          </section>
        )}

        {despacho && (
          <section className="bg-card flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border p-4 text-sm">
            <div className="min-w-0 flex-1">
              <p className="eyebrow mb-1">Sale del almacén</p>
              <p className="text-muted-foreground text-xs">
                {c.confirmadaEnOdoo
                  ? "Ya es pedido de venta: la entrega sale de aquí."
                  : "Por defecto, el taller si algo se produce allí; si no, el que tiene el stock (la tienda primero). Puedes cambiarlo."}
              </p>
            </div>
            {c.confirmadaEnOdoo ? (
              <p className="font-medium">{nombreDeAlmacen(despacho)}</p>
            ) : (
              <SelectorAlmacen
                almacenes={almacenes}
                valor={despacho.id}
                alCambiar={(id) => id !== despacho.id && cambiarAlmacen(id)}
                etiqueta="Almacén de despacho"
                className="w-56"
              />
            )}
            {faltantes && faltantes.length > 0 && (
              <ul className="w-full border-t pt-2 text-xs" aria-label="Faltaría">
                {faltantes.map((f) => (
                  <li key={`${f.productoId}|${f.almacenId}`} className="text-st-observado flex flex-wrap gap-x-1.5">
                    <span className="font-mono">{f.codigo}</span>
                    <span>
                      faltarían {+f.falta.toFixed(2)} en {almacenes.find((a) => a.id === f.almacenId)?.nombre}{" "}
                      {MOTIVOS_FALTANTE[f.motivo]}
                    </span>
                    <span className="text-muted-foreground">
                      {f.origenSugeridoId
                        ? `· hay ${+f.hayEnOrigen.toFixed(2)} en ${almacenes.find((a) => a.id === f.origenSugeridoId)?.nombre}`
                        : "· no hay en ningún almacén"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <section className="bg-card rounded-xl border p-4">
          <p className="eyebrow mb-1.5">Cliente</p>
          <p className="font-medium">{c.cliente.nombre}</p>
          {c.cliente.contacto && (
            <p className="text-muted-foreground mt-0.5 text-sm" data-testid="contacto-cotizacion">
              Atiende: <span className="text-foreground font-medium">{c.cliente.contacto.nombre}</span>
            </p>
          )}
          <p className="text-muted-foreground tnum mt-0.5 flex flex-wrap gap-x-3 text-sm">
            {c.cliente.documento && <span>{c.cliente.documento}</span>}
            {c.cliente.telefono && <span>{c.cliente.telefono}</span>}
          </p>
        </section>

        <section className="bg-card overflow-hidden rounded-xl border">
          <p className="eyebrow border-b px-4 py-2.5">Productos</p>
          <ul className="divide-y">
            {c.lineas.map((l) =>
              l.corte ? (
                // Un corte a medida: su cálculo entero, con el plano.
                <li key={l.posicion} className="px-4 py-3" data-testid="linea-corte">
                  <CorteGuardadoVista corte={l.corte} conPrecios />
                </li>
              ) : l.terminado ? (
                <li key={l.posicion} className="px-4 py-3">
                  <TerminadoGuardadoVista terminado={l.terminado} cantidad={l.cantidad} importe={l.importe} conPrecios />
                </li>
              ) : (
                <li key={l.posicion} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm">
                      {l.codigo && <CodigoProducto codigo={l.codigo} />}
                      <span className="font-medium">{l.nombre}</span>
                    </p>
                    {l.descripcion && (
                      <p className="text-muted-foreground mt-1 text-xs whitespace-pre-line">{l.descripcion}</p>
                    )}
                  </div>
                  <p className="tnum text-muted-foreground text-sm">
                    {numero(l.cantidad)} × {money(l.precioUnitario)}
                  </p>
                  <p className="tnum w-24 text-right text-sm font-medium">{money(l.importe)}</p>
                </li>
              ),
            )}
          </ul>
          <dl className="bg-muted/30 flex flex-col gap-1 border-t px-4 py-3 text-sm">
            {c.montoTotal !== null ? (
              <>
                <Fila etiqueta="Subtotal" valor={c.montoSinImpuestos} />
                <Fila etiqueta="Impuestos" valor={c.montoImpuestos} />
                <Fila etiqueta="Total en Odoo" valor={c.montoTotal} fuerte />
              </>
            ) : (
              <Fila etiqueta="Total referencial" valor={suma} fuerte />
            )}
          </dl>
        </section>

        {c.notas && (
          <section className="bg-card rounded-xl border p-4">
            <p className="eyebrow mb-1.5">Notas internas</p>
            <p className="text-sm whitespace-pre-line">{c.notas}</p>
          </section>
        )}

        {c.chatAgenteId && puedeAsistente && (
          <section className="bg-card flex flex-wrap gap-2 rounded-xl border p-4">
            <p className="eyebrow w-full">Del asistente</p>
            <Button
              render={<Link href={`/cotizaciones/asistente?chat=${encodeURIComponent(c.chatAgenteId)}`} />}
              nativeButton={false}
              variant="outline"
              size="sm"
              className="gap-1.5"
            >
              <MessageSquareText />
              Ver chat
            </Button>
            <Button
              render={
                <a href={`/api/cotizaciones/${encodeURIComponent(c.chatAgenteId)}/cotizacion`} target="_blank" rel="noreferrer" />
              }
              nativeButton={false}
              variant="outline"
              size="sm"
              className="gap-1.5"
            >
              <FileDown />
              PDF de la cotización
            </Button>
            <Button
              render={
                <a href={`/api/cotizaciones/${encodeURIComponent(c.chatAgenteId)}/hoja-corte`} target="_blank" rel="noreferrer" />
              }
              nativeButton={false}
              variant="outline"
              size="sm"
              className="gap-1.5"
            >
              <Scissors />
              Hoja de corte
            </Button>
          </section>
        )}
      </div>
    </div>
  );
}

function Fila({ etiqueta, valor, fuerte }: { etiqueta: string; valor: number | null; fuerte?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className={fuerte ? "font-medium" : "text-muted-foreground"}>{etiqueta}</dt>
      <dd className={fuerte ? "tnum text-base font-semibold" : "tnum"}>{valor === null ? "—" : money(valor)}</dd>
    </div>
  );
}
