"use client";

/**
 * Lo que ve el cliente al abrir su enlace de seguimiento: en qué va su pedido,
 * cuándo se le prometió, dónde se entrega y qué pidió. Sin precios.
 *
 * "En tiempo real": la página se vuelve a pedir al servidor cada 30 segundos
 * mientras está a la vista, y al volver a la pestaña (`router.refresh()`; el
 * estado de React se conserva y no parpadea). No se abre Supabase Realtime: el
 * cliente no tiene sesión y `anon` no puede leer `pedidos`, a propósito.
 */

import Image from "next/image";
import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, MapPin, Package, RotateCw, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { DIRECCIONES_RECOJO, LUGARES } from "@/lib/dominio";
import { describirLinea, primerNombre } from "@/lib/compartir";
import { fechaCompleta, fechaHora } from "@/lib/formato";
import { momentoEnLima } from "@/lib/fecha";
import { avisoDe, pasosDe, type Seguimiento } from "@/lib/seguimiento";
import { EstadoBadge } from "@/components/estado-badge";
import { Button } from "@/components/ui/button";
import logo from "@/public/logo-plexiacril.webp";

const CADA_MS = 30_000;

const horaLima = new Intl.DateTimeFormat("es-PE", {
  timeZone: "America/Lima",
  hour: "2-digit",
  minute: "2-digit",
});

export function VistaSeguimiento({ seguimiento: s, leidoEn }: { seguimiento: Seguimiento; leidoEn: string }) {
  const router = useRouter();
  const [actualizando, iniciar] = useTransition();

  useEffect(() => {
    const refrescar = () => {
      if (document.visibilityState === "visible") iniciar(() => router.refresh());
    };
    const intervalo = window.setInterval(refrescar, CADA_MS);
    document.addEventListener("visibilitychange", refrescar);
    return () => {
      window.clearInterval(intervalo);
      document.removeEventListener("visibilitychange", refrescar);
    };
  }, [router]);

  const pasos = pasosDe(s);
  const aviso = avisoDe(s.estado);
  const nombre = primerNombre(s.cliente);

  return (
    <main className="bg-muted/30 min-h-dvh">
      <div className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6 sm:py-10">
        <header className="flex items-center justify-between gap-3">
          <div className="dark:rounded-lg dark:bg-white dark:px-2 dark:py-1">
            <Image src={logo} alt="Plexiacril — Acrílicos de calidad" priority className="h-auto w-[140px]" />
          </div>
          <p className="eyebrow">Seguimiento</p>
        </header>

        <section className="bg-card rounded-2xl border p-5 shadow-xs">
          <p className="text-muted-foreground text-sm">{nombre ? `Hola ${nombre}, este es tu pedido` : "Tu pedido"}</p>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-primary text-xl font-semibold tracking-tight tabular-nums">{s.codigo}</h1>
            <EstadoBadge estado={s.estado} />
          </div>

          {aviso && (
            <div
              role="status"
              className={cn(
                "mt-4 flex gap-2.5 rounded-xl border p-3 text-sm",
                s.estado === "anulado"
                  ? "border-st-anulado/25 bg-st-anulado-soft"
                  : "border-st-observado/25 bg-st-observado-soft",
              )}
            >
              <TriangleAlert
                className={cn(
                  "mt-0.5 size-4 shrink-0",
                  s.estado === "anulado" ? "text-st-anulado" : "text-st-observado",
                )}
              />
              <p>
                <span className="font-medium">{aviso.titulo}.</span>{" "}
                <span className="text-muted-foreground">{aviso.texto}</span>
              </p>
            </div>
          )}

          {s.estado !== "anulado" && (
            <ol className="mt-5 flex flex-col" aria-label="Avance del pedido">
              {pasos.map((paso, i) => (
                <li key={paso.estado} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span
                      className={cn(
                        "grid size-7 shrink-0 place-items-center rounded-full border-2 text-xs font-semibold",
                        paso.situacion === "hecho" && "border-primary bg-primary text-primary-foreground",
                        paso.situacion === "actual" && "border-primary text-primary bg-card",
                        paso.situacion === "pendiente" && "text-muted-foreground bg-card border-border",
                      )}
                      aria-hidden
                    >
                      {paso.situacion === "hecho" ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
                    </span>
                    {i < pasos.length - 1 && (
                      <span
                        className={cn(
                          "my-1 w-0.5 flex-1 rounded-full",
                          paso.situacion === "hecho" ? "bg-primary" : "bg-border",
                        )}
                      />
                    )}
                  </div>
                  <div className={cn("min-w-0 pb-5", i === pasos.length - 1 && "pb-0")}>
                    <p
                      className={cn(
                        "text-sm font-medium",
                        paso.situacion === "pendiente" && "text-muted-foreground",
                      )}
                    >
                      {paso.titulo}
                      {paso.situacion === "actual" && <span className="sr-only"> (paso actual)</span>}
                    </p>
                    {paso.situacion !== "pendiente" && (
                      <p className="text-muted-foreground text-xs">{paso.descripcion}</p>
                    )}
                    {paso.fecha && (
                      <p className="text-muted-foreground tnum mt-0.5 text-2xs">
                        {fechaHora(momentoEnLima(paso.fecha))}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="bg-card grid gap-4 rounded-2xl border p-5 text-sm shadow-xs sm:grid-cols-2">
          <div>
            <p className="eyebrow mb-1">{s.estado === "entregado" ? "Entregado el" : "Fecha de entrega"}</p>
            <p className="tnum font-medium">
              {fechaCompleta(s.estado === "entregado" && s.fechaEntrega ? s.fechaEntrega : s.fechaPrometida)}
            </p>
          </div>
          <div>
            <p className="eyebrow mb-1">Entrega</p>
            <p className="flex items-start gap-1.5 font-medium">
              <MapPin className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
              <span>
                {LUGARES[s.lugarEntrega]}
                {DIRECCIONES_RECOJO[s.lugarEntrega] ? (
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                      `${DIRECCIONES_RECOJO[s.lugarEntrega]}, Lima, Perú`,
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-foreground block font-normal underline-offset-2 hover:underline"
                    data-testid="direccion-recojo"
                  >
                    {DIRECCIONES_RECOJO[s.lugarEntrega]}
                  </a>
                ) : (
                  s.direccion && <span className="text-muted-foreground block font-normal">{s.direccion}</span>
                )}
                {s.esProvincia && (s.agencia || s.destino) && (
                  <span className="text-muted-foreground block font-normal">
                    {[s.agencia, s.destino].filter(Boolean).join(" · ")}
                  </span>
                )}
              </span>
            </p>
          </div>
        </section>

        <section className="bg-card overflow-hidden rounded-2xl border shadow-xs">
          <p className="eyebrow flex items-center gap-1.5 border-b px-5 py-3">
            <Package className="size-3.5" />
            Lo que pediste
          </p>
          {s.lineas.length ? (
            <ul className="divide-y">
              {s.lineas.map((l) => {
                const { titulo, detalle, cantidad } = describirLinea(l);
                return (
                  <li key={l.posicion} className="flex items-start gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{titulo}</p>
                      {detalle && <p className="text-muted-foreground mt-0.5 text-xs">{detalle}</p>}
                    </div>
                    <p className="tnum text-muted-foreground shrink-0 text-sm">{cantidad}</p>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-5 py-3 text-sm whitespace-pre-line">{s.detalle || "—"}</p>
          )}
        </section>

        <footer className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 px-1 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="relative flex size-2">
              <span className="bg-st-entregado absolute inline-flex size-full animate-ping rounded-full opacity-60" />
              <span className="bg-st-entregado relative inline-flex size-2 rounded-full" />
            </span>
            Actualizado a las {horaLima.format(new Date(leidoEn))} · se actualiza solo
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            disabled={actualizando}
            onClick={() => iniciar(() => router.refresh())}
          >
            <RotateCw className={cn("size-3.5", actualizando && "animate-spin")} />
            Actualizar
          </Button>
        </footer>
        <p className="text-muted-foreground text-center text-2xs">© Plexiacril · Acrílicos de calidad</p>
      </div>
    </main>
  );
}
