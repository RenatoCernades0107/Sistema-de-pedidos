"use client";

import { useEffect, useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { crearClienteOdoo } from "@/app/(app)/cotizaciones/acciones";
import { esquemaNuevoClienteOdoo, type FormNuevoClienteOdoo, type NuevoClienteOdoo } from "@/lib/esquemas";
import { rucValido, soloDigitos, tipoDeDocumento } from "@/lib/busqueda-inteligente";
import type { ClienteOdoo } from "@/lib/odoo/tipos";
import { rucEnRegla, type RespuestaRuc } from "@/lib/ruc";
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
    direccion: "",
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

  /* Con 11 dígitos válidos se pregunta por el RUC y se completan nombre y
     dirección. Lo que el usuario ya escribió no se pisa. Si la consulta falla,
     el formulario sigue siendo de llenado manual. */
  const documento = useWatch({ control: form.control, name: "documento" });
  type Resultado = { ruc: string; ok: RespuestaRuc | null; mensaje?: string };
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const ruc = soloDigitos(documento ?? "");
  const rucConsultable = ruc.length === 11 && rucValido(ruc);
  useEffect(() => {
    if (!rucConsultable) return;
    const control = new AbortController();
    (async () => {
      try {
        const r = await fetch(`/api/clientes/ruc/${ruc}`, { signal: control.signal });
        const j = await r.json().catch(() => null);
        if (!r.ok || !j?.razon_social) {
          setResultado({ ruc, ok: null, mensaje: j?.error ?? "No se pudo consultar el RUC." });
          return;
        }
        const datos = j as RespuestaRuc;
        if (!form.getValues("nombre")?.trim()) form.setValue("nombre", datos.razon_social, { shouldValidate: true });
        if (!form.getValues("direccion")?.trim() && datos.direccion) form.setValue("direccion", datos.direccion);
        setResultado({ ruc, ok: datos });
      } catch (e) {
        if ((e as Error).name !== "AbortError") setResultado({ ruc, ok: null, mensaje: "No se pudo consultar el RUC." });
      }
    })();
    return () => control.abort();
  }, [ruc, rucConsultable, form]);
  const consulta: ConsultaRuc = !rucConsultable
    ? { tipo: "nada" }
    : resultado?.ruc !== ruc
      ? { tipo: "buscando" }
      : resultado.ok
        ? { tipo: "ok", ruc: resultado.ok }
        : { tipo: "error", mensaje: resultado.mensaje ?? "" };

  const enviar = form.handleSubmit(() =>
    iniciar(async () => {
      // Se manda lo tecleado, no lo que devolvió el resolver: este ya pasó por
      // los `transform` del esquema ("" → null) y el servidor, que valida otra
      // vez con el mismo esquema, rechazaría ese null ("Invalid input").
      const r = await crearClienteOdoo(form.getValues());
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
      <Campo
        label="RUC o DNI"
        ayuda="Opcional. Con un RUC de 11 dígitos se completan los datos desde SUNAT."
        error={errores.documento?.message}
      >
        <Input
          inputMode="numeric"
          maxLength={11}
          className="tnum"
          autoFocus
          aria-invalid={!!errores.documento}
          {...form.register("documento")}
        />
      </Campo>
      <EstadoRuc consulta={consulta} />
      <Campo label="Nombre o razón social" requerido error={errores.nombre?.message}>
        <Input
          placeholder="Ej. Corporación Andina SAC"
          aria-invalid={!!errores.nombre}
          {...form.register("nombre")}
        />
      </Campo>
      <Campo label="Dirección" error={errores.direccion?.message}>
        <Input placeholder="opcional" aria-invalid={!!errores.direccion} {...form.register("direccion")} />
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
          {pendiente ? "Creando en Odoo…" : "Crear cliente"}
        </Button>
      </DialogFooter>
    </form>
  );
}

type ConsultaRuc =
  | { tipo: "nada" }
  | { tipo: "buscando" }
  | { tipo: "ok"; ruc: RespuestaRuc }
  | { tipo: "error"; mensaje: string };

function EstadoRuc({ consulta }: { consulta: ConsultaRuc }) {
  if (consulta.tipo === "nada") return null;
  if (consulta.tipo === "buscando")
    return <p className="text-sm text-muted-foreground" role="status">Consultando RUC en SUNAT…</p>;
  if (consulta.tipo === "error")
    return <p className="text-sm text-muted-foreground" role="status">{consulta.mensaje}</p>;
  const { ruc } = consulta;
  const enRegla = rucEnRegla(ruc);
  return (
    <p
      role="status"
      className={enRegla ? "text-sm text-emerald-700" : "text-sm font-medium text-amber-700"}
    >
      {enRegla
        ? `SUNAT: ${ruc.estado} · ${ruc.condicion}`
        : `Ojo, en SUNAT figura ${ruc.estado || "sin estado"} · ${ruc.condicion || "sin condición"}. Puedes crearlo igual.`}
    </p>
  );
}
