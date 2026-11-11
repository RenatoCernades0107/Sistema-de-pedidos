"use client";

import { useState } from "react";
import { Layers } from "lucide-react";
import { materialDeCorte } from "@/lib/cortes/guardado";
import { MODALIDADES } from "@/lib/cortes/calcular";
import { PLANCHAS_MAXIMAS, hastaDosDecimales, planchasDe, type LineaDePedido } from "@/lib/pedido-lineas";
import type { Resultado } from "@/app/(app)/acciones";
import { Button } from "@/components/ui/button";
import { Campo } from "@/components/ui/campo";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type PlanchasAnotadas = { posicion: number; planchas: number }[];

const n = (x: number) => String(+x.toFixed(2));

/** Lo escrito, si es una cantidad de planchas válida. */
function leer(texto: string): number | string {
  const limpio = texto.trim().replace(",", ".");
  if (!limpio) return "Escribe cuántas planchas se usaron";
  const v = Number(limpio);
  if (!Number.isFinite(v)) return "Escribe un número";
  if (v < 0) return "No pueden ser menos de cero";
  if (v > PLANCHAS_MAXIMAS) return "Son demasiadas planchas";
  if (!hastaDosDecimales(v)) return "Hasta dos decimales";
  return v;
}

/**
 * Cuántas planchas se usaron de verdad en cada corte. Es lo que se descuenta del
 * stock en Odoo: llega puesto con lo anotado o, si nadie anotó, con lo
 * calculado, y solo se corrige si se usó otra cantidad.
 *
 * Lo abre el botón "Listo" (`alPasarAListo`), que mueve el pedido y descuenta, y
 * el detalle del pedido, que solo anota.
 */
export function DialogoPlanchas({
  abierto,
  alCambiar,
  cortes,
  alPasarAListo,
  pendiente,
  alConfirmar,
}: {
  abierto: boolean;
  alCambiar: (abierto: boolean) => void;
  cortes: LineaDePedido[];
  alPasarAListo?: boolean;
  pendiente: boolean;
  alConfirmar: (planchas: PlanchasAnotadas) => Promise<Resultado>;
}) {
  return (
    <Dialog open={abierto} onOpenChange={alCambiar} triggerId={null}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{alPasarAListo ? "Pasar a Listo" : "Planchas usadas"}</DialogTitle>
          <DialogDescription>
            {alPasarAListo
              ? "Al pasar a Listo, estas planchas se descuentan del stock en Odoo. Corrige la cantidad si usaste otra."
              : "Lo que se descontará del stock en Odoo cuando el pedido pase a Listo."}
          </DialogDescription>
        </DialogHeader>
        {/* Se monta al abrir: así cada vez llega con lo último anotado. */}
        {abierto && (
          <Formulario
            cortes={cortes}
            alPasarAListo={alPasarAListo}
            pendiente={pendiente}
            alConfirmar={async (planchas) => {
              const r = await alConfirmar(planchas);
              if (r.ok) alCambiar(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Formulario({
  cortes,
  alPasarAListo,
  pendiente,
  alConfirmar,
}: {
  cortes: LineaDePedido[];
  alPasarAListo?: boolean;
  pendiente: boolean;
  alConfirmar: (planchas: PlanchasAnotadas) => Promise<void>;
}) {
  const [valores, setValores] = useState(() => cortes.map((l) => n(planchasDe(l))));
  const [errores, setErrores] = useState<(string | null)[]>(() => cortes.map(() => null));

  const enviar = (e: React.FormEvent) => {
    e.preventDefault();
    const leidos = valores.map(leer);
    const nuevos = leidos.map((v) => (typeof v === "string" ? v : null));
    setErrores(nuevos);
    if (nuevos.some(Boolean)) return;
    void alConfirmar(cortes.map((l, i) => ({ posicion: l.posicion, planchas: leidos[i] as number })));
  };

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4" noValidate>
      <ul className="flex flex-col gap-3">
        {cortes.map((l, i) => {
          const c = l.corte!;
          return (
            <li key={l.posicion} className="flex items-start gap-3 rounded-lg border p-3">
              <Layers className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {MODALIDADES[c.modalidad]} · {materialDeCorte(c)}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    Plancha de {n(c.formato.ancho)}×{n(c.formato.alto)}{" "}
                    <span className="font-mono">{c.formato.codigo}</span> · calculadas: {n(l.cantidad)}
                  </p>
                </div>
                <Campo
                  label={`Planchas usadas (${c.formato.codigo})`}
                  error={errores[i] ?? undefined}
                  claseEtiqueta="sr-only"
                >
                  <Input
                    inputMode="decimal"
                    autoFocus={i === 0}
                    className="tnum w-28"
                    value={valores[i]}
                    aria-invalid={!!errores[i]}
                    onChange={(e) => {
                      const v = e.target.value;
                      setValores((prev) => prev.map((x, j) => (j === i ? v : x)));
                      setErrores((prev) => prev.map((x, j) => (j === i ? null : x)));
                    }}
                  />
                </Campo>
              </div>
            </li>
          );
        })}
      </ul>

      <DialogFooter>
        <DialogClose render={<Button variant="outline" type="button" />}>Cancelar</DialogClose>
        <Button type="submit" disabled={pendiente}>
          {pendiente ? "Guardando…" : alPasarAListo ? "Pasar a Listo" : "Guardar"}
        </Button>
      </DialogFooter>
    </form>
  );
}
