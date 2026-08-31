"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, Upload } from "lucide-react";
import { useStore } from "@/lib/store";
import { esquemaFormNuevoPedido, FORMATO_DOCUMENTO } from "@/lib/esquemas";
import { hoy } from "@/lib/fecha";
import {
  DOCUMENTOS,
  METODOS,
  PAGOS,
  PLAZOS,
  PRODUCTOS,
  TIPOS,
  admiteDecimales,
  siglaDe,
  sumarDias,
  unidadDe,
  type PlazoCredito,
  type TipoPedido,
} from "@/lib/dominio";
import { fechaCompleta } from "@/lib/formato";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Campo, Opciones } from "@/components/ui/campo";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const esquema = esquemaFormNuevoPedido;

type Campos = z.input<typeof esquema>;

export function NuevoPedidoForm() {
  const router = useRouter();
  const { permisos, crearPedido, trabajadores, ubigeo, pendiente } = useStore();

  const form = useForm<Campos>({
    resolver: zodResolver(esquema),
    mode: "onTouched",
    defaultValues: {
      cliente: "",
      telefonoCliente: "",
      tipos: ["CL"],
      cantidad: 1,
      destino: "local",
      entrega: "tienda",
      tipoDocumento: "DNI",
      fletePagado: false,
      fechaPrometida: "",
      tipoPago: "a_cuenta",
      metodoPago: "efectivo",
      montoTotal: 0,
      detalle: "",
      observaciones: "",
    },
  });

  const tipos = (form.watch("tipos") ?? []) as TipoPedido[];
  const destino = form.watch("destino");
  const entrega = form.watch("entrega");
  const tipoPago = form.watch("tipoPago");
  const tipoDocumento = form.watch("tipoDocumento");
  /* La provincia cuelga del departamento con una FK compuesta en la base, así que
     la lista se recorta al departamento elegido en vez de ser texto libre. */
  const departamentoId = Number(form.watch("departamentoId")) || null;
  const provinciaId = Number(form.watch("provinciaId")) || null;
  const provincias = ubigeo.find((d) => d.id === departamentoId)?.provincias ?? [];
  const plazoCredito = Number(form.watch("plazoCredito")) || null;
  const abono = Number(form.watch("abono")) || 0;
  const montoTotal = Number(form.watch("montoTotal")) || 0;

  // Un pedido que combina trabajos lleva "MX": el código se dicta por teléfono.
  const codigoPreview = `${destino === "provincia" ? "P" : "L"}${
    tipos.length ? siglaDe(tipos) : "··"
  }_${hoy().slice(0, 4)}_····`;

  const decimales = admiteDecimales(tipos);
  const documento = FORMATO_DOCUMENTO[tipoDocumento];

  /** Hay dinero de entrada, así que hay que decir por dónde entró. */
  const cobraAhora = tipoPago === "contado" || (tipoPago === "a_cuenta" && abono > 0);

  const alternarTipo = (t: string) => {
    const actuales = (form.getValues("tipos") ?? []) as TipoPedido[];
    const siguientes = actuales.includes(t as TipoPedido)
      ? actuales.filter((x) => x !== t)
      : [...actuales, t as TipoPedido];
    form.setValue("tipos", siguientes, { shouldValidate: form.formState.isSubmitted });
  };

  if (!permisos.crearPedido) {
    return (
      <div className="grid min-h-[60vh] place-items-center p-6 text-center">
        <div className="max-w-sm">
          <h1 className="text-lg font-semibold">Solo Administración registra pedidos</h1>
          <p className="text-muted-foreground mt-1.5 text-sm">
            {permisos.nombre} puede mover el estado de un pedido, pero no crearlo.
          </p>
        </div>
      </div>
    );
  }

  const onSubmit = form.handleSubmit(async (v) => {
    const esProvincia = v.destino === "provincia";
    const resultado = await crearPedido({
      cliente: v.cliente,
      telefonoCliente: v.telefonoCliente || null,
      tipos: v.tipos as TipoPedido[],
      producto: v.producto ?? null,
      cantidad: Number(v.cantidad),
      esProvincia,
      entrega: esProvincia ? "agencia" : v.entrega,
      direccion: v.direccion || null,
      envio: esProvincia
        ? {
            departamentoId: Number(v.departamentoId),
            provinciaId: Number(v.provinciaId) || null,
            agencia: v.agencia || null,
            personaQueRecoge: v.personaQueRecoge || null,
            tipoDocumento: v.tipoDocumento,
            numeroDocumento: v.numeroDocumento || null,
            telefono: v.telefono || null,
            montoFlete: Number(v.flete ?? 0),
            fletePagado: !!v.fletePagado,
            observacionesEnvio: v.observacionesEnvio || null,
          }
        : null,
      fechaPrometida: v.fechaPrometida,
      tipoPago: v.tipoPago,
      plazoCredito: v.tipoPago === "credito" ? ((Number(v.plazoCredito) || null) as PlazoCredito | null) : null,
      montoTotal: Number(v.montoTotal),
      // Al crédito no entra nada al registrar, aunque el campo de abono conserve lo
      // que se hubiera tecleado antes de cambiar el tipo de pago.
      abonoInicial: v.tipoPago === "credito" ? 0 : Number(v.abono ?? 0),
      metodoPago: v.metodoPago,
      responsableId: v.responsableId || null,
      detalle: v.detalle ?? "",
      observaciones: v.observaciones || null,
    });
    // El código lo pone Postgres, así que hasta que no conteste no hay a dónde ir.
    if (resultado.ok && resultado.codigo) router.push(`/pedidos/${resultado.codigo}`);
  });

  return (
    <div className="px-4 py-5 md:px-6 md:py-6">
      <Button
        render={<Link href="/admin" />}
        nativeButton={false}
        variant="ghost"
        size="sm"
        className="text-muted-foreground -ml-2 mb-3 gap-1.5"
      >
        <ArrowLeft className="size-3.5" />
        Cancelar
      </Button>

      <header className="mb-5 flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Nuevo pedido</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            Los campos marcados con <span className="text-destructive">*</span> son obligatorios.
          </p>
        </div>
        <div className="ml-auto text-right">
          <p className="eyebrow">Código que se generará</p>
          <p className="text-primary mt-0.5 text-sm font-medium tabular-nums">{codigoPreview}</p>
        </div>
      </header>

      <form onSubmit={onSubmit} noValidate className="flex max-w-3xl flex-col gap-4">
        <Seccion n={1} titulo="Cliente y trabajo">
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo
              label="Nombre del cliente"
              requerido
              error={form.formState.errors.cliente?.message}
            >
              <Input
                autoFocus
                placeholder="Ej. Corporación Andina SAC"
                aria-invalid={!!form.formState.errors.cliente}
                {...form.register("cliente")}
              />
            </Campo>

            <Campo
              label="Teléfono del cliente"
              ayuda="Para avisar que el pedido está listo. El taller no lo ve."
            >
              <Input
                inputMode="tel"
                placeholder="9XX XXX XXX"
                className="tnum"
                {...form.register("telefonoCliente")}
              />
            </Campo>
          </div>

          <Campo
            grupo
            label="Tipo de pedido"
            requerido
            ayuda="Un pedido puede combinar varios trabajos."
            error={form.formState.errors.tipos?.message}
          >
            <Opciones
              valores={tipos}
              onToggle={alternarTipo}
              opciones={Object.entries(TIPOS).map(([valor, label]) => ({ valor, label }))}
            />
          </Campo>

          <AnimatePresence initial={false}>
            {tipos.includes("PT") && (
              <Condicional titulo="Porque incluye producto terminado">
                <Campo
                  label="Tipo de producto"
                  requerido
                  error={form.formState.errors.producto?.message}
                >
                  <Select
                    value={form.watch("producto") ?? ""}
                    onValueChange={(v) => v && form.setValue("producto", v as Campos["producto"])}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue>
                        {form.watch("producto")
                          ? PRODUCTOS[form.watch("producto")!]
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
              </Condicional>
            )}
          </AnimatePresence>

          <Campo
            label={`Cantidad (${unidadDe(tipos)})`}
            requerido
            ayuda={
              decimales
                ? "Las planchas admiten hasta 2 decimales: media plancha es 0.5."
                : "Número de piezas. Medidas, material y acabados van en el detalle."
            }
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

          <div className="grid gap-4 sm:grid-cols-2">
            <Campo
              label="Detalle del pedido"
              ayuda="Orden sugerido: Cantidad · Material · Marca · Espesor · Color · Formato. El texto es libre."
            >
              <Textarea
                rows={3}
                placeholder="Ej. 5 Acrílico Alfa 5mm transparente F7"
                {...form.register("detalle")}
              />
            </Campo>

            <Campo grupo label="Archivos de diseño" ayuda="Planos, PDF o imágenes del trabajo.">
              <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed p-4 text-center text-sm">
                <Upload className="mb-2 size-4 opacity-50" />
                Arrastra planos, PDF o imágenes
                <div className="mt-2">
                  <Button type="button" variant="outline" size="sm">
                    Elegir archivos
                  </Button>
                </div>
              </div>
            </Campo>
          </div>

          <Campo
            label="Observaciones"
            ayuda="Notas e incidencias del pedido. Lo que se produce va en el detalle."
          >
            <Textarea
              rows={2}
              placeholder="Ej. el cliente pasa a revisar la muestra el lunes"
              {...form.register("observaciones")}
            />
          </Campo>
        </Seccion>

        <Seccion n={2} titulo="Entrega" nota="Define si el pedido es local o de provincia">
          <Campo grupo label="¿A dónde va?" requerido>
            <Opciones
              valores={[destino]}
              onToggle={(v) => {
                form.setValue("destino", v as Campos["destino"]);
                form.setValue("entrega", v === "provincia" ? "agencia" : "tienda");
              }}
              opciones={[
                { valor: "local", label: "Entrega local" },
                { valor: "provincia", label: "Envío a provincia" },
              ]}
            />
          </Campo>

          {/* Sin mode="wait": si el bloque saliente no completa su exit, el entrante
              nunca llega a montarse y el formulario se queda sin los campos de envío. */}
          <AnimatePresence initial={false}>
            {destino === "provincia" ? (
              <Condicional key="prov" titulo="Datos del envío a provincia">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Campo
                    label="Departamento"
                    requerido
                    error={form.formState.errors.departamentoId?.message}
                  >
                    <Select
                      value={departamentoId ? String(departamentoId) : ""}
                      onValueChange={(v) => {
                        if (!v) return;
                        form.setValue("departamentoId", Number(v), { shouldValidate: true });
                        // Cambiar de departamento invalida la provincia anterior.
                        form.setValue("provinciaId", undefined);
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue>
                          {ubigeo.find((d) => d.id === departamentoId)?.nombre ?? "Selecciona…"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {ubigeo.map((d) => (
                          <SelectItem key={d.id} value={String(d.id)}>
                            {d.nombre}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Campo>
                  <Campo label="Provincia">
                    <Select
                      value={provinciaId ? String(provinciaId) : ""}
                      disabled={!departamentoId}
                      onValueChange={(v) => v && form.setValue("provinciaId", Number(v))}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue>
                          {provincias.find((x) => x.id === provinciaId)?.nombre ??
                            (departamentoId ? "Selecciona…" : "Elige el departamento")}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {provincias.map((x) => (
                          <SelectItem key={x.id} value={String(x.id)}>
                            {x.nombre}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Campo>
                </div>
                <Campo label="Nombre de la agencia">
                  <Input
                    placeholder="Ej. Shalom - Trujillo Centro"
                    {...form.register("agencia")}
                  />
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
                        form.setValue("tipoDocumento", v as Campos["tipoDocumento"]);
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
                    ayuda={documento.ayuda}
                    error={form.formState.errors.numeroDocumento?.message}
                  >
                    <Input
                      inputMode={tipoDocumento === "DNI" ? "numeric" : "text"}
                      maxLength={documento.largo}
                      className="tnum"
                      aria-invalid={!!form.formState.errors.numeroDocumento}
                      {...form.register("numeroDocumento")}
                    />
                  </Campo>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Campo label="Teléfono">
                    <Input
                      inputMode="tel"
                      placeholder="9XX XXX XXX"
                      {...form.register("telefono")}
                    />
                  </Campo>
                  <Campo label="Monto del flete">
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      className="tnum"
                      {...form.register("flete")}
                    />
                  </Campo>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Campo grupo label="Estado del flete">
                    <label className="flex cursor-pointer items-center gap-2.5 text-sm">
                      <Checkbox
                        checked={!!form.watch("fletePagado")}
                        onCheckedChange={(v) => form.setValue("fletePagado", v === true)}
                      />
                      El flete ya está pagado
                    </label>
                  </Campo>
                  <Campo label="Observaciones del envío" ayuda="Indicaciones para la agencia.">
                    <Input
                      placeholder="Ej. avisar una hora antes"
                      {...form.register("observacionesEnvio")}
                    />
                  </Campo>
                </div>
              </Condicional>
            ) : (
              <motion.div
                key="local"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.18 }}
                className="flex flex-col gap-4 overflow-hidden"
              >
                <Campo grupo label="Lugar de entrega" requerido>
                  <Opciones
                    valores={[entrega]}
                    onToggle={(v) => form.setValue("entrega", v as Campos["entrega"])}
                    opciones={[
                      { valor: "tienda", label: "En tienda" },
                      { valor: "taller", label: "En taller" },
                      { valor: "domicilio", label: "A domicilio" },
                    ]}
                  />
                </Campo>
                {entrega === "domicilio" && (
                  <Condicional titulo="Porque es a domicilio">
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
                  </Condicional>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          <Campo
            label="Fecha prometida"
            requerido
            ayuda="El taller ordena su trabajo por este campo."
            error={form.formState.errors.fechaPrometida?.message}
          >
            <Input
              type="date"
              className="tnum max-w-48"
              aria-invalid={!!form.formState.errors.fechaPrometida}
              {...form.register("fechaPrometida")}
            />
          </Campo>
        </Seccion>

        <Seccion n={3} titulo="Pago">
          <Campo grupo label="Tipo de pago" requerido>
            <Opciones
              valores={[tipoPago]}
              onToggle={(v) => form.setValue("tipoPago", v as Campos["tipoPago"])}
              opciones={Object.entries(PAGOS).map(([valor, label]) => ({ valor, label }))}
            />
          </Campo>

          <div className="grid gap-4 sm:grid-cols-2">
            <Campo
              label="Monto total"
              requerido
              error={form.formState.errors.montoTotal?.message}
            >
              <Input
                type="number"
                min={0}
                step="0.01"
                className="tnum"
                aria-invalid={!!form.formState.errors.montoTotal}
                {...form.register("montoTotal")}
              />
            </Campo>

            {/* El abono inicial solo tiene sentido a cuenta: al contado se cobra
                el total y al crédito no entra nada todavía. */}
            {tipoPago === "a_cuenta" && (
              <Campo
                label="Abono inicial"
                ayuda="Opcional. El saldo se calcula solo."
                error={form.formState.errors.abono?.message}
              >
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  className="tnum"
                  aria-invalid={!!form.formState.errors.abono}
                  {...form.register("abono")}
                />
              </Campo>
            )}
          </div>

          {tipoPago === "contado" && (
            <p className="text-muted-foreground text-xs">
              Al contado el pedido se registra pagado: el abono por el total queda hecho y el
              saldo empieza en cero.
            </p>
          )}

          {tipoPago === "credito" && (
            <Campo
              grupo
              label="Plazo del crédito"
              requerido
              ayuda={
                plazoCredito
                  ? `Vence el ${fechaCompleta(sumarDias(hoy(), plazoCredito))}, contado desde hoy.`
                  : "Días desde el registro del pedido."
              }
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
            </Campo>
          )}

          {cobraAhora && (
            <Campo
              label="Método de pago"
              ayuda={
                tipoPago === "contado"
                  ? `Por dónde entran los S/ ${montoTotal.toFixed(2)}.`
                  : `Por dónde entra el abono de S/ ${abono.toFixed(2)}.`
              }
            >
              <Select
                value={form.watch("metodoPago")}
                onValueChange={(v) => v && form.setValue("metodoPago", v as Campos["metodoPago"])}
              >
                <SelectTrigger className="w-full max-w-64">
                  <SelectValue>{METODOS[form.watch("metodoPago")]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(METODOS).map(([v, l]) => (
                    <SelectItem key={v} value={v}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>
          )}
        </Seccion>

        <Seccion n={4} titulo="Producción">
          <Campo
            label="Responsable en taller"
            ayuda="Opcional al registrar. Logística o Administración lo asignan después."
          >
            <Select
              value={form.watch("responsableId") ?? "sin"}
              onValueChange={(v) => v && form.setValue("responsableId", v === "sin" ? undefined : v)}
            >
              <SelectTrigger className="w-full max-w-64">
                <SelectValue>
                  {trabajadores.find((t) => t.id === form.watch("responsableId"))?.nombre ??
                    "Sin asignar todavía"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sin">Sin asignar todavía</SelectItem>
                {trabajadores.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>
        </Seccion>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={form.formState.isSubmitting || pendiente}>
            {form.formState.isSubmitting ? "Registrando…" : "Registrar pedido"}
          </Button>
          <Button type="button" variant="ghost" render={<Link href="/admin" />} nativeButton={false}>
            Cancelar
          </Button>
        </div>
      </form>
    </div>
  );
}

/* ── Piezas del formulario ── */

function Seccion({
  n,
  titulo,
  nota,
  children,
}: {
  n: number;
  titulo: string;
  nota?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-card rounded-xl border">
      <header className="bg-muted/40 flex items-center gap-2.5 border-b px-4 py-3">
        <span className="bg-primary text-primary-foreground grid size-5 shrink-0 place-items-center rounded-full text-2xs font-semibold">
          {n}
        </span>
        <h2 className="text-sm font-medium">{titulo}</h2>
        {nota && <span className="text-muted-foreground ml-auto text-xs">{nota}</span>}
      </header>
      <div className="flex flex-col gap-4 p-4">{children}</div>
    </section>
  );
}

function Condicional({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.18 }}
      className="overflow-hidden"
    >
      <div className="border-brand/60 bg-brand/[0.06] flex flex-col gap-4 rounded-r-lg border-l-2 p-3">
        <p className="eyebrow">{titulo}</p>
        {children}
      </div>
    </motion.div>
  );
}
