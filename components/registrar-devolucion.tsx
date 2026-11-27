"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Undo2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { esquemaFormDevolucion } from "@/lib/esquemas";
import { METODOS, type MetodoPago, type Pedido } from "@/lib/dominio";
import { money } from "@/lib/formato";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Campo } from "@/components/ui/campo";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Registra plata que se le devolvió al cliente. Solo deja constancia: no emite nota
 * de crédito ni toca Odoo. El monto resta de lo cobrado, así que el saldo del pedido
 * sube en la misma cantidad.
 */
export function RegistrarDevolucion({ pedido: p }: { pedido: Pedido }) {
  const { registrarDevolucion, pendiente } = useStore();
  const [abierto, setAbierto] = useState(false);

  /* El tope es lo cobrado: devolver de más dejaría `monto_pagado` en negativo, y la
     base lo rechaza. */
  const cobrado = p.montoPagado;
  const esquema = esquemaFormDevolucion(cobrado);
  type Campos = z.input<typeof esquema>;

  const inicial = { monto: "" as unknown as number, metodo: "efectivo" as MetodoPago, motivo: "" };
  const form = useForm<Campos>({
    resolver: zodResolver(esquema),
    mode: "onTouched",
    defaultValues: inicial,
  });

  const abrir = (v: boolean) => {
    if (v) form.reset(inicial);
    setAbierto(v);
  };

  const guardar = form.handleSubmit(async (v) => {
    const resultado = await registrarDevolucion(
      p.codigo,
      Number(v.monto),
      v.metodo as MetodoPago,
      v.motivo.trim(),
    );
    if (resultado.ok) setAbierto(false);
  });

  const monto = Number(form.watch("monto")) || 0;

  return (
    <Dialog open={abierto} onOpenChange={abrir}>
      <DialogTrigger
        render={<Button variant="outline" size="sm" className="w-full gap-1.5" />}
        nativeButton
      >
        <Undo2 className="size-3.5" />
        Registrar devolución
      </DialogTrigger>

      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Registrar devolución</DialogTitle>
          <DialogDescription>
            {p.codigo} · {p.cliente}. Cobrado hasta ahora:{" "}
            <span className="text-foreground tnum font-medium">{money(cobrado)}</span>. Solo deja
            constancia de la plata devuelta; no emite nota de crédito.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={guardar} noValidate className="flex flex-col gap-4">
          <Campo
            label="Monto devuelto"
            requerido
            error={form.formState.errors.monto?.message}
            ayuda={
              monto > 0 && monto <= cobrado
                ? `El saldo del pedido subiría a ${money(p.montoTotal - (cobrado - monto))}.`
                : `Entre ${money(0.01)} y ${money(cobrado)}.`
            }
          >
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-sm">S/</span>
              <Input
                type="number"
                step="0.01"
                min={0.01}
                max={cobrado}
                autoFocus
                inputMode="decimal"
                placeholder="0.00"
                className="tnum"
                aria-invalid={!!form.formState.errors.monto}
                {...form.register("monto")}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0"
                onClick={() =>
                  form.setValue("monto", cobrado as unknown as number, { shouldValidate: true })
                }
              >
                Todo
              </Button>
            </div>
          </Campo>

          <Campo label="Cómo se devolvió" requerido>
            <Select
              value={form.watch("metodo")}
              onValueChange={(v) => v && form.setValue("metodo", v as MetodoPago)}
            >
              <SelectTrigger className="w-full">
                <SelectValue>{METODOS[form.watch("metodo") as MetodoPago]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(METODOS) as MetodoPago[]).map((m) => (
                  <SelectItem key={m} value={m}>
                    {METODOS[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>

          <Campo label="Motivo" requerido error={form.formState.errors.motivo?.message}>
            <Textarea
              rows={3}
              maxLength={300}
              placeholder="Ej.: el cliente anuló el pedido antes del corte"
              aria-invalid={!!form.formState.errors.motivo}
              {...form.register("motivo")}
            />
          </Campo>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />} nativeButton>
              Cancelar
            </DialogClose>
            <Button type="submit" disabled={pendiente}>
              {pendiente ? "Registrando…" : "Registrar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
