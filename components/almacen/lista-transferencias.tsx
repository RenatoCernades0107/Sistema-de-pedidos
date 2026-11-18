"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { ArrowRight, CircleAlert, PackageCheck, RotateCw, X } from "lucide-react";
import * as acciones from "@/app/(app)/almacen/acciones";
import { diaEnLima } from "@/lib/fecha";
import { fechaCompleta } from "@/lib/formato";
import { ESTADOS_TRANSFERENCIA, type TransferenciaResumen } from "@/lib/inventario";
import { Button } from "@/components/ui/button";

const COLOR_ESTADO: Record<TransferenciaResumen["estado"], string> = {
  enviada: "bg-st-en_transito-soft text-st-en_transito",
  recibida: "bg-st-listo-soft text-st-listo",
  anulada: "bg-muted text-muted-foreground",
};

/**
 * Las transferencias: las que están en camino primero. Recibir lo puede hacer
 * cualquiera que vea el almacén (el taller recibe lo que le llega); reintentar y
 * anular, quien gestiona el stock.
 */
export function ListaTransferencias({
  transferencias,
  gestiona,
}: {
  transferencias: TransferenciaResumen[];
  gestiona: boolean;
}) {
  const [pendiente, iniciar] = useTransition();

  const hacer = (t: TransferenciaResumen, que: "recibir" | "reintentar" | "anular") =>
    iniciar(async () => {
      const r =
        que === "recibir"
          ? await acciones.recibirTransferencia(t.id)
          : que === "reintentar"
            ? await acciones.reintentarTransferencia(t.id)
            : await acciones.anularTransferencia(t.id);
      if (!r.ok) {
        toast.error(que === "recibir" ? "No se recibió" : que === "anular" ? "No se anuló" : "Odoo no la registró", {
          description: r.error,
        });
        return;
      }
      toast.success(
        que === "recibir" ? `${t.codigo} recibida` : que === "anular" ? `${t.codigo} anulada` : `${t.codigo} ya salió en Odoo`,
        que === "recibir" ? { description: `Ya está en ${t.hacia}.` } : undefined,
      );
    });

  if (transferencias.length === 0) {
    return (
      <p className="text-muted-foreground rounded-xl border border-dashed px-4 py-6 text-center text-sm">
        Todavía no hay transferencias. Lo que pases de un almacén a otro aparece aquí.
      </p>
    );
  }

  const ordenadas = [...transferencias].sort((a, b) => Number(b.estado === "enviada") - Number(a.estado === "enviada"));
  return (
    <ul className="bg-card divide-y rounded-xl border" aria-label="Transferencias">
      {ordenadas.map((t) => (
        <li key={t.id} className="flex flex-col gap-2 px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-primary font-mono text-sm font-semibold">{t.codigo}</span>
            <span className="flex items-center gap-1.5 text-sm font-medium">
              {t.desde}
              <ArrowRight className="text-muted-foreground size-3.5" />
              {t.hacia}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${COLOR_ESTADO[t.estado]}`}>
              {ESTADOS_TRANSFERENCIA[t.estado]}
            </span>
            <span className="text-muted-foreground text-xs">
              {t.pedidoCodigo && `Pedido ${t.pedidoCodigo} · `}
              Enviada {fechaCompleta(diaEnLima(t.enviadoEn))}
              {t.enviadoPor && ` por ${t.enviadoPor}`}
              {t.recibidoEn && ` · recibida ${fechaCompleta(diaEnLima(t.recibidoEn))}`}
              {t.recibidoPor && ` por ${t.recibidoPor}`}
            </span>
            {t.estado === "enviada" && (
              <div className="ml-auto flex gap-2">
                {gestiona && !t.salioEnOdoo && (
                  <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => hacer(t, "anular")} disabled={pendiente}>
                    <X className="size-3.5" />
                    Anular
                  </Button>
                )}
                <Button size="sm" className="gap-1.5" onClick={() => hacer(t, "recibir")} disabled={pendiente} aria-label={`Recibir ${t.codigo}`}>
                  <PackageCheck className="size-3.5" />
                  Recibir
                </Button>
              </div>
            )}
          </div>
          <ul className="text-muted-foreground flex flex-col gap-0.5 text-xs">
            {t.lineas.map((l, n) => (
              <li key={n} className="flex flex-wrap gap-x-2">
                <span className="font-mono">{l.codigo}</span>
                <span className="text-foreground">{l.sobrante ? "Sobrante" : l.nombre}</span>
                {!l.sobrante && <span className="tnum">× {l.cantidad}</span>}
              </li>
            ))}
          </ul>
          {t.nota && <p className="text-xs">{t.nota}</p>}
          {t.estado === "enviada" && t.sincronizacion === "error" && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-st-observado flex items-center gap-1 text-xs">
                <CircleAlert className="size-3.5" />
                {t.error ?? "Odoo no la registró"}
              </span>
              {gestiona && !t.salioEnOdoo && (
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => hacer(t, "reintentar")} disabled={pendiente}>
                  <RotateCw className="size-3.5" />
                  Reintentar
                </Button>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
