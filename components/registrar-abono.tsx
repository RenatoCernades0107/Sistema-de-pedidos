"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus } from "lucide-react";
import { useStore } from "@/lib/store";
import { esquemaFormAbono } from "@/lib/esquemas";
import { METODOS, saldoDe, type MetodoPago, type Pedido } from "@/lib/dominio";
import { money } from "@/lib/formato";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

export function RegistrarAbono({ pedido: p }: { pedido: Pedido }) {
  const { registrarAbono, pendiente } = useStore();
  const [abierto, setAbierto] = useState(false);
  const saldo = saldoDe(p);

  /* El tope es el saldo: pagar de más dejaría el saldo en negativo, y en Postgres
     `saldo` es una columna generada con un CHECK que no lo admite. */
  const esquema = esquemaFormAbono(saldo);
  type Campos = z.input<typeof esquema>;

  const form = useForm<Campos>({
    resolver: zodResolver(esquema),
    mode: "onTouched",
    defaultValues: { monto: "" as unknown as number, metodo: "efectivo" },
  });

  const abrir = (v: boolean) => {
    if (v) form.reset({ monto: "" as unknown as number, metodo: "efectivo" });
    setAbierto(v);
  };

  const guardar = form.handleSubmit(async (v) => {
    const resultado = await registrarAbono(p.codigo, Number(v.monto), v.metodo as MetodoPago);
    if (resultado.ok) setAbierto(false);
  });

  const monto = Number(form.watch("monto")) || 0;
  const restante = Math.max(0, saldo - monto);

  return (
    <Dialog open={abierto} onOpenChange={abrir}>
      <DialogTrigger
        render={<Button variant="outline" size="sm" className="w-full gap-1.5" />}
        nativeButton
      >
        <Plus className="size-3.5" />
        Registrar abono
      </DialogTrigger>

      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Registrar abono</DialogTitle>
          <DialogDescription>
            {p.codigo} · {p.cliente}. Saldo pendiente:{" "}
            <span className="text-foreground tnum font-medium">{money(saldo)}</span>.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={guardar} noValidate className="flex flex-col gap-4">
          <Campo
            label="Monto"
            requerido
            error={form.formState.errors.monto?.message}
            ayuda={
              monto > 0 && monto <= saldo
                ? restante > 0
                  ? `Quedaría un saldo de ${money(restante)}.`
                  : "El pedido quedaría pagado."
                : `Entre ${money(0.01)} y ${money(saldo)}.`
            }
          >
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-sm">S/</span>
              <Input
                type="number"
                step="0.01"
                min={0.01}
                max={saldo}
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
                  form.setValue("monto", saldo as unknown as number, {
                    shouldValidate: true,
                  })
                }
              >
                Todo
              </Button>
            </div>
          </Campo>

          <Campo label="Método de pago" requerido>
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
