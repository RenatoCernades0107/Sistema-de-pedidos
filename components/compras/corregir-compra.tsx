"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import * as acciones from "@/app/(app)/compras/acciones";
import { CONDICIONES_PAGO, TIPOS_COMPRA, condicionesDe, type CompraDetalle, type CondicionPago } from "@/lib/compras";
import type { Incoterm, TipoCompra } from "@/lib/costeo";
import { Button } from "@/components/ui/button";
import { Campo, Opciones } from "@/components/ui/campo";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

const aTexto = (n: number | null) => (n === null ? "" : String(n));

/** "244,5" o "244.5" → 244.5; vacío → null; basura → NaN. */
const aNumero = (t: string): number | null => {
  const s = t.trim().replace(",", ".");
  return s === "" ? null : Number(s);
};

/**
 * Corregir una compra ya confirmada sin tocar Odoo: su tipo (nacional o importación,
 * con el incoterm, el pago y el embarque que dependen de él) y los kilos de cada
 * ítem. Una compra traída de Odoo llega con el tipo deducido de la moneda y sin kilos.
 */
export function CorregirCompra({ compra }: { compra: CompraDetalle }) {
  const [abierto, setAbierto] = useState(false);
  const [tipo, setTipo] = useState<TipoCompra>(compra.tipo);
  const [incoterm, setIncoterm] = useState<Incoterm | null>(compra.incoterm);
  const [condicion, setCondicion] = useState<CondicionPago>(compra.condicionPago);
  const [dias, setDias] = useState(aTexto(compra.diasCredito));
  const [embarque, setEmbarque] = useState(compra.fechaEmbarque ?? "");
  const [kilos, setKilos] = useState(() => compra.lineas.map((l) => aTexto(l.kilos)));
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  const abrir = () => {
    setTipo(compra.tipo);
    setIncoterm(compra.incoterm);
    setCondicion(compra.condicionPago);
    setDias(aTexto(compra.diasCredito));
    setEmbarque(compra.fechaEmbarque ?? "");
    setKilos(compra.lineas.map((l) => aTexto(l.kilos)));
    setError(null);
    setAbierto(true);
  };

  const cambiarTipo = (t: TipoCompra) => {
    setTipo(t);
    setIncoterm(t === "importacion" ? (incoterm ?? "FOB") : null);
    if (!condicionesDe(t).includes(condicion)) setCondicion(t === "importacion" ? "adelantado" : "contado");
    setError(null);
  };

  const guardar = () => {
    const k = kilos.map(aNumero);
    if (k.some((x) => x !== null && !Number.isFinite(x))) return setError("Los kilos son un número.");
    const d = aNumero(dias);
    if (d !== null && !Number.isFinite(d)) return setError("Los días de crédito son un número.");
    iniciar(async () => {
      const r = await acciones.corregirCompra({
        compraId: compra.id,
        tipo,
        incoterm: tipo === "importacion" ? incoterm : null,
        condicionPago: condicion,
        diasCredito: condicion === "credito" ? d : null,
        fechaEmbarque: tipo === "importacion" ? embarque || null : null,
        kilos: compra.lineas.map((l, i) => ({ posicion: l.posicion, kilos: k[i] })),
      });
      if (!r.ok) return setError(r.error);
      setAbierto(false);
      toast.success("Compra corregida");
    });
  };

  return (
    <>
      <Button variant="outline" className="gap-1.5" onClick={abrir} disabled={pendiente}>
        <Pencil className="size-4" />
        Corregir
      </Button>

      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Corregir la compra</DialogTitle>
            <DialogDescription>
              Tipo, pago y kilos por ítem. No cambia la orden en Odoo ni lo ya recibido. Si cambias el tipo, los gastos
              cargados tienen que seguir siendo válidos.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <Campo grupo label="Tipo de compra">
              <Opciones
                valores={[tipo]}
                onToggle={(v) => cambiarTipo(v as TipoCompra)}
                opciones={Object.entries(TIPOS_COMPRA).map(([valor, label]) => ({ valor, label }))}
              />
            </Campo>
            {tipo === "importacion" && (
              <Campo grupo label="Incoterm">
                <Opciones
                  valores={incoterm ? [incoterm] : []}
                  onToggle={(v) => setIncoterm(v as Incoterm)}
                  opciones={[{ valor: "FOB", label: "FOB" }, { valor: "CIF", label: "CIF" }]}
                />
              </Campo>
            )}
            <Campo grupo label="Pago">
              <Opciones
                valores={[condicion]}
                onToggle={(v) => setCondicion(v as CondicionPago)}
                opciones={condicionesDe(tipo).map((c) => ({ valor: c, label: CONDICIONES_PAGO[c] }))}
              />
            </Campo>
            <div className="grid gap-3 sm:grid-cols-2">
              {condicion === "credito" && (
                <Campo label="Días de crédito" requerido ayuda={tipo === "importacion" ? "Desde el embarque" : "Desde la confirmación"}>
                  <Input inputMode="numeric" value={dias} onChange={(e) => setDias(e.target.value)} placeholder="90" className="tnum" />
                </Campo>
              )}
              {tipo === "importacion" && (
                <Campo label="Embarque">
                  <Input type="date" value={embarque} onChange={(e) => setEmbarque(e.target.value)} />
                </Campo>
              )}
            </div>

            <div>
              <p className="mb-1.5 text-sm font-medium">Kilos por ítem</p>
              <p className="text-muted-foreground mb-2 text-xs">Del ítem completo, como vienen en el PDF del proveedor. Hacen falta para repartir gastos por kilos.</p>
              <ul className="divide-y rounded-lg border text-sm">
                {compra.lineas.map((l, i) => (
                  <li key={l.posicion} className="flex items-center gap-3 px-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{l.codigo ?? l.nombre}</span>
                      <span className="text-muted-foreground block truncate text-xs">
                        {l.cantidad} {l.cantidad === 1 ? "plancha" : "planchas"}
                      </span>
                    </span>
                    <Input
                      inputMode="decimal"
                      aria-label={`Kilos de ${l.codigo ?? l.nombre}`}
                      value={kilos[i]}
                      onChange={(e) => setKilos((ks) => ks.map((x, j) => (j === i ? e.target.value : x)))}
                      placeholder="kg"
                      className="tnum w-28 text-right"
                    />
                  </li>
                ))}
              </ul>
            </div>

            {error && <p className="text-destructive text-sm">{error}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAbierto(false)} disabled={pendiente}>
              Cancelar
            </Button>
            <Button onClick={guardar} disabled={pendiente}>
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
