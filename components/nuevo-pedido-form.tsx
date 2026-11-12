"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, Factory, FileText, Package, Scissors, Store, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "@/lib/store";
import { subirAdjuntos } from "@/lib/adjuntos-navegador";
import { ACEPTA, validarArchivo } from "@/lib/adjuntos";
import { esquemaFormNuevoPedido, FORMATO_DOCUMENTO } from "@/lib/esquemas";
import { hoy } from "@/lib/fecha";
import {
  DOCUMENTOS,
  METODOS,
  PAGOS,
  PLAZOS,
  PRODUCTOS,
  TIPOS,
  siglaDe,
  sumarDias,
  type PlazoCredito,
  type TipoPedido,
} from "@/lib/dominio";
import { fechaCompleta, money, numero } from "@/lib/formato";
import type { LineaGuardada } from "@/lib/cotizaciones";
import type { GrupoPlancha } from "@/lib/cortes/catalogo";
import type { ConfigCortes } from "@/lib/cortes/config";
import {
  actualizarLinea,
  agregarProducto,
  cambiarCantidad,
  esCorte,
  esTerminado,
  ponerCorte,
  ponerTerminado,
  problemaDeLineas,
  quitarLinea,
  totalReferencial,
  type Linea,
} from "@/lib/lineas-cotizacion";
import type { ClienteOdoo, ProductoOdoo } from "@/lib/odoo/tipos";
import { cn } from "@/lib/utils";
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
import { BuscadorCliente } from "@/components/cotizaciones/buscador-cliente";
import { BuscadorProducto, CodigoProducto } from "@/components/cotizaciones/buscador-producto";
import { lineaParaEnviar } from "@/components/cotizaciones/form-cotizacion";
import { LineasCotizacion } from "@/components/cotizaciones/lineas-cotizacion";
import { CorteGuardadoVista } from "@/components/cortes/corte-guardado";
import { EditorCorte } from "@/components/cortes/editor-corte";
import { EditorTerminado } from "@/components/terminados/editor-terminado";
import { etiquetaDeTipo, type CatalogoTerminados } from "@/lib/terminados/catalogo";

const esquema = esquemaFormNuevoPedido;

type Campos = z.input<typeof esquema>;

/** Lo que el formulario toma de la cotización de la que sale el pedido. */
export interface DesdeCotizacion {
  id: string;
  /** Como se nombra: la referencia de Odoo (`S04254`). */
  referencia: string;
  cliente: { nombre: string; documento: string | null; telefono: string | null };
  lineas: LineaGuardada[];
  total: number;
  /** Si el total ya es el de Odoo, con impuestos. */
  totalEnOdoo: boolean;
}

/** Las dos respuestas a "¿para dónde va?". */
const DESTINOS = [
  { valor: "taller", label: "Taller", icono: Factory, ayuda: "Hay que fabricarlo o cortarlo" },
  { valor: "tienda", label: "Tienda", icono: Store, ayuda: "Se atiende y despacha desde tienda" },
] as const;

/**
 * Los tipos de pedido que sugieren las líneas: un corte láser es CL, uno manual
 * CM, y una plancha vendida entera SP. Lo demás (productos terminados,
 * accesorios) no se adivina por el nombre: lo marca quien registra.
 */
type LineaConTipo = { corte?: { modalidad: string } | null; terminado?: { tipoCodigo: string | null } | null };

function tiposDeLineas(lineas: LineaConTipo[]): TipoPedido[] {
  const tipos = new Set<TipoPedido>();
  for (const l of lineas) {
    if (l.corte?.modalidad === "laser") tipos.add("CL");
    else if (l.corte?.modalidad === "manual") tipos.add("CM");
    else if (l.terminado) tipos.add("PT");
  }
  return [...tipos];
}

/** El tipo de producto terminado que dicen las líneas: el suyo si coinciden, "otro" si hay de varios. */
function productoDeLineas(lineas: LineaConTipo[]) {
  const etiquetas = new Set(lineas.flatMap((l) => (l.terminado ? [etiquetaDeTipo(l.terminado.tipoCodigo)] : [])));
  if (etiquetas.size === 0) return undefined;
  return etiquetas.size === 1 ? [...etiquetas][0] : ("otro" as const);
}

const comoGuardadas = (lineas: Linea[]): LineaConTipo[] =>
  lineas.map((l) => ({
    corte: esCorte(l) ? { modalidad: l.modalidad } : null,
    terminado: esTerminado(l) ? { tipoCodigo: l.tipoCodigo } : null,
  }));

/**
 * Registrar un pedido. Se arma como una cotización —cliente y productos de
 * Odoo, y cortes a medida— más lo propio del pedido: a dónde va, cuándo y cómo
 * se paga. Al registrarlo, el servidor guarda la cotización, la crea y la
 * confirma en Odoo (que es lo que reserva el stock), y registra el pedido.
 */
export function NuevoPedidoForm({
  catalogo,
  config,
  terminados,
  desdeCotizacion,
}: {
  catalogo: GrupoPlancha[];
  config: ConfigCortes;
  /** El catálogo de productos terminados. */
  terminados: CatalogoTerminados;
  desdeCotizacion?: DesdeCotizacion;
}) {
  const router = useRouter();
  const volverA = desdeCotizacion ? `/cotizaciones/${desdeCotizacion.id}` : "/pedidos";
  const { permisos, registrarPedido, trabajadores, ubigeo, pendiente } = useStore();

  const [cliente, setCliente] = useState<ClienteOdoo | null>(null);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [corte, setCorte] = useState<{ clave: string | null } | null>(null);
  const [terminado, setTerminado] = useState<{ clave: string | null } | null>(null);
  const [resaltada, setResaltada] = useState<string | null>(null);
  const [errorLineas, setErrorLineas] = useState<string | null>(null);

  const buscadorCliente = useRef<HTMLInputElement>(null);
  const buscadorProducto = useRef<HTMLInputElement>(null);
  const cantidades = useRef(new Map<string, HTMLInputElement>());
  const temporizador = useRef<ReturnType<typeof setTimeout>>(undefined);
  const bloqueTrabajo = useRef<HTMLElement>(null);

  /* Los planos se quedan en memoria hasta que el pedido exista: la carpeta del
     bucket cuelga de su uuid, y el uuid lo pone Postgres al registrarlo. */
  const [archivos, setArchivos] = useState<File[]>([]);
  const entradaArchivos = useRef<HTMLInputElement>(null);
  /* "¿Para dónde va?" es una botonera, no un campo registrado: react-hook-form no
     sabe enfocarla cuando falta, y el error quedaría arriba, fuera de la vista. */
  const bloqueDestino = useRef<HTMLElement>(null);

  const anadir = (elegidos: File[]) => {
    const buenos: File[] = [];
    for (const archivo of elegidos) {
      const problema = validarArchivo(archivo);
      if (problema) toast.error("Ese archivo no vale", { description: problema });
      else buenos.push(archivo);
    }
    // Por nombre y tamaño: elegir dos veces la misma carpeta es lo normal.
    setArchivos((previos) => [
      ...previos,
      ...buenos.filter((b) => !previos.some((p) => p.name === b.name && p.size === b.size)),
    ]);
  };

  const form = useForm<Campos>({
    resolver: zodResolver(esquema),
    mode: "onTouched",
    defaultValues: {
      tipos: desdeCotizacion ? tiposDeLineas(desdeCotizacion.lineas) : [],
      producto: desdeCotizacion ? productoDeLineas(desdeCotizacion.lineas) : undefined,
      destino: "local",
      entrega: "tienda",
      // No se presupone: hay que elegir taller o tienda.
      ubicacion: undefined,
      tipoDocumento: "DNI",
      fletePagado: false,
      fechaPrometida: "",
      tipoPago: "a_cuenta",
      metodoPago: "efectivo",
      indicaciones: "",
      observaciones: "",
    },
  });

  const tipos = (form.watch("tipos") ?? []) as TipoPedido[];
  const destino = form.watch("destino");
  const entrega = form.watch("entrega");
  const ubicacion = form.watch("ubicacion");
  const tipoPago = form.watch("tipoPago");
  const tipoDocumento = form.watch("tipoDocumento");
  /* La provincia cuelga del departamento con una FK compuesta en la base, así que
     la lista se recorta al departamento elegido en vez de ser texto libre. */
  const departamentoId = Number(form.watch("departamentoId")) || null;
  const provinciaId = Number(form.watch("provinciaId")) || null;
  const provincias = ubigeo.find((d) => d.id === departamentoId)?.provincias ?? [];
  const plazoCredito = Number(form.watch("plazoCredito")) || null;
  const abono = Number(form.watch("abono")) || 0;
  const total = desdeCotizacion ? desdeCotizacion.total : totalReferencial(lineas);

  // Un pedido que combina trabajos lleva "MX": el código se dicta por teléfono.
  const codigoPreview = `${destino === "provincia" ? "P" : "L"}${
    tipos.length ? siglaDe(tipos) : "··"
  }_${hoy().slice(0, 4)}_····`;

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

  /** Las líneas cambiaron: los tipos que sugieren se suman a los marcados. */
  const ponerLineas = (siguientes: Linea[]) => {
    setLineas(siguientes);
    setErrorLineas(null);
    const sugeridos = tiposDeLineas(comoGuardadas(siguientes));
    const actuales = (form.getValues("tipos") ?? []) as TipoPedido[];
    const faltan = sugeridos.filter((t) => !actuales.includes(t));
    if (faltan.length) form.setValue("tipos", [...actuales, ...faltan], { shouldValidate: form.formState.isSubmitted });
    // El tipo de producto terminado lo dicen las líneas: no hace falta elegirlo.
    const producto = productoDeLineas(comoGuardadas(siguientes));
    if (producto) form.setValue("producto", producto, { shouldValidate: form.formState.isSubmitted });
  };

  const marcar = (clave: string) => {
    setResaltada(clave);
    clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => setResaltada(null), 1200);
  };

  const elegirCliente = (c: ClienteOdoo | null) => {
    flushSync(() => setCliente(c));
    if (c) buscadorProducto.current?.focus();
  };

  const agregar = (p: ProductoOdoo) => {
    const { lineas: siguientes, clave } = agregarProducto(lineas, p);
    flushSync(() => ponerLineas(siguientes));
    marcar(clave);
    const input = cantidades.current.get(clave);
    input?.focus();
    input?.select();
  };

  const refCantidad = useCallback((clave: string, el: HTMLInputElement | null) => {
    if (el) cantidades.current.set(clave, el);
    else cantidades.current.delete(clave);
  }, []);

  if (!permisos.crearPedido || !permisos.gestionarCotizaciones) {
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

  /** Lo que falta del cliente y las líneas, que no pasan por react-hook-form. */
  const problemaDeTrabajo = (): string | null => {
    if (desdeCotizacion) return null;
    if (!cliente) return "Elige el cliente.";
    return problemaDeLineas(lineas)?.replace("Agrega al menos un producto.", "Agrega al menos un producto o un corte.") ?? null;
  };

  const irAlTrabajo = () => {
    bloqueTrabajo.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (!cliente) buscadorCliente.current?.focus({ preventScroll: true });
    else buscadorProducto.current?.focus({ preventScroll: true });
  };

  const onSubmit = form.handleSubmit(
    async (v) => {
      const problema = problemaDeTrabajo();
      if (problema) {
        setErrorLineas(problema);
        irAlTrabajo();
        return;
      }

      const esProvincia = v.destino === "provincia";
      const resultado = await registrarPedido(
        {
          cotizacionId: desdeCotizacion?.id ?? null,
          clienteId: desdeCotizacion ? null : cliente!.id,
          lineas: desdeCotizacion ? null : lineas.map(lineaParaEnviar),
          tipos: v.tipos as TipoPedido[],
          producto: v.tipos.includes("PT") ? (v.producto ?? null) : null,
          esProvincia,
          entrega: esProvincia ? "agencia" : v.entrega,
          ubicacion: v.ubicacion,
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
          plazoCredito:
            v.tipoPago === "credito" ? ((Number(v.plazoCredito) || null) as PlazoCredito | null) : null,
          // Al crédito no entra nada al registrar, aunque el campo de abono conserve lo
          // que se hubiera tecleado antes de cambiar el tipo de pago.
          abonoInicial: v.tipoPago === "credito" ? 0 : Number(v.abono ?? 0),
          metodoPago: v.metodoPago,
          responsableId: v.responsableId || null,
          indicaciones: v.indicaciones || null,
          observaciones: v.observaciones || null,
        },
        desdeCotizacion?.cliente.nombre ?? cliente?.nombre ?? "",
      );
      // El código lo pone Postgres, así que hasta que no conteste no hay a dónde ir.
      if (!resultado.ok || !resultado.codigo) return;

      /* Los planos van después del alta y no antes: hasta aquí no había pedido al
         que colgarlos. Si alguno falla, el pedido ya está registrado y se dice
         cuál faltó; perder el alta por un archivo sería mucho peor. */
      if (archivos.length > 0) {
        const { errores } = await subirAdjuntos(resultado.codigo, "diseno", archivos);
        for (const error of errores) {
          toast.error("El pedido se registró, pero un archivo no subió", { description: error });
        }
      }

      router.push(`/pedidos/${resultado.codigo}`);
    },
    (errores) => {
      const problema = problemaDeTrabajo();
      if (problema) {
        setErrorLineas(problema);
        irAlTrabajo();
        return;
      }
      if (!errores.ubicacion || !bloqueDestino.current) return;
      bloqueDestino.current.scrollIntoView({ behavior: "smooth", block: "center" });
      bloqueDestino.current.querySelector("button")?.focus({ preventScroll: true });
    },
  );

  return (
    <div className="px-4 py-5 md:px-6 md:py-6">
      <Button
        render={<Link href={volverA} />}
        nativeButton={false}
        variant="ghost"
        size="sm"
        className="text-muted-foreground -ml-2 mb-3 gap-1.5"
      >
        <ArrowLeft className="size-3.5" />
        {desdeCotizacion ? `Volver a ${desdeCotizacion.referencia}` : "Cancelar"}
      </Button>

      <header className="mb-5 flex flex-wrap items-end gap-4">
        <div>
          {desdeCotizacion && (
            <p className="eyebrow flex items-center gap-1.5">
              <FileText className="size-3" />
              Desde la cotización {desdeCotizacion.referencia}
            </p>
          )}
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

      <form
        onSubmit={onSubmit}
        noValidate
        className="flex max-w-3xl flex-col gap-4"
        onKeyDown={(e) => {
          // Enter en un buscador o en una cantidad no envía el pedido.
          if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLButtonElement)) {
            e.preventDefault();
          }
        }}
      >
        <section ref={bloqueDestino} className="bg-card rounded-xl border p-4">
          <Campo
            grupo
            label="¿Para dónde va el pedido?"
            requerido
            ayuda="Decide si aparece en la vista del taller o en la de la tienda."
            error={form.formState.errors.ubicacion?.message}
          >
            <div className="grid gap-2 sm:grid-cols-2">
              {DESTINOS.map(({ valor, label, icono: Icono, ayuda }) => {
                const activo = ubicacion === valor;
                return (
                  <button
                    key={valor}
                    type="button"
                    aria-pressed={activo}
                    onClick={() => form.setValue("ubicacion", valor, { shouldValidate: true })}
                    className={cn(
                      "flex items-center gap-3 rounded-lg border p-3 text-left transition-colors",
                      "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
                      activo ? "border-primary/50 bg-primary/8" : "hover:border-foreground/20",
                      form.formState.errors.ubicacion && !activo && "border-destructive/40",
                    )}
                  >
                    <span
                      className={cn(
                        "grid size-9 shrink-0 place-items-center rounded-md",
                        activo ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                      )}
                    >
                      <Icono className="size-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{label}</span>
                      <span className="text-muted-foreground block text-xs">{ayuda}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </Campo>
        </section>

        <Seccion n={1} titulo="Cliente y productos" refSeccion={bloqueTrabajo}>
          {desdeCotizacion ? (
            <DeLaCotizacion d={desdeCotizacion} />
          ) : (
            <>
              <BuscadorCliente cliente={cliente} alElegir={elegirCliente} inputRef={buscadorCliente} />
              {/* En una sola fila siempre: si el botón bajara de línea, la lista de
                  resultados del buscador lo taparía. */}
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <BuscadorProducto alAgregar={agregar} inputRef={buscadorProducto} />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 shrink-0 gap-1.5"
                  aria-label="Corte a medida"
                  onClick={() => setCorte({ clave: null })}
                  disabled={catalogo.length === 0}
                  title={catalogo.length === 0 ? "No hay planchas en el catálogo" : undefined}
                >
                  <Scissors />
                  Corte<span className="hidden sm:inline"> a medida</span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 shrink-0 gap-1.5"
                  aria-label="Producto terminado"
                  onClick={() => setTerminado({ clave: null })}
                >
                  <Package />
                  <span className="hidden sm:inline">Producto </span>terminado
                </Button>
              </div>
              <LineasCotizacion
                lineas={lineas}
                resaltada={resaltada}
                refCantidad={refCantidad}
                alCambiar={(clave, cambios) => ponerLineas(actualizarLinea(lineas, clave, cambios))}
                alCambiarCantidad={(clave, delta) => ponerLineas(cambiarCantidad(lineas, clave, delta))}
                alQuitar={(clave) => {
                  ponerLineas(quitarLinea(lineas, clave));
                  buscadorProducto.current?.focus();
                }}
                alEditarCorte={(clave) => setCorte({ clave })}
                alEditarTerminado={(clave) => setTerminado({ clave })}
                alTerminar={() => buscadorProducto.current?.focus()}
              />
            </>
          )}
          {errorLineas && (
            <p role="alert" className="text-destructive text-sm">
              {errorLineas}
            </p>
          )}
        </Seccion>

        <Seccion n={2} titulo="Trabajo">
          <Campo
            grupo
            label="Tipo de pedido"
            requerido
            ayuda="Los cortes ya marcan el suyo. Agrega lo que falte: un pedido puede combinar varios trabajos."
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
                <Campo label="Tipo de producto" requerido error={form.formState.errors.producto?.message}>
                  <Select
                    value={form.watch("producto") ?? ""}
                    onValueChange={(v) => v && form.setValue("producto", v as Campos["producto"])}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue>
                        {form.watch("producto") ? PRODUCTOS[form.watch("producto")!] : "Selecciona…"}
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

          <div className="grid gap-4 sm:grid-cols-2">
            <Campo
              label="Indicaciones para el taller"
              ayuda="Lo que no dicen los productos: acabados, pegado, cómo se entrega. Se suma al detalle."
              error={form.formState.errors.indicaciones?.message}
            >
              <Textarea
                rows={3}
                placeholder="Ej. bordes pulidos; entregar con film"
                {...form.register("indicaciones")}
              />
            </Campo>

            <Campo
              grupo
              label="Archivos de diseño"
              ayuda="Planos, PDF o imágenes del trabajo. Hasta 10 MB cada uno."
            >
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  anadir(Array.from(e.dataTransfer.files));
                }}
                className="text-muted-foreground flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed p-4 text-center text-sm"
              >
                <Upload className="mb-2 size-4 opacity-50" />
                Arrastra planos, PDF o imágenes
                <input
                  ref={entradaArchivos}
                  type="file"
                  multiple
                  accept={ACEPTA}
                  className="sr-only"
                  aria-label="Elegir archivos de diseño"
                  onChange={(e) => {
                    anadir(Array.from(e.target.files ?? []));
                    e.target.value = "";
                  }}
                />
                <div className="mt-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => entradaArchivos.current?.click()}
                  >
                    Elegir archivos
                  </Button>
                </div>

                {archivos.length > 0 && (
                  <ul className="mt-3 flex w-full flex-col gap-1">
                    {archivos.map((archivo) => (
                      <li
                        key={`${archivo.name}-${archivo.size}`}
                        className="bg-muted/40 flex items-center gap-2 rounded-md py-1 pr-1 pl-2 text-left"
                      >
                        <span className="min-w-0 flex-1 truncate text-xs">{archivo.name}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-6 shrink-0"
                          aria-label={`Quitar ${archivo.name}`}
                          onClick={() =>
                            setArchivos((previos) => previos.filter((p) => p !== archivo))
                          }
                        >
                          <X className="size-3" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Campo>
          </div>

          <Campo
            label="Observaciones"
            ayuda="Notas e incidencias del pedido. Lo que se produce va en las líneas y las indicaciones."
          >
            <Textarea
              rows={2}
              placeholder="Ej. el cliente pasa a revisar la muestra el lunes"
              {...form.register("observaciones")}
            />
          </Campo>
        </Seccion>

        <Seccion n={3} titulo="Entrega" nota="Define si el pedido es local o de provincia">
          <Campo grupo label="¿A dónde va?" requerido>
            <Opciones
              valores={[destino]}
              onToggle={(v) => {
                form.setValue("destino", v as Campos["destino"]);
                form.setValue("entrega", v === "provincia" ? "agencia" : "tienda");
              }}
              opciones={[
                { valor: "local", label: "Lima" },
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

        <Seccion n={4} titulo="Pago">
          <Campo grupo label="Tipo de pago" requerido>
            <Opciones
              valores={[tipoPago]}
              onToggle={(v) => form.setValue("tipoPago", v as Campos["tipoPago"])}
              opciones={Object.entries(PAGOS).map(([valor, label]) => ({ valor, label }))}
            />
          </Campo>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium">Total</p>
              <p className="tnum flex h-9 items-center text-base font-semibold" data-testid="total-pedido">
                {money(total)}
              </p>
              <p className="text-muted-foreground text-xs">
                {desdeCotizacion?.totalEnOdoo
                  ? "El de la cotización en Odoo, con impuestos."
                  : "Sin impuestos. El definitivo lo pone Odoo al registrar."}
              </p>
            </div>

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
                  ? `Por dónde entran los ${money(total)}.`
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

        <Seccion n={5} titulo="Producción">
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
            {form.formState.isSubmitting ? "Registrando en Odoo…" : "Registrar pedido"}
          </Button>
          <Button type="button" variant="ghost" render={<Link href={volverA} />} nativeButton={false}>
            Cancelar
          </Button>
        </div>
      </form>

      {corte && (
        <EditorCorte
          catalogo={catalogo}
          config={config}
          inicial={lineas.filter(esCorte).find((l) => l.clave === corte.clave) ?? null}
          alCerrar={() => setCorte(null)}
          alGuardar={(nuevo) => {
            const { lineas: siguientes, clave } = ponerCorte(lineas, nuevo);
            ponerLineas(siguientes);
            setCorte(null);
            marcar(clave);
            requestAnimationFrame(() => buscadorProducto.current?.focus());
          }}
        />
      )}

      {terminado && (
        <EditorTerminado
          catalogo={terminados}
          planchas={catalogo}
          inicial={lineas.filter(esTerminado).find((l) => l.clave === terminado.clave) ?? null}
          alCerrar={() => setTerminado(null)}
          alGuardar={(nuevo) => {
            const { lineas: siguientes, clave } = ponerTerminado(lineas, nuevo);
            ponerLineas(siguientes);
            setTerminado(null);
            marcar(clave);
            requestAnimationFrame(() => buscadorProducto.current?.focus());
          }}
        />
      )}
    </div>
  );
}

/** Lo que viene de la cotización: no se edita aquí; para cambiarlo, otra cotización. */
function DeLaCotizacion({ d }: { d: DesdeCotizacion }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="bg-muted/40 rounded-lg border px-3 py-2.5">
        <p className="text-sm font-medium">{d.cliente.nombre}</p>
        <p className="text-muted-foreground tnum mt-0.5 flex flex-wrap gap-x-3 text-xs">
          {d.cliente.documento && <span>{d.cliente.documento}</span>}
          {d.cliente.telefono && <span>{d.cliente.telefono}</span>}
        </p>
      </div>
      <ul className="divide-y rounded-lg border" aria-label="Productos de la cotización">
        {d.lineas.map((l) =>
          l.corte ? (
            <li key={l.posicion} className="px-3 py-3">
              <CorteGuardadoVista corte={l.corte} conPrecios={false} />
              <p className="tnum mt-2 text-right text-sm font-medium">{money(l.importe)}</p>
            </li>
          ) : (
            <li key={l.posicion} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  {l.codigo && <CodigoProducto codigo={l.codigo} />}
                  <span className="font-medium">{l.nombre}</span>
                </p>
                {l.descripcion && <p className="text-muted-foreground mt-1 text-xs">{l.descripcion}</p>}
              </div>
              <p className="tnum text-muted-foreground text-sm">
                {numero(l.cantidad)} × {money(l.precioUnitario)}
              </p>
              <p className="tnum w-24 text-right text-sm font-medium">{money(l.importe)}</p>
            </li>
          ),
        )}
      </ul>
      <p className="text-muted-foreground text-xs">
        Lo cotizado no se cambia aquí: si algo cambió, haz una cotización nueva.
      </p>
    </div>
  );
}

/* ── Piezas del formulario ── */

function Seccion({
  n,
  titulo,
  nota,
  refSeccion,
  children,
}: {
  n: number;
  titulo: string;
  nota?: string;
  refSeccion?: React.Ref<HTMLElement>;
  children: React.ReactNode;
}) {
  return (
    <section ref={refSeccion} className="bg-card rounded-xl border">
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
