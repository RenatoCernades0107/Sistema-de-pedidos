"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowRight, Ban, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/store";
import {
  ESTADOS,
  TRABAJADORES,
  UBICACIONES,
  requiereFactura,
  requiereMotivo,
  transicionesValidas,
  type Estado,
  type Pedido,
  type Ubicacion,
} from "@/lib/dominio";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EstadoBadge } from "@/components/estado-badge";

/** Las mismas reglas del modelo, aplicadas antes de dejar guardar. */
const esquema = z.object({
  // El campo vacío es válido aquí: lo que hace obligatorio a cada uno es el estado
  // de destino, y eso se comprueba en `confirmar`. Sin el `or(literal(""))` el valor
  // inicial "" fallaría el regex y el formulario nunca llegaría a enviarse.
  motivo: z
    .string()
    .trim()
    .min(8, "Explica el motivo en al menos 8 caracteres")
    .or(z.literal(""))
    .optional(),
  numeroFactura: z
    .string()
    .trim()
    .regex(/^F\d{3}-\d{6}$/, "Formato esperado: F001-004512")
    .or(z.literal(""))
    .optional(),
});

type Campos = z.infer<typeof esquema>;

export function AccionesPedido({ pedido: p }: { pedido: Pedido }) {
  const { permisos, cambiarEstado, cambiarUbicacion, asignarResponsable } =
    useStore();
  const [destino, setDestino] = useState<Estado | null>(null);

  const validas = transicionesValidas(p);

  const form = useForm<Campos>({
    resolver: zodResolver(esquema),
    defaultValues: { motivo: "", numeroFactura: "" },
  });

  const pedirCambio = (nuevo: Estado) => {
    if (requiereMotivo(nuevo) || (requiereFactura(nuevo) && !p.numeroFactura)) {
      form.reset({ motivo: "", numeroFactura: "" });
      setDestino(nuevo);
      return;
    }
    cambiarEstado(p.codigo, nuevo);
  };

  const confirmar = form.handleSubmit((valores) => {
    if (!destino) return;
    if (requiereMotivo(destino) && !valores.motivo) {
      form.setError("motivo", { message: "El motivo es obligatorio" });
      return;
    }
    if (
      requiereFactura(destino) &&
      !p.numeroFactura &&
      !valores.numeroFactura
    ) {
      form.setError("numeroFactura", {
        message: "Sin factura no se puede entregar",
      });
      return;
    }
    cambiarEstado(p.codigo, destino, valores.motivo);
    setDestino(null);
  });

  return (
    <>
      <section className="bg-card rounded-xl border">
        <header className="flex items-center gap-2 border-b px-4 py-3">
          <h2 className="text-sm font-medium">Acciones</h2>
          <span className="text-muted-foreground ml-auto text-xs">
            {permisos.nombre}
          </span>
        </header>

        <div className="flex flex-col gap-4 p-4">
          <div>
            <Label className="eyebrow mb-2 block">Mover el pedido a</Label>
            {validas.length === 0 ? (
              <p className="text-muted-foreground flex items-center gap-2 text-sm">
                <Lock className="size-3.5 shrink-0" />
                {p.estado === "entregado"
                  ? "Entregado: el pedido está cerrado."
                  : "Anulado: el pedido está cerrado."}
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {validas.map((e) => (
                  <Button
                    key={e}
                    variant={e === "anulado" ? "destructive" : "outline"}
                    size="sm"
                    onClick={() => pedirCambio(e)}
                    className="gap-1.5"
                  >
                    {e === "anulado" ? (
                      <Ban className="size-3.5" />
                    ) : (
                      <ArrowRight className="size-3.5" />
                    )}
                    {ESTADOS[e]}
                  </Button>
                ))}
              </div>
            )}
            {p.estado === "listo" && !p.numeroFactura && !p.esProvincia && (
              <p className="text-muted-foreground mt-2 text-xs">
                Para entregar hace falta el número de factura.
              </p>
            )}
          </div>

          <Campo
            etiqueta="Ubicación actual"
            bloqueado={!permisos.editarUbicacion}
          >
            {permisos.editarUbicacion ? (
              <Select
                value={p.ubicacion}
                onValueChange={(v) =>
                  v && cambiarUbicacion(p.codigo, v as Ubicacion)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue>{UBICACIONES[p.ubicacion]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(UBICACIONES) as Ubicacion[]).map((u) => (
                    <SelectItem key={u} value={u}>
                      {UBICACIONES[u]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-sm">{UBICACIONES[p.ubicacion]}</p>
            )}
          </Campo>

          <Campo
            etiqueta="Responsable en taller"
            bloqueado={!permisos.asignarResponsable}
          >
            {permisos.asignarResponsable ? (
              <Select
                value={p.responsable ?? "sin"}
                onValueChange={(v) =>
                  asignarResponsable(p.codigo, v === "sin" ? null : v)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue>{p.responsable ?? "Sin asignar"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sin">Sin asignar</SelectItem>
                  {TRABAJADORES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p
                className={cn(
                  "text-sm",
                  !p.responsable && "text-muted-foreground",
                )}
              >
                {p.responsable ?? "Sin asignar"}
              </p>
            )}
          </Campo>
        </div>
      </section>

      {/* Este diálogo no lo abre un DialogTrigger sino el botón de la transición,
          así que Base UI necesita `triggerId={null}` para no quedarse esperando
          un trigger que no existe. Sin eso no abre nunca. */}
      <Dialog
        open={destino !== null}
        onOpenChange={(v) => !v && setDestino(null)}
        triggerId={null}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Pasar a {destino && ESTADOS[destino]}
              {destino && <EstadoBadge estado={destino} size="sm" />}
            </DialogTitle>
            <DialogDescription>
              {destino && requiereMotivo(destino)
                ? "Este cambio queda en el historial del pedido, así que el motivo es obligatorio."
                : "Un pedido no puede darse por entregado sin su número de factura."}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={confirmar} className="flex flex-col gap-4" noValidate>
            {destino && requiereMotivo(destino) && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="motivo">Motivo</Label>
                <Textarea
                  id="motivo"
                  rows={3}
                  autoFocus
                  placeholder="Qué pasó y desde cuándo"
                  aria-invalid={!!form.formState.errors.motivo}
                  {...form.register("motivo")}
                />
                {form.formState.errors.motivo && (
                  <p className="text-destructive text-xs">
                    {form.formState.errors.motivo.message}
                  </p>
                )}
              </div>
            )}

            {destino && requiereFactura(destino) && !p.numeroFactura && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="factura">Número de factura</Label>
                <Input
                  id="factura"
                  autoFocus
                  placeholder="F001-004512"
                  className="font-mono"
                  aria-invalid={!!form.formState.errors.numeroFactura}
                  {...form.register("numeroFactura")}
                />
                {form.formState.errors.numeroFactura && (
                  <p className="text-destructive text-xs">
                    {form.formState.errors.numeroFactura.message}
                  </p>
                )}
              </div>
            )}

            <DialogFooter>
              <DialogClose render={<Button variant="outline" type="button" />}>
                Cancelar
              </DialogClose>
              <Button type="submit">Confirmar cambio</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Campo({
  etiqueta,
  bloqueado,
  children,
}: {
  etiqueta: string;
  bloqueado?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="eyebrow flex items-center gap-1.5">
        {etiqueta}
        {bloqueado && (
          <Lock className="size-3 opacity-60" aria-label="solo lectura" />
        )}
      </Label>
      {children}
    </div>
  );
}
