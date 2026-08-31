"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Info, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/store";
import { DEPARTAMENTOS } from "@/lib/datos";
import { fechaCompleta } from "@/lib/formato";
import {
  DOCUMENTOS,
  LUGARES,
  PLAZOS,
  PRODUCTOS,
  TIPOS,
  admiteDecimales,
  siglaDe,
  unidadDe,
  venceCreditoEl,
  type LugarEntrega,
  type Pedido,
  type PlazoCredito,
  type ProductoTerminado,
  type TipoDocumento,
  type TipoPedido,
} from "@/lib/dominio";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Cuántos decimales trae un número tal como lo escribió el usuario. */
const decimalesDe = (n: number) => (String(n).split(".")[1] ?? "").length;

const FORMATO_DOCUMENTO = {
  DNI: { regex: /^\d{8}$/, largo: 8, ayuda: "8 dígitos" },
  CE: { regex: /^[A-Za-z0-9]{9,12}$/, largo: 12, ayuda: "9 a 12 caracteres" },
} as const;

/* ────────────────────────────────────────────────────────────
   Datos del pedido — solo Administración
   ──────────────────────────────────────────────────────────── */

const esquemaDatos = z
  .object({
    cliente: z.string().trim().min(3, "Escribe el nombre del cliente"),
    telefonoCliente: z.string().trim().optional(),
    tipos: z
      .array(z.enum(["CL", "CM", "SP", "PT", "AC"]))
      .min(1, "Elige al menos un tipo de pedido"),
    producto: z
      .enum(["cajas", "porta_afiches", "pivotante", "letreros", "letras", "displays", "otro"])
      .optional(),
    cantidad: z.coerce.number().positive("La cantidad tiene que ser mayor que cero"),
    entrega: z.enum(["tienda", "taller", "domicilio", "agencia"]),
    direccion: z.string().trim().optional(),
    detalle: z.string().trim().optional(),
    observaciones: z.string().trim().optional(),
    plazoCredito: z.coerce.number().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.tipos.includes("PT") && !v.producto) {
      ctx.addIssue({
        code: "custom",
        path: ["producto"],
        message: "Un producto terminado necesita su tipo",
      });
    }
    if (!admiteDecimales(v.tipos) && !Number.isInteger(v.cantidad)) {
      ctx.addIssue({
        code: "custom",
        path: ["cantidad"],
        message: "Solo números enteros. Los decimales son para las planchas.",
      });
    }
    if (admiteDecimales(v.tipos) && decimalesDe(v.cantidad) > 2) {
      ctx.addIssue({ code: "custom", path: ["cantidad"], message: "Como máximo 2 decimales" });
    }
    if (v.entrega === "domicilio" && !v.direccion) {
      ctx.addIssue({ code: "custom", path: ["direccion"], message: "Falta la dirección" });
    }
  });

type CamposDatos = z.input<typeof esquemaDatos>;

export function EditarDatos({ pedido: p }: { pedido: Pedido }) {
  const { editarDatos } = useStore();
  const [abierto, setAbierto] = useState(false);

  const form = useForm<CamposDatos>({
    resolver: zodResolver(esquemaDatos),
    mode: "onTouched",
    defaultValues: valoresDe(p),
  });

  const tipos = (form.watch("tipos") ?? []) as TipoPedido[];
  const entrega = form.watch("entrega");
  const plazoCredito = Number(form.watch("plazoCredito")) || null;
  // El código guarda la sigla con la que se registró y no se reescribe.
  const cambioDeSigla = tipos.length > 0 && siglaDe(tipos) !== p.codigo.slice(1, 3);
  const decimales = admiteDecimales(tipos);

  const alternarTipo = (t: string) => {
    const actuales = (form.getValues("tipos") ?? []) as TipoPedido[];
    const siguientes = actuales.includes(t as TipoPedido)
      ? actuales.filter((x) => x !== t)
      : [...actuales, t as TipoPedido];
    form.setValue("tipos", siguientes, { shouldValidate: form.formState.isSubmitted });
  };

  const abrir = (v: boolean) => {
    if (v) form.reset(valoresDe(p));
    setAbierto(v);
  };

  const guardar = form.handleSubmit((v) => {
    editarDatos(p.codigo, {
      cliente: v.cliente,
      telefonoCliente: v.telefonoCliente || null,
      tipos: v.tipos as TipoPedido[],
      producto: v.tipos.includes("PT")
        ? ((v.producto ?? null) as ProductoTerminado | null)
        : null,
      cantidad: Number(v.cantidad),
      entrega: v.entrega,
      direccion: v.entrega === "domicilio" ? (v.direccion ?? null) : null,
      detalle: v.detalle ?? "",
      observaciones: v.observaciones || null,
      plazoCredito:
        p.tipoPago === "credito" ? ((Number(v.plazoCredito) || null) as PlazoCredito | null) : null,
    });
    setAbierto(false);
  });

  return (
    <Dialog open={abierto} onOpenChange={abrir}>
      <DialogTrigger
        render={<Button variant="outline" size="sm" className="gap-1.5" />}
        nativeButton
      >
        <Pencil className="size-3.5" />
        Editar
      </DialogTrigger>

      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar datos del pedido</DialogTitle>
          <DialogDescription>
            Cada campo que cambies queda registrado en la auditoría con tu nombre.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={guardar} noValidate className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo label="Cliente" requerido error={form.formState.errors.cliente?.message}>
              <Input
                aria-invalid={!!form.formState.errors.cliente}
                {...form.register("cliente")}
              />
            </Campo>

            <Campo label="Teléfono del cliente">
              <Input
                inputMode="tel"
                placeholder="9XX XXX XXX"
                className="tnum"
                {...form.register("telefonoCliente")}
              />
            </Campo>
          </div>

          <Campo
            label="Tipo de pedido"
            requerido
            error={form.formState.errors.tipos?.message}
          >
            <Opciones
              valores={tipos}
              onToggle={alternarTipo}
              opciones={Object.entries(TIPOS).map(([valor, label]) => ({ valor, label }))}
            />
          </Campo>

          {cambioDeSigla && (
            <Aviso>
              El código <span className="font-medium">{p.codigo}</span> no cambia: lleva las
              siglas del tipo con el que se registró y ya está en papeles y conversaciones.
              Seguirá diciendo <span className="font-medium">{p.codigo.slice(1, 3)}</span>,
              aunque ahora el pedido sea{" "}
              <span className="font-medium">{siglaDe(tipos)}</span>.
            </Aviso>
          )}

          {tipos.includes("PT") && (
            <Campo
              label="Tipo de producto"
              requerido
              error={form.formState.errors.producto?.message}
            >
              <Select
                value={form.watch("producto") ?? ""}
                onValueChange={(v) => v && form.setValue("producto", v as ProductoTerminado)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {form.watch("producto")
                      ? PRODUCTOS[form.watch("producto") as ProductoTerminado]
                      : "Selecciona…"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PRODUCTOS).map(([v, l]) => (
                    <SelectItem key={v} value={v}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>
          )}

          <Campo
            label={`Cantidad (${unidadDe(tipos)})`}
            requerido
            error={form.formState.errors.cantidad?.message}
          >
            <Input
              type="number"
              min={decimales ? 0.01 : 1}
              step={decimales ? 0.01 : 1}
              className="tnum max-w-32"
              aria-invalid={!!form.formState.errors.cantidad}
              {...form.register("cantidad")}
            />
          </Campo>

          <Campo label="Lugar de entrega" requerido>
            {p.esProvincia ? (
              <>
                <p className="text-sm">Agencia</p>
                <p className="text-muted-foreground text-xs">
                  Es un pedido a provincia: la entrega va por agencia y no se cambia desde aquí.
                </p>
              </>
            ) : (
              <Opciones
                valores={[entrega]}
                onToggle={(v) => form.setValue("entrega", v as LugarEntrega)}
                opciones={(["tienda", "taller", "domicilio"] as LugarEntrega[]).map((v) => ({
                  valor: v,
                  label: LUGARES[v],
                }))}
              />
            )}
          </Campo>

          {!p.esProvincia && entrega === "domicilio" && (
            <Campo
              label="Dirección de entrega"
              requerido
              error={form.formState.errors.direccion?.message}
            >
              <Input
                placeholder="Calle, número, distrito"
                aria-invalid={!!form.formState.errors.direccion}
                {...form.register("direccion")}
              />
            </Campo>
          )}

          <Campo label="Fecha prometida">
            <p className="tnum text-sm">{fechaCompleta(p.fechaPrometida)}</p>
            <p className="text-muted-foreground text-xs">
              Se fija al registrar el pedido y ya no se cambia: es el compromiso
              con el cliente y por él se ordena el trabajo del taller.
            </p>
          </Campo>

          {p.tipoPago === "credito" && (
            <Campo
              label="Plazo del crédito"
              error={form.formState.errors.plazoCredito?.message}
            >
              <Opciones
                valores={plazoCredito ? [String(plazoCredito)] : []}
                onToggle={(v) => form.setValue("plazoCredito", Number(v))}
                opciones={PLAZOS.map((d) => ({
                  valor: String(d),
                  label: d === 1 ? "1 día" : `${d} días`,
                }))}
              />
              <p className="text-muted-foreground text-xs">
                {plazoCredito
                  ? `Vence el ${fechaCompleta(
                      venceCreditoEl({ ...p, plazoCredito: plazoCredito as PlazoCredito })!,
                    )}, contado desde el registro.`
                  : "Días desde el registro del pedido."}
              </p>
            </Campo>
          )}

          <Campo label="Detalle">
            <Textarea
              rows={3}
              placeholder="Ej. 5 Acrílico Alfa 5mm transparente F7"
              {...form.register("detalle")}
            />
            <p className="text-muted-foreground text-xs">
              Orden sugerido: Cantidad · Material · Marca · Espesor · Color · Formato. El texto
              es libre.
            </p>
          </Campo>

          <Campo label="Observaciones">
            <Textarea
              rows={2}
              placeholder="Notas e incidencias del pedido"
              {...form.register("observaciones")}
            />
          </Campo>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />} nativeButton>
              Cancelar
            </DialogClose>
            <Button type="submit">Guardar cambios</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const valoresDe = (p: Pedido): CamposDatos => ({
  cliente: p.cliente,
  telefonoCliente: p.telefonoCliente ?? "",
  tipos: p.tipos,
  producto: p.producto ?? undefined,
  cantidad: p.cantidad,
  entrega: p.entrega,
  direccion: p.direccion ?? "",
  detalle: p.detalle,
  observaciones: p.observaciones ?? "",
  plazoCredito: p.plazoCredito ?? undefined,
});

/* ────────────────────────────────────────────────────────────
   Envío a provincia — Administración y Logística
   ──────────────────────────────────────────────────────────── */

const esquemaEnvio = z
  .object({
    departamento: z.string().min(1, "Elige el departamento"),
    provincia: z.string().trim().optional(),
    agencia: z.string().trim().optional(),
    personaQueRecoge: z.string().trim().optional(),
    tipoDocumento: z.enum(["DNI", "CE"]),
    numeroDocumento: z.string().trim().optional(),
    telefono: z.string().trim().optional(),
    montoFlete: z.coerce.number().min(0, "No puede ser negativo"),
    fletePagado: z.boolean(),
    observacionesEnvio: z.string().trim().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.numeroDocumento && !FORMATO_DOCUMENTO[v.tipoDocumento].regex.test(v.numeroDocumento)) {
      ctx.addIssue({
        code: "custom",
        path: ["numeroDocumento"],
        message: `El ${v.tipoDocumento} tiene ${FORMATO_DOCUMENTO[v.tipoDocumento].ayuda}`,
      });
    }
  });

type CamposEnvio = z.input<typeof esquemaEnvio>;

export function EditarEnvio({ pedido: p }: { pedido: Pedido }) {
  const { editarEnvio } = useStore();
  const [abierto, setAbierto] = useState(false);

  const form = useForm<CamposEnvio>({
    resolver: zodResolver(esquemaEnvio),
    mode: "onTouched",
    defaultValues: envioDe(p),
  });

  const tipoDocumento = (form.watch("tipoDocumento") ?? "DNI") as TipoDocumento;
  const documento = FORMATO_DOCUMENTO[tipoDocumento];

  const abrir = (v: boolean) => {
    if (v) form.reset(envioDe(p));
    setAbierto(v);
  };

  const guardar = form.handleSubmit((v) => {
    editarEnvio(p.codigo, {
      departamento: v.departamento,
      provincia: v.provincia || null,
      agencia: v.agencia || null,
      personaQueRecoge: v.personaQueRecoge || null,
      tipoDocumento: v.tipoDocumento,
      numeroDocumento: v.numeroDocumento || null,
      telefono: v.telefono || null,
      montoFlete: Number(v.montoFlete),
      fletePagado: !!v.fletePagado,
      observacionesEnvio: v.observacionesEnvio || null,
    });
    setAbierto(false);
  });

  return (
    <Dialog open={abierto} onOpenChange={abrir}>
      <DialogTrigger
        render={<Button variant="outline" size="sm" className="gap-1.5" />}
        nativeButton
      >
        <Pencil className="size-3.5" />
        Editar
      </DialogTrigger>

      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar envío a provincia</DialogTitle>
          <DialogDescription>
            Datos de la agencia y de quién recoge. Queda todo en la auditoría.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={guardar} noValidate className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo
              label="Departamento"
              requerido
              error={form.formState.errors.departamento?.message}
            >
              <Select
                value={form.watch("departamento")}
                onValueChange={(v) => v && form.setValue("departamento", v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>{form.watch("departamento") || "Selecciona…"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {DEPARTAMENTOS.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>
            <Campo label="Provincia">
              <Input placeholder="Ej. Trujillo" {...form.register("provincia")} />
            </Campo>
          </div>

          <Campo label="Nombre de la agencia">
            <Input placeholder="Ej. Shalom - Trujillo Centro" {...form.register("agencia")} />
          </Campo>

          <Campo label="Persona que recoge">
            <Input placeholder="Nombre completo" {...form.register("personaQueRecoge")} />
          </Campo>

          <div className="grid gap-4 sm:grid-cols-2">
            <Campo label="Tipo de documento">
              <Select
                value={tipoDocumento}
                onValueChange={(v) => {
                  if (!v) return;
                  form.setValue("tipoDocumento", v as TipoDocumento);
                  form.clearErrors("numeroDocumento");
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>{DOCUMENTOS[tipoDocumento]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(DOCUMENTOS).map(([v, l]) => (
                    <SelectItem key={v} value={v}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>
            <Campo
              label="Número de documento del que recoge"
              error={form.formState.errors.numeroDocumento?.message}
            >
              <Input
                inputMode={tipoDocumento === "DNI" ? "numeric" : "text"}
                maxLength={documento.largo}
                placeholder={documento.ayuda}
                className="tnum"
                aria-invalid={!!form.formState.errors.numeroDocumento}
                {...form.register("numeroDocumento")}
              />
            </Campo>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Campo label="Teléfono">
              <Input inputMode="tel" placeholder="9XX XXX XXX" {...form.register("telefono")} />
            </Campo>
            <Campo label="Monto del flete" error={form.formState.errors.montoFlete?.message}>
              <Input
                type="number"
                min={0}
                step="0.01"
                className="tnum"
                aria-invalid={!!form.formState.errors.montoFlete}
                {...form.register("montoFlete")}
              />
            </Campo>
          </div>

          <Campo label="Estado del flete">
            <label className="flex cursor-pointer items-center gap-2.5 text-sm">
              <Checkbox
                checked={!!form.watch("fletePagado")}
                onCheckedChange={(v) => form.setValue("fletePagado", v === true)}
              />
              El flete ya está pagado
            </label>
          </Campo>

          <Campo label="Observaciones del envío">
            <Textarea
              rows={2}
              placeholder="Indicaciones para la agencia"
              {...form.register("observacionesEnvio")}
            />
          </Campo>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />} nativeButton>
              Cancelar
            </DialogClose>
            <Button type="submit">Guardar cambios</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const envioDe = (p: Pedido): CamposEnvio => ({
  departamento: p.envio?.departamento ?? "",
  provincia: p.envio?.provincia ?? "",
  agencia: p.envio?.agencia ?? "",
  personaQueRecoge: p.envio?.personaQueRecoge ?? "",
  tipoDocumento: p.envio?.tipoDocumento ?? "DNI",
  numeroDocumento: p.envio?.numeroDocumento ?? "",
  telefono: p.envio?.telefono ?? "",
  montoFlete: p.envio?.montoFlete ?? 0,
  fletePagado: p.envio?.fletePagado ?? false,
  observacionesEnvio: p.envio?.observacionesEnvio ?? "",
});

/* ── Piezas compartidas ── */

function Campo({
  label,
  requerido,
  error,
  children,
}: {
  label: string;
  requerido?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label className="text-xs font-medium">
        {label}
        {requerido && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      {children}
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  );
}

/** Con un solo valor se comporta como radio; con varios, como casillas. */
function Opciones({
  valores,
  onToggle,
  opciones,
}: {
  valores: string[];
  onToggle: (v: string) => void;
  opciones: { valor: string; label: string }[];
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {opciones.map((o) => {
        const activo = valores.includes(o.valor);
        return (
          <button
            key={o.valor}
            type="button"
            onClick={() => onToggle(o.valor)}
            aria-pressed={activo}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-sm transition-colors",
              "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
              activo
                ? "border-primary/40 bg-primary/8 text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground hover:border-foreground/20",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <p className="bg-muted/60 text-muted-foreground flex gap-2 rounded-lg border p-2.5 text-xs">
      <Info className="mt-px size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
