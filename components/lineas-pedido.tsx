"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { CircleCheck, Factory, Package, Printer, RotateCw, TriangleAlert } from "lucide-react";
import * as acciones from "@/app/(app)/acciones";
import { esTerminal, type Pedido } from "@/lib/dominio";
import { money } from "@/lib/formato";
import { useStore } from "@/lib/store";
import { planchasCalculadas, type LineaDePedido, type OdooDePedido } from "@/lib/pedido-lineas";
import { medidaSobrante, type Sobrante } from "@/lib/sobrantes";
import { CorteGuardadoVista } from "@/components/cortes/corte-guardado";
import { DialogoPlanchas } from "@/components/planchas-usadas";
import { DialogoMateriales, type MaterialesAnotados } from "@/components/terminados/materiales-usados";
import { TerminadoGuardadoVista } from "@/components/terminados/terminado-guardado";
import { Button } from "@/components/ui/button";

const n = (x: number) => String(+x.toFixed(2));

/** Después de Listo las planchas ya salieron: es cuando se descuenta el stock. */
const yaTerminado = (p: Pedido) => ["listo", "en_transito", "entregado"].includes(p.estado);

/**
 * Lo que hay que hacer: los productos y los cortes del pedido, con el plano de
 * cada plancha. Es la hoja de trabajo del taller, que lo ve sin precios.
 *
 * Abajo, cómo va la venta en Odoo: si el stock ya se descontó o, si Odoo falló
 * al pasar a Listo (o al anular), el motivo y el botón para reintentar.
 */
export function LineasPedido({
  pedido: p,
  lineas,
  odoo,
  sobrantes = [],
}: {
  pedido: Pedido;
  lineas: LineaDePedido[];
  odoo: OdooDePedido | null;
  /** Los sobrantes que el pedido devolvió al almacén (piloto de sobrantes). */
  sobrantes?: Sobrante[];
}) {
  const { permisos } = useStore();
  const [anotando, setAnotando] = useState(false);
  const [anotandoMateriales, setAnotandoMateriales] = useState(false);
  const [pendiente, iniciar] = useTransition();

  const cortes = lineas.filter((l) => l.corte);
  const puedeAnotar = cortes.length > 0 && !odoo?.stockDescontado && !esTerminal(p.estado);
  const terminados = lineas.filter((l) => l.terminado);
  const puedeAnotarMateriales = terminados.length > 0 && !odoo?.stockDescontado && !esTerminal(p.estado);
  // Los productos terminados con piezas calculadas también van en la hoja de corte.
  const conHojaDeCorte = lineas.some((l) => l.corte || l.terminado?.corte);

  const anotarMateriales = (materiales: MaterialesAnotados) =>
    new Promise<acciones.Resultado>((resolver) =>
      iniciar(async () => {
        const r = await acciones.anotarMaterialesUsados({ codigo: p.codigo, materiales });
        if (r.ok) toast.success("Materiales anotados");
        else toast.error("No se guardó", { description: r.error });
        resolver(r);
      }),
    );

  const anotar = (planchas: { posicion: number; planchas: number }[]) =>
    new Promise<acciones.Resultado>((resolver) =>
      iniciar(async () => {
        const r = await acciones.anotarPlanchasUsadas({ codigo: p.codigo, planchas });
        if (r.ok) toast.success("Planchas anotadas");
        else toast.error("No se guardó", { description: r.error });
        resolver(r);
      }),
    );

  return (
    <section className="bg-card rounded-xl border" aria-labelledby="titulo-lineas">
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b py-2 pr-2 pl-4">
        <h2 id="titulo-lineas" className="text-sm font-medium whitespace-nowrap">
          Productos y cortes
        </h2>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
          {puedeAnotar && (
            <Button variant="ghost" size="sm" onClick={() => setAnotando(true)}>
              Planchas usadas
            </Button>
          )}
          {puedeAnotarMateriales && (
            <Button variant="ghost" size="sm" onClick={() => setAnotandoMateriales(true)}>
              Materiales usados
            </Button>
          )}
          {conHojaDeCorte && (
            <Button
              render={<Link href={`/pedidos/${encodeURIComponent(p.codigo)}/hoja-de-corte`} />}
              nativeButton={false}
              variant="outline"
              size="sm"
              className="gap-1.5"
            >
              <Printer className="size-3.5" />
              Hoja de corte
            </Button>
          )}
        </div>
      </header>

      <ul className="flex flex-col divide-y">
        {lineas.map((l) => (
          <li key={l.posicion} className="flex flex-col gap-3 p-4">
            {l.corte ? (
              <>
                <CorteGuardadoVista corte={l.corte} conPrecios={permisos.verMontos} />
                {l.planchasUsadas !== null && (
                  <p className="text-sm">
                    <span className="text-muted-foreground">Planchas usadas:</span>{" "}
                    <span className="tnum font-medium">{n(l.planchasUsadas)}</span>
                    {l.planchasUsadas !== planchasCalculadas(l) && (
                      <span className="text-muted-foreground"> (calculadas: {n(planchasCalculadas(l))})</span>
                    )}
                  </p>
                )}
                {l.corte.sobrantes && (
                  <Produccion linea={l} sobrantes={sobrantes.filter((s) => s.lineaPosicion === l.posicion)} />
                )}
              </>
            ) : l.terminado ? (
              <>
                <TerminadoGuardadoVista
                  terminado={l.terminado}
                  cantidad={l.cantidad}
                  importe={l.importe}
                  usados={l.materialesUsados}
                  conPrecios={permisos.verMontos}
                />
                {l.produccionNombre && (
                  <p className="text-muted-foreground flex items-center gap-1.5 pl-7 text-xs">
                    <Factory className="size-3.5" aria-hidden />
                    {l.produccionNombre} · {l.produccionCerrada ? "cerrada en Odoo" : "abierta en Odoo: reserva el material"}
                  </p>
                )}
              </>
            ) : (
              <div className="flex items-start gap-3">
                <Package className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    <span className="tnum">{n(l.cantidad)} ×</span> {l.nombre}
                    {l.codigo && <span className="text-muted-foreground ml-1.5 font-mono text-xs">{l.codigo}</span>}
                  </p>
                  {l.descripcion && (
                    <p className="text-muted-foreground mt-0.5 text-xs whitespace-pre-line">{l.descripcion}</p>
                  )}
                </div>
                {permisos.verMontos && l.importe !== null && (
                  <span className="tnum shrink-0 text-sm">{money(l.importe)}</span>
                )}
              </div>
            )}
            {l.indicaciones && (
              <p className="bg-muted/40 rounded-md border px-3 py-2 text-sm whitespace-pre-line">
                <span className="text-muted-foreground text-xs font-medium">Indicaciones del ítem {l.posicion}</span>
                <br />
                {l.indicaciones}
              </p>
            )}
          </li>
        ))}
      </ul>

      {odoo && <EstadoOdoo pedido={p} odoo={odoo} hayCortes={cortes.length > 0} hayTerminados={terminados.length > 0} />}

      {puedeAnotarMateriales && (
        <DialogoMateriales
          abierto={anotandoMateriales}
          alCambiar={setAnotandoMateriales}
          terminados={terminados}
          pendiente={pendiente}
          alConfirmar={anotarMateriales}
        />
      )}

      {puedeAnotar && (
        <DialogoPlanchas
          abierto={anotando}
          alCambiar={setAnotando}
          cortes={cortes}
          pendiente={pendiente}
          alConfirmar={anotar}
        />
      )}
    </section>
  );
}

/**
 * Con el piloto de sobrantes: la orden de fabricación del corte y los pedazos
 * que volvieron al almacén, cada uno con su etiqueta.
 */
function Produccion({ linea: l, sobrantes }: { linea: LineaDePedido; sobrantes: Sobrante[] }) {
  return (
    <div className="bg-muted/30 flex flex-col gap-2 rounded-lg border px-3 py-2.5 text-sm">
      <p className="flex flex-wrap items-center gap-x-2">
        <Factory className="text-muted-foreground size-4" aria-hidden />
        <span className="font-medium">Producción</span>
        <span className="text-muted-foreground">
          {l.produccionNombre
            ? `${l.produccionNombre} · ${l.produccionCerrada ? "cerrada en Odoo" : "abierta en Odoo"}`
            : "La orden de fabricación se crea en Odoo al confirmar el pedido."}
        </span>
      </p>
      {sobrantes.length > 0 && (
        <ul className="flex flex-col gap-1.5" aria-label="Sobrantes guardados">
          {sobrantes.map((s) => (
            <li key={s.codigo} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-primary font-mono text-xs font-semibold">{s.codigo}</span>
              <span className="tnum">{medidaSobrante(s)} cm</span>
              <span className="text-muted-foreground text-xs">{s.ubicacion ?? "Sin ubicación"}</span>
              {s.sincronizacion !== "sincronizada" && (
                <span className="text-st-observado text-xs">Falta crearlo en Odoo</span>
              )}
              <Button
                render={<Link href={`/sobrantes/${encodeURIComponent(s.codigo)}/etiqueta`} />}
                nativeButton={false}
                variant="ghost"
                size="xs"
                className="ml-auto gap-1"
                aria-label={`Etiqueta de ${s.codigo}`}
              >
                <Printer className="size-3" />
                Etiqueta
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EstadoOdoo({
  pedido: p,
  odoo,
  hayCortes,
  hayTerminados,
}: {
  pedido: Pedido;
  odoo: OdooDePedido;
  hayCortes: boolean;
  hayTerminados: boolean;
}) {
  const { permisos } = useStore();
  const [pendiente, iniciar] = useTransition();

  const reintentar = () =>
    iniciar(async () => {
      const r = await acciones.reintentarOdooDePedido({ codigo: p.codigo });
      if (r.ok) toast.success(p.estado === "anulado" ? "Venta cancelada en Odoo" : "Stock descontado en Odoo");
      else toast.error("Odoo no lo hizo", { description: r.error });
    });

  let aviso: { tono: "ok" | "error" | "nota"; texto: string; reintentar?: boolean };
  if (p.estado === "anulado") {
    if (odoo.anuladaEnOdoo) aviso = { tono: "ok", texto: "Venta cancelada en Odoo: lo reservado quedó libre." };
    else if (odoo.errorAnulacion)
      aviso = {
        tono: "error",
        texto: `No se canceló la venta en Odoo. ${odoo.errorAnulacion}`,
        reintentar: !odoo.stockDescontado,
      };
    else return null;
  } else if (odoo.stockDescontado) {
    aviso = { tono: "ok", texto: "Stock descontado en Odoo." };
  } else if (odoo.errorStock) {
    aviso = {
      tono: "error",
      texto: `No se descontó el stock en Odoo. ${odoo.errorStock}`,
      reintentar: yaTerminado(p),
    };
  } else if (yaTerminado(p)) {
    aviso = { tono: "nota", texto: "El stock todavía no se descontó en Odoo.", reintentar: true };
  } else {
    aviso = {
      tono: "nota",
      texto: hayTerminados
        ? "El material se descuenta del stock en Odoo al pasar a Listo, con lo que anotes como usado."
        : hayCortes
        ? "Las planchas se descuentan del stock en Odoo al pasar a Listo, con las que anotes como usadas."
        : "Los productos se descuentan del stock en Odoo al pasar a Listo.",
    };
  }

  const Icono = aviso.tono === "ok" ? CircleCheck : aviso.tono === "error" ? TriangleAlert : null;

  return (
    <footer className="bg-muted/30 flex flex-wrap items-center gap-x-3 gap-y-2 border-t px-4 py-3 text-xs">
      <p className="flex min-w-0 flex-1 items-start gap-1.5" role={aviso.tono === "error" ? "alert" : undefined}>
        {Icono && (
          <Icono
            className={
              aviso.tono === "ok" ? "text-st-entregado mt-px size-3.5 shrink-0" : "text-st-observado mt-px size-3.5 shrink-0"
            }
            aria-hidden
          />
        )}
        <span className={aviso.tono === "nota" ? "text-muted-foreground" : undefined}>{aviso.texto}</span>
      </p>
      {permisos.gestionarCotizaciones && (
        <Link href={`/cotizaciones/${odoo.cotizacionId}`} className="text-muted-foreground font-mono hover:underline">
          {odoo.orderName ?? "Cotización"}
        </Link>
      )}
      {aviso.reintentar && (
        <Button variant="outline" size="sm" onClick={reintentar} disabled={pendiente} className="gap-1.5">
          <RotateCw className="size-3.5" />
          {pendiente ? "Intentando…" : "Reintentar"}
        </Button>
      )}
    </footer>
  );
}
