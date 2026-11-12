"use client";

import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";
import { useStore } from "@/lib/store";
import { LUGARES, UBICACIONES } from "@/lib/dominio";
import { fechaCompleta } from "@/lib/formato";
import { hoy } from "@/lib/fecha";
import { MODALIDADES } from "@/lib/cortes/calcular";
import { fraccionEnPalabras, materialDeCorte, totalPiezas } from "@/lib/cortes/guardado";
import { materialDeTerminado, tituloTerminado } from "@/lib/terminados/guardado";
import { indicacionesDe, origenDePlancha, piezasDePlancha } from "@/lib/hoja-corte";
import { planchasCalculadas, type LineaDePedido } from "@/lib/pedido-lineas";
import { LeyendaPlano, PlanoCorte } from "@/components/cortes/plano-corte";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const n = (x: number) => String(+x.toFixed(2));

/** Una casilla para marcar a mano, en el papel. En pantalla es solo dibujo. */
const Casilla = ({ className }: { className?: string }) => (
  <span className={cn("border-foreground/60 inline-block size-4 shrink-0 rounded-[3px] border", className)} aria-hidden />
);

/**
 * La hoja de corte del pedido: lo que el taller se lleva a la mesa.
 *
 * Una por pedido, con todos sus cortes: cada plancha a escala con sus piezas
 * numeradas por medida, de dónde sale (plancha nueva o sobrante), qué pedazo se
 * corta primero cuando se cobra una fracción, y casillas para ir marcando. Al
 * final, lo demás que lleva el pedido y un hueco para anotar las planchas que de
 * verdad se usaron. Nunca lleva precios, la imprima quien la imprima.
 *
 * Se imprime sin el cromo de la app (`print:hidden` en `AppShell`) y siempre en
 * claro: el tema oscuro solo existe en pantalla (`globals.css`).
 */
export function HojaCorte({ codigo, lineas }: { codigo: string; lineas: LineaDePedido[] }) {
  const { pedido } = useStore();
  const p = pedido(codigo);

  if (!p) {
    return (
      <div className="grid min-h-[60vh] place-items-center p-6 text-center">
        <div>
          <h1 className="text-lg font-semibold">No existe el pedido {codigo}</h1>
          <Button render={<Link href="/pedidos" />} nativeButton={false} variant="outline" className="mt-4">
            Volver a la lista
          </Button>
        </div>
      </div>
    );
  }

  // Un producto terminado con sus piezas calculadas también se corta aquí.
  const seCorta = (l: LineaDePedido) => !!(l.corte || l.terminado?.corte);
  const cortes = lineas.filter(seCorta);
  const otros = lineas.filter((l) => !seCorta(l));
  const indicaciones = indicacionesDe(p.detalle, lineas);

  return (
    <div className="mx-auto max-w-4xl px-4 py-5 [print-color-adjust:exact] md:px-6 md:py-6 print:max-w-none print:p-0">
      <div className="mb-4 flex items-center gap-2 print:hidden">
        <Button
          render={<Link href={`/pedidos/${encodeURIComponent(codigo)}`} />}
          nativeButton={false}
          variant="ghost"
          size="sm"
          className="text-muted-foreground -ml-2 gap-1.5"
        >
          <ArrowLeft className="size-3.5" />
          Volver al pedido
        </Button>
        <Button onClick={() => window.print()} size="sm" className="ml-auto gap-1.5" disabled={cortes.length === 0}>
          <Printer className="size-3.5" />
          Imprimir
        </Button>
      </div>

      <article className="bg-card rounded-xl border p-5 sm:p-6 print:rounded-none print:border-0 print:p-0">
        <header className="flex flex-col gap-4 border-b pb-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="eyebrow w-full">Hoja de corte</p>
            <h1 className="text-primary text-2xl font-semibold tracking-tight tabular-nums">{p.codigo}</h1>
            <p className="text-lg font-medium">{p.cliente}</p>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
            <Dato etiqueta="Fecha prometida">
              <span className="tnum">{fechaCompleta(p.fechaPrometida)}</span>
            </Dato>
            <Dato etiqueta="Responsable">{p.responsable ?? "Sin asignar"}</Dato>
            <Dato etiqueta="Ubicación">{UBICACIONES[p.ubicacion]}</Dato>
            <Dato etiqueta="Entrega">{p.esProvincia ? "Provincia" : LUGARES[p.entrega]}</Dato>
          </dl>
          {(indicaciones || p.observaciones) && (
            <div className="bg-muted/40 flex flex-col gap-2 rounded-lg border px-3 py-2.5 text-sm">
              {indicaciones && (
                <p className="whitespace-pre-line">
                  <span className="font-medium">Indicaciones: </span>
                  {indicaciones}
                </p>
              )}
              {p.observaciones && (
                <p className="whitespace-pre-line">
                  <span className="font-medium">Observaciones: </span>
                  {p.observaciones}
                </p>
              )}
            </div>
          )}
        </header>

        {cortes.length === 0 ? (
          <p className="text-muted-foreground py-8 text-center text-sm">Este pedido no tiene cortes.</p>
        ) : (
          cortes.map((l, i) => <Corte key={l.posicion} linea={l} numero={i + 1} de={cortes.length} />)
        )}

        {otros.length > 0 && (
          <section className="mt-6 break-inside-avoid border-t pt-4" aria-labelledby="hoja-otros">
            <h2 id="hoja-otros" className="text-sm font-semibold">
              Además, el pedido lleva
            </h2>
            <ul className="mt-2 flex flex-col gap-1.5 text-sm">
              {otros.map((l) => (
                <li key={l.posicion} className="flex items-start gap-2">
                  <Casilla className="mt-0.5" />
                  <span>
                    <span className="tnum font-medium">{n(l.cantidad)} ×</span> {l.nombre}
                    {l.codigo && <span className="text-muted-foreground ml-1.5 font-mono text-xs">{l.codigo}</span>}
                    {l.descripcion && (
                      <span className="text-muted-foreground block text-xs whitespace-pre-line">{l.descripcion}</span>
                    )}
                    {l.indicaciones && (
                      <span className="block text-xs whitespace-pre-line">
                        <span className="font-medium">Indicaciones: </span>
                        {l.indicaciones}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <footer className="text-muted-foreground mt-6 border-t pt-3 text-xs">
          {p.codigo} · impresa el <span className="tnum">{fechaCompleta(hoy())}</span>
        </footer>
      </article>
    </div>
  );
}

/** Lo que la hoja necesita de un corte, venga de una línea de corte o de un producto terminado. */
function vistaDe(l: LineaDePedido) {
  if (l.corte) {
    const c = l.corte;
    return {
      titulo: `${MODALIDADES[c.modalidad]} · ${materialDeCorte(c)}`,
      unidades: null as string | null,
      piezas: c.piezas.map((p) => ({ ...p, nombre: null as string | null })),
      formato: c.formato,
      planchas: c.planchas,
      rotable: c.rotable,
      esCorte: true,
    };
  }
  const t = l.terminado!;
  const c = t.corte!;
  return {
    titulo: `Producto terminado · ${tituloTerminado(t)}${t.material ? ` · ${materialDeTerminado(t.material)}` : ""}`,
    unidades: `${n(l.cantidad)} ${l.cantidad === 1 ? "unidad" : "unidades"}`,
    piezas: c.piezas.map((p) => ({ ...p, nombre: p.nombre as string | null })),
    formato: c.formato,
    planchas: c.planchas,
    rotable: c.rotable,
    esCorte: false,
  };
}

function Corte({ linea: l, numero, de }: { linea: LineaDePedido; numero: number; de: number }) {
  const c = vistaDe(l);
  const piezas = totalPiezas(c.piezas);
  const hayFraccion = c.planchas.some((p) => p.cobro.factor < 1);
  const conNombre = c.piezas.some((p) => p.nombre);

  return (
    <section className="mt-6 flex flex-col gap-4" aria-labelledby={`hoja-corte-${l.posicion}`}>
      <div className="break-inside-avoid">
        <h2 id={`hoja-corte-${l.posicion}`} className="text-base font-semibold">
          {de > 1 && <span className="text-muted-foreground font-normal">Corte {numero} de {de} · </span>}
          {c.titulo}
        </h2>
        <p className="text-muted-foreground mt-0.5 text-sm">
          {c.unidades && `${c.unidades}: `}
          {piezas} {piezas === 1 ? "pieza" : "piezas"} en {c.planchas.length}{" "}
          {c.planchas.length === 1 ? "plancha" : "planchas"} de {n(c.formato.ancho)}×{n(c.formato.alto)} cm{" "}
          <span className="font-mono">{c.formato.codigo}</span>
          {!c.rotable && " · no girar las piezas: el material tiene veta o dibujo"}
        </p>
        {l.indicaciones && (
          <p className="mt-1.5 text-sm whitespace-pre-line">
            <span className="font-medium">Indicaciones: </span>
            {l.indicaciones}
          </p>
        )}

        <table className="mt-3 w-full max-w-md text-sm">
          <caption className="sr-only">Piezas del corte</caption>
          <thead>
            <tr className="border-b">
              <th className="eyebrow py-1.5 pr-3 text-left">N.º</th>
              {conNombre && <th className="eyebrow py-1.5 pr-3 text-left">Pieza</th>}
              <th className="eyebrow py-1.5 pr-3 text-left">Medida</th>
              <th className="eyebrow py-1.5 pr-3 text-right">Cantidad</th>
              <th className="eyebrow py-1.5 text-center">Hecho</th>
            </tr>
          </thead>
          <tbody>
            {c.piezas.map((p, i) => (
              <tr key={i} className="border-b last:border-0">
                <td className="py-1.5 pr-3">
                  <span className="bg-primary/15 tnum inline-grid size-5 place-items-center rounded-md text-xs font-semibold">
                    {i + 1}
                  </span>
                </td>
                {conNombre && <td className="py-1.5 pr-3">{p.nombre}</td>}
                <td className="tnum py-1.5 pr-3">
                  {n(p.ancho)} × {n(p.alto)} cm
                </td>
                <td className="tnum py-1.5 pr-3 text-right">{Math.floor(p.cantidad)}</td>
                <td className="py-1.5 text-center">
                  <Casilla />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 print:grid-cols-1">
        {c.planchas.map((p, i) => (
          <figure
            key={i}
            // En papel, al 85 %: así entran dos planchas por hoja A4 sin achicar los números.
            className="flex break-inside-avoid flex-col gap-1.5 print:mx-auto print:w-[85%]"
          >
            <figcaption className="flex items-start gap-2 text-sm">
              <Casilla className="mt-0.5" />
              <span className="min-w-0">
                <span className="font-medium">
                  Plancha {i + 1} de {c.planchas.length}
                </span>{" "}
                <span className="text-muted-foreground">· {origenDePlancha(p, c.formato)}</span>
                <span className="text-muted-foreground block text-xs">
                  {piezasDePlancha(p)
                    .map((x) => `${x.cantidad} × N.º ${x.fila}`)
                    .join(", ")}
                  {p.cobro.factor < 1 &&
                    ` · cortar primero ${fraccionEnPalabras(p.cobro.nombre)} (${n(p.cobro.ancho)}×${n(p.cobro.alto)}): el resto vuelve al almacén`}
                </span>
              </span>
            </figcaption>
            <PlanoCorte
              plancha={p}
              titulo={`Plancha ${i + 1} de ${c.planchas.length}: ${p.piezas} piezas en ${n(p.ancho)}×${n(p.alto)} cm`}
            />
          </figure>
        ))}
      </div>

      <div className="flex break-inside-avoid flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <LeyendaPlano conSobrante={hayFraccion} />
        {c.esCorte && (
          <p className="text-sm">
            Planchas usadas:{" "}
            {l.planchasUsadas !== null ? (
              <span className="tnum font-semibold">{n(l.planchasUsadas)}</span>
            ) : (
              <span className="border-foreground/60 inline-block w-16 border-b" aria-hidden>
                &nbsp;
              </span>
            )}{" "}
            <span className="text-muted-foreground">(calculadas: {n(planchasCalculadas(l))})</span>
          </p>
        )}
      </div>
    </section>
  );
}

function Dato({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="eyebrow">{etiqueta}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
