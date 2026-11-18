"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CircleAlert } from "lucide-react";
import * as acciones from "@/app/(app)/almacen/acciones";
import { diaEnLima } from "@/lib/fecha";
import { fechaCompleta } from "@/lib/formato";
import { ESTADOS_CASO, MOTIVOS_BAJA, cambioTexto, type Caso } from "@/lib/casos";
import { Button } from "@/components/ui/button";
import { Campo, Opciones } from "@/components/ui/campo";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cantidad as fmt } from "./comun";

const COLOR: Record<Caso["estado"], string> = {
  pendiente: "bg-st-observado-soft text-st-observado",
  aplicado: "bg-st-listo-soft text-st-listo",
  descartado: "bg-muted text-muted-foreground",
};

/**
 * Los casos de stock: bajas reportadas y diferencias de conteo. Los pendientes
 * primero. Administración los cierra con una razón; Logística los ve.
 */
export function ListaCasos({ casos, cierra }: { casos: Caso[]; cierra: boolean }) {
  const [cerrando, setCerrando] = useState<Caso | null>(null);

  if (casos.length === 0) {
    return (
      <p className="text-muted-foreground rounded-xl border border-dashed px-4 py-8 text-center text-sm">
        No hay casos. Las bajas que se reporten y las diferencias de los conteos aparecen aquí.
      </p>
    );
  }
  const ordenados = [...casos].sort((a, b) => Number(b.estado === "pendiente") - Number(a.estado === "pendiente"));
  return (
    <>
      <ul className="bg-card divide-y rounded-xl border" aria-label="Casos de stock">
        {ordenados.map((c) => (
          <li key={c.id} className="flex flex-col gap-1.5 px-4 py-3" aria-label={c.codigo}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-primary font-mono text-sm font-semibold">{c.codigo}</span>
              <span className="text-sm font-medium">{c.tipo === "baja" ? "Baja" : `Diferencia de conteo ${c.conteo ?? ""}`}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${COLOR[c.estado]}`}>{ESTADOS_CASO[c.estado]}</span>
              <span className="text-muted-foreground text-xs">
                {c.almacen} · {fechaCompleta(diaEnLima(c.reportadoEn))}
                {c.reportadoPor && ` · ${c.reportadoPor}`}
              </span>
              {cierra && c.estado === "pendiente" && (
                <Button size="sm" className="ml-auto" onClick={() => setCerrando(c)} aria-label={`Cerrar ${c.codigo}`}>
                  Cerrar caso
                </Button>
              )}
            </div>
            <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <span className="text-muted-foreground font-mono text-xs">{c.codigoProducto}</span>
              <span>{c.nombre}</span>
              <span className={`tnum font-semibold ${c.cantidad < 0 ? "text-st-observado" : "text-st-entregado"}`}>{cambioTexto(c.cantidad)}</span>
              {c.tipo === "diferencia" && c.esperado !== null && c.contado !== null && (
                <span className="text-muted-foreground text-xs">
                  (contado {fmt(c.contado)}, el sistema decía {fmt(c.esperado)})
                </span>
              )}
              {c.motivo && <span className="text-muted-foreground text-xs">· {MOTIVOS_BAJA[c.motivo]}</span>}
            </p>
            {c.descripcion && <p className="text-xs">{c.descripcion}</p>}
            {c.estado !== "pendiente" && (
              <p className="text-xs">
                <span className="font-medium">Cierre:</span> {c.razon}
                <span className="text-muted-foreground">
                  {" "}
                  · {c.cerradoPor}
                  {c.cerradoEn && ` · ${fechaCompleta(diaEnLima(c.cerradoEn))}`}
                </span>
              </p>
            )}
            {c.estado === "pendiente" && c.error && (
              <p className="text-st-observado flex items-center gap-1 text-xs">
                <CircleAlert className="size-3.5" />
                No se aplicó en Odoo: {c.error}
              </p>
            )}
          </li>
        ))}
      </ul>
      {cerrando && <DialogoCierre caso={cerrando} alCerrar={() => setCerrando(null)} />}
    </>
  );
}

/** Cerrar un caso: aplicarlo en Odoo o descartarlo, siempre con la razón. */
function DialogoCierre({ caso: c, alCerrar }: { caso: Caso; alCerrar: () => void }) {
  const [decision, setDecision] = useState<"aplicar" | "descartar" | null>(null);
  const [razon, setRazon] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  const cerrar = () => {
    if (!decision) return setError("Elige si se aplica o se descarta.");
    if (razon.trim().length < 5) return setError("Escribe la razón (al menos 5 letras).");
    iniciar(async () => {
      const r = await acciones.cerrarCaso({ id: c.id, decision, razon });
      if (!r.ok) return setError(r.error);
      toast.success(`${c.codigo} cerrado`, { description: decision === "aplicar" ? "Ya está en Odoo." : "El stock no cambió." });
      alCerrar();
    });
  };

  const queHace =
    c.cantidad < 0
      ? `Se quita${c.tipo === "baja" ? " (se da de baja)" : ""} ${fmt(Math.abs(c.cantidad))} de ${c.codigoProducto ?? c.nombre} en ${c.almacen}.`
      : `Se suma ${fmt(c.cantidad)} de ${c.codigoProducto ?? c.nombre} en ${c.almacen}.`;

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && alCerrar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cerrar {c.codigo}</DialogTitle>
          <DialogDescription>
            {c.nombre} · {cambioTexto(c.cantidad)} en {c.almacen}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Campo grupo label="Decisión" requerido>
            <Opciones
              valores={decision ? [decision] : []}
              onToggle={(v) => {
                setDecision(v as "aplicar" | "descartar");
                setError(null);
              }}
              opciones={[
                { valor: "aplicar", label: "Aplicar en Odoo" },
                { valor: "descartar", label: "Descartar" },
              ]}
            />
          </Campo>
          {decision && (
            <p className="text-muted-foreground text-xs">{decision === "aplicar" ? queHace : "El stock no cambia (apareció, se contó mal…)."}</p>
          )}
          <Campo label="Razón" requerido ayuda="Qué se averiguó: queda en el caso.">
            <Textarea value={razon} onChange={(e) => setRazon(e.target.value)} maxLength={500} rows={3} />
          </Campo>
          {error && (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" type="button" />}>Cancelar</DialogClose>
          <Button onClick={cerrar} disabled={pendiente}>
            {pendiente ? "Cerrando…" : "Cerrar caso"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
