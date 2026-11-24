"use client";

import { useEffect, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Phone, UserPlus, UserRound } from "lucide-react";
import { toast } from "sonner";
import { agregarContactoOdoo, contactosDeCliente } from "@/app/(app)/cotizaciones/acciones";
import { esquemaNuevoContacto, type FormNuevoContacto } from "@/lib/esquemas";
import type { ClienteOdoo, ContactoOdoo } from "@/lib/odoo/tipos";
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
 * Quién atiende por la empresa. Se leen sus contactos de Odoo; con uno solo, se
 * elige solo. El teléfono de la cotización y del pedido es el de la persona
 * elegida. Elegirla es opcional: sin ella, se usa el de la empresa.
 *
 * Se monta con `key={empresa.id}`: otra empresa es otro selector, que lee lo suyo.
 */
export function SelectorContacto({
  empresa,
  contacto,
  alElegir,
}: {
  empresa: ClienteOdoo;
  contacto: ContactoOdoo | null;
  alElegir: (contacto: ContactoOdoo | null) => void;
}) {
  const [contactos, setContactos] = useState<ContactoOdoo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [agregando, setAgregando] = useState(false);

  useEffect(() => {
    let vigente = true;
    contactosDeCliente(empresa.id)
      .then((r) => {
        if (!vigente) return;
        if (!r.ok) return setError(r.error);
        setContactos(r.contactos);
        // Uno solo: es quien atiende. Si ya había uno elegido, se respeta.
        if (!contacto && r.contactos.length === 1) alElegir(r.contactos[0]);
      })
      .catch(() => vigente && setError("No se pudieron leer los contactos."));
    return () => {
      vigente = false;
    };
    // `contacto` y `alElegir` a propósito fuera: quien lo monta lo hace con `key` de la empresa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresa.id]);

  return (
    <div className="flex flex-col gap-2" data-testid="selector-contacto">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">¿Quién atiende?</p>
        <Button type="button" variant="ghost" size="sm" className="gap-1" onClick={() => setAgregando(true)}>
          <UserPlus className="size-3.5" />
          Agregar contacto
        </Button>
      </div>

      {error ? (
        <p className="text-muted-foreground text-xs" role="status">
          {error} Se usará el teléfono de la empresa.
        </p>
      ) : contactos === null ? (
        <p className="text-muted-foreground text-xs" role="status">
          Leyendo contactos de Odoo…
        </p>
      ) : contactos.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          Esta empresa no tiene contactos en Odoo. Agrega a quien atiende para usar su teléfono
          {empresa.telefono ? ` (hoy se usaría el de la empresa: ${empresa.telefono})` : ""}.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2" role="radiogroup" aria-label="Contacto de la empresa">
          {contactos.map((c) => {
            const elegido = contacto?.id === c.id;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={elegido}
                  onClick={() => alElegir(elegido ? null : c)}
                  className={`flex max-w-full flex-col items-start rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                    elegido ? "border-primary bg-primary/[0.06]" : "hover:bg-muted"
                  }`}
                >
                  <span className="inline-flex items-center gap-1.5 font-medium">
                    <UserRound className="size-3.5 shrink-0" />
                    <span className="truncate">{c.nombre}</span>
                  </span>
                  <span className="text-muted-foreground flex flex-wrap gap-x-3 text-xs">
                    {c.cargo && <span>{c.cargo}</span>}
                    {c.telefono ? (
                      <span className="tnum inline-flex items-center gap-1">
                        <Phone className="size-3" />
                        {c.telefono}
                      </span>
                    ) : (
                      <span>Sin teléfono</span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={agregando} onOpenChange={(v) => !v && setAgregando(false)} triggerId={null}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Agregar contacto</DialogTitle>
            <DialogDescription>
              Una persona más de {empresa.nombre}. Se crea en Odoo y queda elegida.
            </DialogDescription>
          </DialogHeader>
          {agregando && (
            <FormularioContacto
              empresaId={empresa.id}
              alCrear={(nuevo) => {
                setAgregando(false);
                setContactos((previos) => [...(previos ?? []), nuevo].sort((a, b) => a.nombre.localeCompare(b.nombre)));
                alElegir(nuevo);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FormularioContacto({
  empresaId,
  alCrear,
}: {
  empresaId: number;
  alCrear: (contacto: ContactoOdoo) => void;
}) {
  const [pendiente, iniciar] = useTransition();
  const form = useForm<FormNuevoContacto, unknown, unknown>({
    resolver: zodResolver(esquemaNuevoContacto),
    mode: "onTouched",
    defaultValues: { empresaId, nombre: "", cargo: "", telefono: "", email: "" },
  });
  const errores = form.formState.errors;

  const enviar = form.handleSubmit(() =>
    iniciar(async () => {
      // Lo tecleado, no lo que devolvió el resolver: el servidor valida otra vez.
      const r = await agregarContactoOdoo(form.getValues());
      if (!r.ok) {
        toast.error("No se pudo agregar el contacto", { description: r.error });
        return;
      }
      toast.success("Contacto agregado en Odoo", { description: r.contacto.nombre });
      alCrear(r.contacto);
    }),
  );

  return (
    <form onSubmit={enviar} noValidate className="flex flex-col gap-4">
      <Campo label="Nombre" requerido error={errores.nombre?.message}>
        <Input autoFocus aria-invalid={!!errores.nombre} {...form.register("nombre")} />
      </Campo>
      <Campo label="Cargo" error={errores.cargo?.message}>
        <Input placeholder="Ej. Compras" {...form.register("cargo")} />
      </Campo>
      <Campo label="Teléfono" error={errores.telefono?.message}>
        <Input inputMode="tel" placeholder="9XX XXX XXX" className="tnum" {...form.register("telefono")} />
      </Campo>
      <Campo label="Correo" error={errores.email?.message}>
        <Input type="email" inputMode="email" placeholder="opcional" {...form.register("email")} />
      </Campo>
      <DialogFooter>
        <DialogClose render={<Button variant="outline" type="button" />}>Cancelar</DialogClose>
        <Button type="submit" disabled={pendiente}>
          {pendiente ? "Agregando en Odoo…" : "Agregar contacto"}
        </Button>
      </DialogFooter>
    </form>
  );
}
