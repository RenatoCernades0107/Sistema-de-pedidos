"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowRight, Ban, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/store";
import { FORMATO_COMPROBANTE, esquemaFormEstado } from "@/lib/esquemas";
import {
  ESTADOS,
  UBICACIONES,
  requiereComprobante,
  requiereMotivo,
  transicionesValidas,
  type Estado,
  type Pedido,
  type Ubicacion,
} from "@/lib/dominio";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Campo as CampoBase } from "@/components/ui/campo";
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

type Campos = z.infer<typeof esquemaFormEstado>;

export function AccionesPedido({ pedido: p }: { pedido: Pedido }) {
  const {
    permisos,
    trabajadores,
    pendiente,
    cambiarEstado,
    cambiarUbicacion,
    asignarResponsable,
  } = useStore();
  const [destino, setDestino] = useState<Estado | null>(null);

  const validas = transicionesValidas(p);

  /* El comprobante solo lo escribe (y lo ve) Administración. Para los demás roles
     el pedido tiene que llegar ya con comprobante: `tieneComprobante` es el booleano
     que las tres vistas exponen para poder decirlo sin enseñar el número. */
  const puedeRegistrarComprobante = permisos.editarTodo;
  const bloqueadoSinComprobante = (e: Estado) =>
    requiereComprobante(e) && !p.tieneComprobante && !puedeRegistrarComprobante;

  const form = useForm<Campos>({
    resolver: zodResolver(esquemaFormEstado),
    defaultValues: { motivo: "", numeroComprobante: "" },
  });

  const pedirCambio = (nuevo: Estado) => {
    const pideComprobante = requiereComprobante(nuevo) && !p.tieneComprobante && puedeRegistrarComprobante;
    if (requiereMotivo(nuevo) || pideComprobante) {
      form.reset({ motivo: "", numeroComprobante: "" });
      setDestino(nuevo);
      return;
    }
    cambiarEstado(p.codigo, nuevo);
  };

  const confirmar = form.handleSubmit(async (valores) => {
    if (!destino) return;
    if (requiereMotivo(destino) && !valores.motivo) {
      form.setError("motivo", { message: "El motivo es obligatorio" });
      return;
    }
    if (requiereComprobante(destino) && !p.tieneComprobante && !valores.numeroComprobante) {
      form.setError("numeroComprobante", {
        message: "Sin comprobante no se puede entregar",
      });
      return;
    }
    const resultado = await cambiarEstado(p.codigo, destino, {
      motivo: valores.motivo,
      numeroComprobante: valores.numeroComprobante,
    });
    // El diálogo solo se cierra si la base aceptó el cambio: si no, el motivo que
    // acaba de escribirse se perdería y habría que teclearlo otra vez.
    if (resultado.ok) setDestino(null);
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
          <CampoBase grupo label="Mover el pedido a" claseEtiqueta="eyebrow">
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
                    disabled={pendiente || bloqueadoSinComprobante(e)}
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
            {validas.some(bloqueadoSinComprobante) && (
              <p className="text-muted-foreground mt-2 text-xs">
                Falta el número de comprobante, y lo registra Administración.
              </p>
            )}
            {puedeRegistrarComprobante && p.estado === "listo" && !p.tieneComprobante && !p.esProvincia && (
              <p className="text-muted-foreground mt-2 text-xs">
                Para entregar hace falta el número de comprobante.
              </p>
            )}
          </CampoBase>

          <Campo
            etiqueta="Ubicación actual"
            bloqueado={!permisos.editarUbicacion}
          >
            {permisos.editarUbicacion ? (
              <Select
                value={p.ubicacion}
                disabled={pendiente}
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
                value={p.responsableId ?? "sin"}
                disabled={pendiente}
                onValueChange={(v) =>
                  v && asignarResponsable(p.codigo, v === "sin" ? null : v)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue>{p.responsable ?? "Sin asignar"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sin">Sin asignar</SelectItem>
                  {trabajadores.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.nombre}
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
                : "Un pedido no puede darse por entregado sin su número de comprobante."}
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

            {destino && requiereComprobante(destino) && !p.tieneComprobante && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="comprobante">Número de comprobante</Label>
                <Input
                  id="comprobante"
                  autoFocus
                  placeholder={FORMATO_COMPROBANTE.ejemplo}
                  className="font-mono"
                  aria-invalid={!!form.formState.errors.numeroComprobante}
                  {...form.register("numeroComprobante")}
                />
                {form.formState.errors.numeroComprobante && (
                  <p className="text-destructive text-xs">
                    {form.formState.errors.numeroComprobante.message}
                  </p>
                )}
              </div>
            )}

            <DialogFooter>
              <DialogClose render={<Button variant="outline" type="button" />}>
                Cancelar
              </DialogClose>
              <Button type="submit" disabled={pendiente}>
                {pendiente ? "Guardando…" : "Confirmar cambio"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Bloqueado, el valor es un párrafo y no hay control al que apuntar: el conjunto
 * se nombra como grupo. Editable, es un `Select` y la etiqueta se enlaza con su
 * disparador.
 */
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
    <CampoBase
      grupo={bloqueado}
      claseEtiqueta="eyebrow flex items-center gap-1.5"
      label={
        <>
          {etiqueta}
          {bloqueado && (
            <Lock className="size-3 opacity-60" role="img" aria-label="solo lectura" />
          )}
        </>
      }
    >
      {children}
    </CampoBase>
  );
}
