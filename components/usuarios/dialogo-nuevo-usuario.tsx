"use client";

import { useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { crearUsuario } from "@/app/(app)/usuarios/acciones";
import { esquemaNuevoUsuario, type FormNuevoUsuario, type NuevoUsuario } from "@/lib/esquemas";
import { ROLES, type Rol } from "@/lib/dominio";
import { Button } from "@/components/ui/button";
import { Campo } from "@/components/ui/campo";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const ORDEN_ROLES: Rol[] = ["administracion", "logistica", "operaciones"];

/**
 * Alta de una cuenta. La contraseña no se escribe: la genera el servidor y vuelve
 * en `alCrear` para mostrarla una sola vez.
 */
export function DialogoNuevoUsuario({
  abierto,
  alCerrar,
  alCrear,
}: {
  abierto: boolean;
  alCerrar: () => void;
  alCrear: (cuenta: { nombre: string; password: string }) => void;
}) {
  return (
    <Dialog open={abierto} onOpenChange={(v) => !v && alCerrar()} triggerId={null}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nueva cuenta</DialogTitle>
          <DialogDescription>
            Se crea con una contraseña temporal que verás una sola vez. Si pones su correo, la
            persona no tendrá que registrarlo al entrar.
          </DialogDescription>
        </DialogHeader>
        {abierto && <Formulario alCerrar={alCerrar} alCrear={alCrear} />}
      </DialogContent>
    </Dialog>
  );
}

function Formulario({
  alCerrar,
  alCrear,
}: {
  alCerrar: () => void;
  alCrear: (cuenta: { nombre: string; password: string }) => void;
}) {
  const [pendiente, iniciar] = useTransition();
  const form = useForm<FormNuevoUsuario, unknown, NuevoUsuario>({
    resolver: zodResolver(esquemaNuevoUsuario),
    mode: "onTouched",
    defaultValues: { usuario: "", nombre: "", rol: undefined, correo: "" },
  });
  const errores = form.formState.errors;
  const rol = useWatch({ control: form.control, name: "rol" });

  const enviar = form.handleSubmit((datos) =>
    iniciar(async () => {
      const r = await crearUsuario(datos);
      if (!r.ok) {
        toast.error("No se pudo crear la cuenta", { description: r.error });
        return;
      }
      alCerrar();
      alCrear({ nombre: datos.nombre, password: r.password ?? "" });
    }),
  );

  return (
    <form onSubmit={enviar} noValidate className="flex flex-col gap-4">
      <Campo label="Nombre" requerido error={errores.nombre?.message}>
        <Input autoFocus placeholder="Ej. Carla Mendoza" aria-invalid={!!errores.nombre} {...form.register("nombre")} />
      </Campo>

      <Campo
        label="Usuario"
        requerido
        ayuda="Con el que entra al sistema. Minúsculas, sin espacios."
        error={errores.usuario?.message}
      >
        <Input
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="carla"
          aria-invalid={!!errores.usuario}
          {...form.register("usuario")}
        />
      </Campo>

      <Campo label="Rol" requerido error={errores.rol?.message}>
        <Select
          value={rol ?? ""}
          onValueChange={(v) => v && form.setValue("rol", v as Rol, { shouldValidate: true, shouldTouch: true })}
        >
          <SelectTrigger className="w-full" aria-invalid={!!errores.rol}>
            <SelectValue placeholder="Elige un rol">{rol ? ROLES[rol as Rol].nombre : null}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {ORDEN_ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                {ROLES[r].nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Campo>

      <Campo
        label="Correo de recuperación"
        ayuda="Opcional. Sin él, la persona lo registra al entrar por primera vez."
        error={errores.correo?.message}
      >
        <Input
          type="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="trabajador@ejemplo.com"
          aria-invalid={!!errores.correo}
          {...form.register("correo")}
        />
      </Campo>

      <DialogFooter>
        <DialogClose render={<Button variant="outline" type="button" />}>Cancelar</DialogClose>
        <Button type="submit" disabled={pendiente}>
          {pendiente ? "Creando…" : "Crear cuenta"}
        </Button>
      </DialogFooter>
    </form>
  );
}
