"use client";

import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { crearClienteOdoo } from "@/app/(app)/cotizaciones/acciones";
import { esquemaNuevoClienteOdoo, type FormNuevoClienteOdoo, type NuevoClienteOdoo } from "@/lib/esquemas";
import { soloDigitos, tipoDeDocumento } from "@/lib/busqueda-inteligente";
import type { ClienteOdoo } from "@/lib/odoo/tipos";
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
} from "@/components/ui/dialog";

/**
 * Lo que se escribió en el buscador decide dónde va: 8 u 11 dígitos son un
 * documento; cualquier otra cosa, el nombre. Así no hay que volver a teclearlo.
 */
export function prellenado(texto: string): FormNuevoClienteOdoo {
  const limpio = texto.trim();
  const esDocumento = tipoDeDocumento(limpio) !== null;
  return {
    nombre: esDocumento ? "" : limpio,
    documento: esDocumento ? soloDigitos(limpio) : "",
    telefono: "",
    email: "",
  };
}

/**
 * El cliente que no aparece se crea aquí mismo, sin salir de la cotización.
 * Se crea en Odoo y vuelve seleccionado. Si su RUC/DNI ya existía, Odoo no
 * duplica: se selecciona el que había y se avisa.
 */
export function CrearCliente({
  abierto,
  alCerrar,
  textoInicial,
  alCrear,
}: {
  abierto: boolean;
  alCerrar: () => void;
  textoInicial: string;
  alCrear: (cliente: ClienteOdoo) => void;
}) {
  return (
    <Dialog open={abierto} onOpenChange={(v) => !v && alCerrar()} triggerId={null}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nuevo cliente</DialogTitle>
          <DialogDescription>
            Se crea en Odoo y queda elegido para esta cotización.
          </DialogDescription>
        </DialogHeader>
        {/* Se monta de nuevo con cada apertura: así el prellenado es el de ahora. */}
        {abierto && <Formulario textoInicial={textoInicial} alCrear={alCrear} />}
      </DialogContent>
    </Dialog>
  );
}

function Formulario({
  textoInicial,
  alCrear,
}: {
  textoInicial: string;
  alCrear: (cliente: ClienteOdoo) => void;
}) {
  const [pendiente, iniciar] = useTransition();
  const valores = prellenado(textoInicial);
  const form = useForm<FormNuevoClienteOdoo, unknown, NuevoClienteOdoo>({
    resolver: zodResolver(esquemaNuevoClienteOdoo),
    mode: "onTouched",
    defaultValues: valores,
  });
  const errores = form.formState.errors;

  const enviar = form.handleSubmit((datos) =>
    iniciar(async () => {
      const r = await crearClienteOdoo(datos);
      if (!r.ok) {
        toast.error("No se pudo crear el cliente", { description: r.error });
        return;
      }
      if (r.existia) {
        toast.info("Ese cliente ya estaba en Odoo", {
          description: `Se eligió ${r.cliente.nombre}, que tiene ese documento.`,
        });
      } else {
        toast.success("Cliente creado en Odoo", { description: r.cliente.nombre });
      }
      alCrear(r.cliente);
    }),
  );

  return (
    <form onSubmit={enviar} noValidate className="flex flex-col gap-4">
      <Campo label="Nombre o razón social" requerido error={errores.nombre?.message}>
        <Input
          autoFocus={!valores.nombre}
          placeholder="Ej. Corporación Andina SAC"
          aria-invalid={!!errores.nombre}
          {...form.register("nombre")}
        />
      </Campo>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo
          label="RUC o DNI"
          ayuda="Opcional. 11 dígitos el RUC, 8 el DNI."
          error={errores.documento?.message}
        >
          <Input
            inputMode="numeric"
            maxLength={11}
            className="tnum"
            // Con el nombre ya puesto desde el buscador, lo que falta es el documento.
            autoFocus={!!valores.nombre}
            aria-invalid={!!errores.documento}
            {...form.register("documento")}
          />
        </Campo>
        <Campo label="Teléfono" error={errores.telefono?.message}>
          <Input inputMode="tel" placeholder="9XX XXX XXX" className="tnum" {...form.register("telefono")} />
        </Campo>
      </div>
      <Campo label="Correo" error={errores.email?.message}>
        <Input type="email" inputMode="email" placeholder="opcional" {...form.register("email")} />
      </Campo>

      <DialogFooter>
        <DialogClose render={<Button variant="outline" type="button" />}>Cancelar</DialogClose>
        <Button type="submit" disabled={pendiente}>
          {pendiente ? "Creando en Odoo…" : "Crear cliente"}
        </Button>
      </DialogFooter>
    </form>
  );
}
