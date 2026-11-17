"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Boxes,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  ClipboardList,
  Factory,
  Layers,
  NotebookPen,
  Package,
  Paperclip,
  Printer,
  RotateCw,
  Scissors,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import * as acciones from "@/app/(app)/acciones";
import { CLASES_ITEM, esTerminal, type ClaseItem, type Pedido } from "@/lib/dominio";
import { MODALIDADES } from "@/lib/cortes/calcular";
import { materialDeCorte, totalPiezas } from "@/lib/cortes/guardado";
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

/** De qué es una línea: un corte, un producto terminado o un producto de Odoo tal cual. */
export const claseDeLinea = (l: LineaDePedido): ClaseItem =>
  l.corte ? "corte" : l.terminado ? "terminado" : "producto";

export const ICONO_CLASE: Record<ClaseItem, LucideIcon> = {
  corte: Scissors,
  terminado: Package,
  producto: Boxes,
};

/** Cómo se nombra una línea en la lista: el material del corte, el nombre del terminado o del producto. */
export const nombreDeLinea = (l: LineaDePedido) =>
  l.corte ? materialDeCorte(l.corte) : l.terminado ? l.terminado.nombre : l.nombre;

/** Cuánto es: las piezas de un corte, las unidades de lo demás. */
export function cantidadDeLinea(l: LineaDePedido) {
  if (l.corte) {
    const piezas = totalPiezas(l.corte.piezas);
    return `${piezas} ${piezas === 1 ? "pieza" : "piezas"}`;
  }
  return `${n(l.cantidad)} ${l.cantidad === 1 ? "unidad" : "unidades"}`;
}

/**
 * Un ítem del pedido abierto en grande: lo que el taller tiene que hacer con
 * él. Arriba, sus indicaciones (lo primero que hay que leer); luego el plano
 * del corte o la ficha del terminado; después, los archivos de ese ítem.
 *
 * Las herramientas del pedido entero —anotar planchas o materiales, imprimir
 * la hoja de corte— van en la cabecera, y cómo va la venta en Odoo, al pie.
 */
export function PanelItem({
  pedido: p,
  lineas,
  linea: l,
  odoo,
  sobrantes = [],
  archivos,
  alAnterior,
  alSiguiente,
}: {
  pedido: Pedido;
  /** Todas las líneas: anotar planchas o materiales se hace del pedido entero. */
  lineas: LineaDePedido[];
  linea: LineaDePedido;
  odoo: OdooDePedido | null;
  /** Los sobrantes que el pedido devolvió al almacén (piloto de sobrantes). */
  sobrantes?: Sobrante[];
  /** Los archivos de este ítem. */
  archivos: React.ReactNode;
  alAnterior?: () => void;
  alSiguiente?: () => void;
}) {
  const { permisos } = useStore();
  const [anotando, setAnotando] = useState(false);
  const [anotandoMateriales, setAnotandoMateriales] = useState(false);
  const [pendiente, iniciar] = useTransition();

  const cortes = lineas.filter((x) => x.corte);
  const puedeAnotar = cortes.length > 0 && !odoo?.stockDescontado && !esTerminal(p.estado);
  const terminados = lineas.filter((x) => x.terminado);
  const puedeAnotarMateriales = terminados.length > 0 && !odoo?.stockDescontado && !esTerminal(p.estado);
  // Los productos terminados con piezas calculadas también van en la hoja de corte.
  const conHojaDeCorte = lineas.some((x) => x.corte || x.terminado?.corte);

  const clase = claseDeLinea(l);
  const Icono = ICONO_CLASE[clase];
  const indice = lineas.findIndex((x) => x.posicion === l.posicion);

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
    <section className="bg-card shadow-card rounded-xl border" aria-labelledby="titulo-item">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-3">
        <span className="bg-primary text-primary-foreground tnum grid size-8 shrink-0 place-items-center rounded-lg text-sm font-semibold">
          {l.posicion}
        </span>
        <div className="min-w-0 flex-1">
          <p className="eyebrow flex items-center gap-1.5">
            <Icono className="size-3" aria-hidden />
            {l.corte ? MODALIDADES[l.corte.modalidad] : CLASES_ITEM[clase]}
            <span aria-hidden>·</span>
            <span className="tnum">
              Ítem {indice + 1} de {lineas.length}
            </span>
          </p>
          <h2 id="titulo-item" className="truncate text-base font-semibold tracking-tight">
            {nombreDeLinea(l)}
          </h2>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={alAnterior}
            disabled={!alAnterior}
            aria-label="Ítem anterior"
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={alSiguiente}
            disabled={!alSiguiente}
            aria-label="Ítem siguiente"
          >
            <ChevronRight />
          </Button>
        </div>
      </header>

      {(puedeAnotar || puedeAnotarMateriales || conHojaDeCorte) && (
        <div className="bg-muted/30 flex flex-wrap items-center gap-1.5 border-b px-4 py-2">
          <span className="text-muted-foreground mr-auto text-xs">Del pedido entero</span>
          {puedeAnotar && (
            <Button variant="outline" size="sm" className="bg-card gap-1.5" onClick={() => setAnotando(true)}>
              <Layers className="size-3.5" />
              Planchas usadas
            </Button>
          )}
          {puedeAnotarMateriales && (
            <Button variant="outline" size="sm" className="bg-card gap-1.5" onClick={() => setAnotandoMateriales(true)}>
              <ClipboardList className="size-3.5" />
              Materiales usados
            </Button>
          )}
          {conHojaDeCorte && (
            <Button
              render={<Link href={`/pedidos/${encodeURIComponent(p.codigo)}/hoja-de-corte`} />}
              nativeButton={false}
              variant="outline"
              size="sm"
              className="bg-card gap-1.5"
            >
              <Printer className="size-3.5" />
              Hoja de corte
            </Button>
          )}
        </div>
      )}

      <div className="flex flex-col gap-4 p-4">
        {l.indicaciones && (
          <div className="border-brand/60 bg-brand/[0.06] flex gap-2.5 rounded-r-lg border-l-2 px-3 py-2.5">
            <NotebookPen className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="min-w-0">
              <p className="eyebrow">Indicaciones para el taller</p>
              <p className="mt-0.5 text-sm whitespace-pre-line">{l.indicaciones}</p>
            </div>
          </div>
        )}

        {l.corte ? (
          <>
            <CorteGuardadoVista corte={l.corte} conPrecios={permisos.verMontos} />
            {permisos.verMontos && l.importe !== null && (
              <p className="text-muted-foreground text-right text-sm">
                Importe <span className="tnum text-foreground font-medium">{money(l.importe)}</span>
              </p>
            )}
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
              <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                <Factory className="size-3.5" aria-hidden />
                {l.produccionNombre} · {l.produccionCerrada ? "cerrada en Odoo" : "abierta en Odoo: reserva el material"}
              </p>
            )}
          </>
        ) : (
          <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
            <dl className="grid min-w-0 flex-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              <div>
                <dt className="eyebrow">Cantidad</dt>
                <dd className="tnum mt-0.5 text-lg font-semibold">{n(l.cantidad)}</dd>
              </div>
              {l.codigo && (
                <div>
                  <dt className="eyebrow">Código en Odoo</dt>
                  <dd className="mt-0.5 font-mono text-sm">{l.codigo}</dd>
                </div>
              )}
              {l.descripcion && (
                <div className="sm:col-span-2">
                  <dt className="eyebrow">Descripción</dt>
                  <dd className="mt-0.5 text-sm whitespace-pre-line">{l.descripcion}</dd>
                </div>
              )}
            </dl>
            {permisos.verMontos && l.importe !== null && (
              <div className="text-right">
                <p className="eyebrow">Importe</p>
                <p className="tnum mt-0.5 text-lg font-semibold">{money(l.importe)}</p>
              </div>
            )}
          </div>
        )}

        <div className="border-t pt-4">
          <p className="eyebrow mb-2 flex items-center gap-1.5">
            <Paperclip className="size-3" aria-hidden />
            Archivos de este ítem
          </p>
          {archivos}
        </div>
      </div>

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
