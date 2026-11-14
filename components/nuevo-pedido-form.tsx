"use client";

import { useCallback, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AnimatePresence, motion } from "motion/react";
import { Factory, FileText, Loader2, NotebookPen, Package, Scissors, Store, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "@/lib/store";
import { subirAdjuntos } from "@/lib/adjuntos-navegador";
import { ACEPTA, validarArchivo } from "@/lib/adjuntos";
import { esquemaFormNuevoPedido, FORMATO_DOCUMENTO } from "@/lib/esquemas";
import { hoy } from "@/lib/fecha";
import { DOCUMENTOS, METODOS, PAGOS, PLAZOS, sumarDias, type PlazoCredito } from "@/lib/dominio";
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
import { BarraEnvio } from "@/components/ui/barra-envio";
import { CabeceraFormulario } from "@/components/ui/cabecera-formulario";
import { Seccion } from "@/components/ui/seccion";
import { useAvisoSalida } from "@/lib/use-aviso-salida";
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
import { IndicacionesDeLinea, LineasCotizacion } from "@/components/cotizaciones/lineas-cotizacion";
import { tituloCorte } from "@/lib/cortes/guardado";
import { tituloTerminado } from "@/lib/terminados/guardado";
import { CorteGuardadoVista } from "@/components/cortes/corte-guardado";
import { EditorCorte } from "@/components/cortes/editor-corte";
import { EditorTerminado } from "@/components/terminados/editor-terminado";
import { DisenadorTerminado, type DatosDiseno } from "@/components/terminados/disenador-terminado";
import { abrirDiseno, crearDiseno } from "@/app/(app)/disenos/acciones";
import type { CatalogoTerminados } from "@/lib/terminados/catalogo";

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

/** Los campos que pueden fallar, en el orden en que aparecen en pantalla. */
const ORDEN_ERRORES = [
  "ubicacion",
  "departamentoId",
  "numeroDocumento",
  "direccion",
  "fechaPrometida",
  "abono",
  "plazoCredito",
  "notas",
] as const;

/** Las dos respuestas a "¿qué área lo atiende?". */
const DESTINOS = [
  { valor: "taller", label: "Taller", icono: Factory, ayuda: "Hay que fabricarlo o cortarlo" },
  { valor: "tienda", label: "Tienda", icono: Store, ayuda: "Se atiende y despacha desde tienda" },
] as const;

/** El ítem de un pedido al que se puede ligar un archivo o escribir indicaciones. */
interface Item {
  /** Lo que identifica al ítem en pantalla: la clave de la línea o su posición. */
  clave: string;
  /** Su posición en el pedido (1 = la primera): lo que se guarda en la base. */
  posicion: number;
  nombre: string;
}

/** Un archivo de diseño por subir y el ítem al que se refiere (`null`: es del pedido entero). */
interface ArchivoElegido {
  archivo: File;
  itemClave: string | null;
}

const GENERAL = "general";

const ID_FORM = "form-nuevo-pedido";

/** Las fechas prometidas de siempre, a un toque. */
const ATAJOS_FECHA = [
  { dias: 0, label: "Hoy" },
  { dias: 1, label: "Mañana" },
  { dias: 3, label: "En 3 días" },
  { dias: 7, label: "En una semana" },
] as const;

const conDiaDeSemana = new Intl.DateTimeFormat("es-PE", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

/** `2026-11-14` → "Sábado 14 de noviembre". */
function diaConNombre(iso: string) {
  const texto = conDiaDeSemana.format(new Date(`${iso}T00:00:00Z`));
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

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
  diseno,
  desdeCotizacion,
}: {
  catalogo: GrupoPlancha[];
  config: ConfigCortes;
  /** El catálogo de productos terminados. */
  terminados: CatalogoTerminados;
  /** Para diseñar los productos terminados con el motor CAD (la vista de /disenos). */
  diseno: DatosDiseno;
  desdeCotizacion?: DesdeCotizacion;
}) {
  const router = useRouter();
  const volverA = desdeCotizacion ? `/cotizaciones/${desdeCotizacion.id}` : "/pedidos";
  const { permisos, registrarPedido, trabajadores, ubigeo, pendiente } = useStore();

  const [cliente, setCliente] = useState<ClienteOdoo | null>(null);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [corte, setCorte] = useState<{ clave: string | null } | null>(null);
  /** Un terminado sin diseño (de antes): se edita en el formulario de siempre. */
  const [terminado, setTerminado] = useState<{ clave: string | null } | null>(null);
  /** El producto terminado que se está diseñando, a pantalla completa. */
  const [disenando, setDisenando] = useState<{
    disenoId: string;
    nuevo: boolean;
    inicial: Awaited<ReturnType<typeof abrirDiseno>> | null;
    clave: string | null;
  } | null>(null);
  const [abriendoDiseno, setAbriendoDiseno] = useState(false);
  /** El diseño de cada línea de terminado, por su clave: para volver a abrirlo al editar. */
  const [disenosDeLinea, setDisenosDeLinea] = useState<Record<string, string>>({});

  const nuevoTerminado = async () => {
    if (abriendoDiseno) return;
    setAbriendoDiseno(true);
    try {
      const { id } = await crearDiseno();
      setDisenando({ disenoId: id, nuevo: true, inicial: null, clave: null });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo empezar el diseño.");
    } finally {
      setAbriendoDiseno(false);
    }
  };

  const editarTerminado = async (clave: string) => {
    const disenoId = disenosDeLinea[clave];
    if (!disenoId) return setTerminado({ clave });
    if (abriendoDiseno) return;
    setAbriendoDiseno(true);
    try {
      setDisenando({ disenoId, nuevo: false, inicial: await abrirDiseno(disenoId), clave });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo abrir el diseño.");
    } finally {
      setAbriendoDiseno(false);
    }
  };
  const [resaltada, setResaltada] = useState<string | null>(null);
  const [errorLineas, setErrorLineas] = useState<string | null>(null);

  const buscadorCliente = useRef<HTMLInputElement>(null);
  const buscadorProducto = useRef<HTMLInputElement>(null);
  const cantidades = useRef(new Map<string, HTMLInputElement>());
  const temporizador = useRef<ReturnType<typeof setTimeout>>(undefined);
  const bloqueTrabajo = useRef<HTMLElement>(null);

  /* Los planos se quedan en memoria hasta que el pedido exista: la carpeta del
     bucket cuelga de su uuid, y el uuid lo pone Postgres al registrarlo. */
  const [archivos, setArchivos] = useState<ArchivoElegido[]>([]);
  /* Las indicaciones de cada ítem para el taller, por su clave. */
  const [indicaciones, setIndicaciones] = useState<Record<string, string>>({});
  const entradaArchivos = useRef<HTMLInputElement>(null);
  const [arrastrando, setArrastrando] = useState(false);
  const [conObservaciones, setConObservaciones] = useState(false);
  const [registrado, setRegistrado] = useState(false);
  const refForm = useRef<HTMLFormElement>(null);
  /* Los controles que no son inputs registrados (botoneras, Select): cuando
     fallan, react-hook-form no sabe llevar el foco hasta ellos. */
  const bloqueDepartamento = useRef<HTMLDivElement>(null);
  const bloquePlazo = useRef<HTMLDivElement>(null);
  /* "¿Para dónde va?" es una botonera, no un campo registrado: react-hook-form no
     sabe enfocarla cuando falta, y el error quedaría arriba, fuera de la vista. */
  const bloqueDestino = useRef<HTMLDivElement>(null);

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
      ...buenos
        .filter((b) => !previos.some((p) => p.archivo.name === b.name && p.archivo.size === b.size))
        .map((archivo) => ({ archivo, itemClave: null })),
    ]);
  };

  const form = useForm<Campos>({
    resolver: zodResolver(esquema),
    mode: "onTouched",
    defaultValues: {
      destino: "local",
      entrega: "tienda",
      // No se presupone: hay que elegir taller o tienda.
      ubicacion: undefined,
      tipoDocumento: "DNI",
      fletePagado: false,
      fechaPrometida: "",
      tipoPago: "a_cuenta",
      metodoPago: "efectivo",
      notas: "",
      observaciones: "",
    },
  });

  /* Los ítems del pedido, tal como se numeran al guardarlo: la posición de cada
     línea es su lugar en la lista más uno. */
  const items: Item[] = desdeCotizacion
    ? desdeCotizacion.lineas.map((l) => ({
        clave: String(l.posicion),
        posicion: l.posicion,
        nombre: l.corte ? tituloCorte(l.corte) : l.terminado ? tituloTerminado(l.terminado) : l.nombre,
      }))
    : lineas.map((l, i) => ({
        clave: l.clave,
        posicion: i + 1,
        nombre: esCorte(l) ? tituloCorte(l) : l.nombre,
      }));

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
  const fechaPrometida = form.watch("fechaPrometida");
  const direccion = form.watch("direccion") ?? "";
  const total = desdeCotizacion ? desdeCotizacion.total : totalReferencial(lineas);
  const saldo = Math.max(0, total - abono);
  const hoyIso = hoy();

  // P, año y mes: el correlativo lo pone Postgres al registrar.
  const codigoPreview = `P${hoyIso.slice(2, 4)}${hoyIso.slice(5, 7)}-···`;

  const documento = FORMATO_DOCUMENTO[tipoDocumento];

  /** Hay dinero de entrada, así que hay que decir por dónde entró. */
  const cobraAhora = tipoPago === "contado" || (tipoPago === "a_cuenta" && abono > 0);

  const ponerLineas = (siguientes: Linea[]) => {
    setLineas(siguientes);
    setErrorLineas(null);
    // Un archivo ligado a un ítem que ya no está pasa a ser del pedido entero.
    setArchivos((previos) =>
      previos.map((a) => (a.itemClave && !siguientes.some((l) => l.clave === a.itemClave) ? { ...a, itemClave: null } : a)),
    );
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

  /* Lo que va completo, para marcar cada sección y decir en la barra qué falta. */
  const problemaLineas = desdeCotizacion
    ? null
    : !cliente
      ? "Elige el cliente."
      : (problemaDeLineas(lineas)?.replace("Agrega al menos un producto.", "Agrega al menos un producto o un corte.") ?? null);
  const trabajoListo = !problemaLineas;
  const problemaEntrega = !ubicacion
    ? "Elige el área que atiende el pedido."
    : destino === "provincia" && !departamentoId
      ? "Elige el departamento del envío."
      : destino === "local" && entrega === "domicilio" && !direccion.trim()
        ? "Falta la dirección de entrega."
        : !fechaPrometida
          ? "Pon la fecha prometida."
          : fechaPrometida < hoyIso
            ? "La fecha prometida ya pasó."
            : null;
  const entregaLista = !problemaEntrega;
  const problemaPago =
    tipoPago === "credito" && !plazoCredito
      ? "Elige el plazo del crédito."
      : tipoPago === "a_cuenta" && abono > total && total > 0
        ? "El abono pasa el total."
        : null;
  const pagoListo = !problemaPago;
  const faltante = problemaLineas ?? problemaEntrega ?? problemaPago;

  const resumenBarra =
    tipoPago === "a_cuenta" && abono > 0
      ? [
          { etiqueta: "Total", valor: money(total) },
          { etiqueta: "Abono", valor: money(abono) },
          { etiqueta: "Saldo", valor: money(saldo) },
        ]
      : [
          { etiqueta: desdeCotizacion ? "Ítems" : lineas.length === 1 ? "Ítem" : "Ítems", valor: String(items.length) },
          { etiqueta: "Total", valor: money(total) },
        ];

  useAvisoSalida(!registrado && (!!cliente || lineas.length > 0 || archivos.length > 0 || form.formState.isDirty));

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
  const problemaDeTrabajo = () => problemaLineas;

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

      // El abono no puede pasar lo que cuesta el pedido.
      if (v.tipoPago === "a_cuenta" && Number(v.abono ?? 0) > total) {
        form.setError("abono", { message: `No puede pasar el total (${money(total)}).` }, { shouldFocus: true });
        return;
      }

      const esProvincia = v.destino === "provincia";
      const resultado = await registrarPedido(
        {
          cotizacionId: desdeCotizacion?.id ?? null,
          clienteId: desdeCotizacion ? null : cliente!.id,
          lineas: desdeCotizacion ? null : lineas.map(lineaParaEnviar),
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
          notas: v.notas || null,
          indicacionesLineas: items.flatMap((i) => {
            const texto = (indicaciones[i.clave] ?? "").trim();
            return texto ? [{ posicion: i.posicion, texto }] : [];
          }),
          observaciones: v.observaciones || null,
        },
        desdeCotizacion?.cliente.nombre ?? cliente?.nombre ?? "",
      );
      // El código lo pone Postgres, así que hasta que no conteste no hay a dónde ir.
      if (!resultado.ok || !resultado.codigo) return;
      setRegistrado(true);

      /* Los planos van después del alta y no antes: hasta aquí no había pedido al
         que colgarlos. Si alguno falla, el pedido ya está registrado y se dice
         cuál faltó; perder el alta por un archivo sería mucho peor. */
      if (archivos.length > 0) {
        const { errores } = await subirAdjuntos(
          resultado.codigo,
          "diseno",
          archivos.map((a) => ({
            archivo: a.archivo,
            lineaPosicion: items.find((i) => i.clave === a.itemClave)?.posicion ?? null,
          })),
        );
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
      /* react-hook-form ya llevó el foco al primer input registrado que falló.
         Si lo primero que falta (en el orden de la pantalla) es una botonera o
         un Select, el foco va ahí, que si no queda fuera de la vista. */
      const primero = ORDEN_ERRORES.find((campo) => errores[campo]);
      const bloque =
        primero === "ubicacion"
          ? bloqueDestino.current
          : primero === "departamentoId"
            ? bloqueDepartamento.current
            : primero === "plazoCredito"
              ? bloquePlazo.current
              : null;
      if (!bloque) return;
      bloque.scrollIntoView({ behavior: "smooth", block: "center" });
      bloque.querySelector<HTMLElement>("button, [role=combobox]")?.focus({ preventScroll: true });
    },
  );

  return (
    <div className="px-4 py-5 md:px-6 md:py-6">
      <CabeceraFormulario
        volverA={volverA}
        volverTexto={desdeCotizacion ? `Volver a ${desdeCotizacion.referencia}` : "Pedidos"}
        eyebrow={
          desdeCotizacion && (
            <>
              <FileText className="size-3" />
              Desde la cotización {desdeCotizacion.referencia}
            </>
          )
        }
        titulo="Nuevo pedido"
        subtitulo={
          <>
            Los campos marcados con <span className="text-[#ffc200]">*</span> son obligatorios.
          </>
        }
        lateral={
          <div className="text-right">
            <p className="text-2xs font-medium tracking-[0.08em] text-white/65 uppercase">Código que se generará</p>
            <p className="tnum mt-1 inline-block rounded-md bg-[#ffc200] px-2 py-0.5 text-sm font-semibold text-[#3b2a00]">
              {codigoPreview}
            </p>
          </div>
        }
      />

      <form
        id={ID_FORM}
        ref={refForm}
        onSubmit={onSubmit}
        noValidate
        className="relative -mt-10 flex max-w-3xl flex-col gap-4"
        onKeyDown={(e) => {
          // Ctrl/⌘ + Enter registra desde cualquier campo, como en la cotización.
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            refForm.current?.requestSubmit();
            return;
          }
          // Enter en un buscador o en una cantidad no envía el pedido.
          if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLButtonElement)) {
            e.preventDefault();
          }
        }}
      >
        <Seccion n={1} titulo="Cliente y productos" refSeccion={bloqueTrabajo} completa={trabajoListo}>
          {desdeCotizacion ? (
            <DeLaCotizacion
              d={desdeCotizacion}
              indicaciones={indicaciones}
              alCambiarIndicaciones={(clave, texto) => setIndicaciones((previas) => ({ ...previas, [clave]: texto }))}
            />
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
                  onClick={() => void nuevoTerminado()}
                  disabled={abriendoDiseno}
                >
                  {abriendoDiseno ? <Loader2 className="animate-spin" /> : <Package />}
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
                alEditarTerminado={(clave) => void editarTerminado(clave)}
                alTerminar={() => buscadorProducto.current?.focus()}
                indicaciones={indicaciones}
                alCambiarIndicaciones={(clave, texto) => setIndicaciones((previas) => ({ ...previas, [clave]: texto }))}
              />
            </>
          )}
          {errorLineas && (
            <p role="alert" className="text-destructive text-sm">
              {errorLineas}
            </p>
          )}
        </Seccion>

        <Seccion n={2} titulo="Entrega" completa={entregaLista}>
          <div ref={bloqueDestino} className="scroll-mt-24">
            <Campo
              grupo
              label="Área que lo atiende"
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
                        activo
                          ? "border-primary bg-primary/[0.07] ring-primary ring-1"
                          : "bg-card hover:border-primary/40 hover:bg-primary/[0.03]",
                        form.formState.errors.ubicacion && !activo && "border-destructive/50",
                      )}
                    >
                      <span
                        className={cn(
                          "grid size-9 shrink-0 place-items-center rounded-md transition-colors",
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
          </div>

          <Campo grupo label="Destino del envío" requerido>
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
                  <div ref={bloqueDepartamento} className="scroll-mt-24">
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
                        <SelectTrigger className="w-full" aria-invalid={!!form.formState.errors.departamentoId}>
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
                  </div>
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
                    <ConSoles>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        placeholder="0.00"
                        className="tnum pl-8"
                        {...form.register("flete")}
                      />
                    </ConSoles>
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
                <Campo grupo label="Cómo se entrega" requerido>
                  <Opciones
                    valores={[entrega]}
                    onToggle={(v) => form.setValue("entrega", v as Campos["entrega"])}
                    opciones={[
                      { valor: "tienda", label: "Recoge en tienda" },
                      { valor: "taller", label: "Recoge en taller" },
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
            ayuda={
              fechaPrometida && fechaPrometida >= hoyIso
                ? `${diaConNombre(fechaPrometida)}. El taller ordena su trabajo por esta fecha.`
                : "El taller ordena su trabajo por esta fecha."
            }
            error={form.formState.errors.fechaPrometida?.message}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="date"
                min={hoyIso}
                className="tnum w-44"
                aria-invalid={!!form.formState.errors.fechaPrometida}
                {...form.register("fechaPrometida")}
              />
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Atajos de fecha">
                {ATAJOS_FECHA.map(({ dias, label }) => {
                  const valor = sumarDias(hoyIso, dias);
                  const activo = fechaPrometida === valor;
                  return (
                    <button
                      key={dias}
                      type="button"
                      aria-pressed={activo}
                      onClick={() => form.setValue("fechaPrometida", valor, { shouldValidate: true, shouldTouch: true })}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-xs transition-colors",
                        "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
                        activo
                          ? "border-primary bg-primary text-primary-foreground font-medium"
                          : "bg-card text-foreground/80 hover:border-primary/40 hover:text-foreground",
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          </Campo>
        </Seccion>

        <Seccion n={3} titulo="Pago" completa={pagoListo}>
          <Campo grupo label="Tipo de pago" requerido>
            <Opciones
              valores={[tipoPago]}
              onToggle={(v) => form.setValue("tipoPago", v as Campos["tipoPago"])}
              opciones={Object.entries(PAGOS).map(([valor, label]) => ({ valor, label }))}
            />
          </Campo>

          <div className="bg-muted/60 grid gap-4 rounded-lg border p-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium">Total</p>
              <p className="tnum flex h-9 items-center text-lg font-semibold" data-testid="total-pedido">
                {money(total)}
              </p>
              {desdeCotizacion?.totalEnOdoo && (
                <p className="text-muted-foreground text-xs">El de la cotización en Odoo.</p>
              )}
            </div>

            {/* El abono inicial solo tiene sentido a cuenta: al contado se cobra
                el total y al crédito no entra nada todavía. */}
            {tipoPago === "a_cuenta" && (
              <>
                <Campo
                  label="Abono inicial"
                  ayuda="Opcional."
                  error={form.formState.errors.abono?.message}
                >
                  <ConSoles>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      placeholder="0.00"
                      className="tnum bg-card pl-8"
                      aria-invalid={!!form.formState.errors.abono}
                      {...form.register("abono")}
                    />
                  </ConSoles>
                </Campo>
                <div className="flex flex-col gap-1.5">
                  <p className="text-xs font-medium">Saldo</p>
                  <p
                    className={cn(
                      "tnum flex h-9 items-center text-lg font-semibold",
                      saldo > 0 ? "text-saldo-alerta" : "text-st-entregado",
                    )}
                    data-testid="saldo-pedido"
                  >
                    {money(saldo)}
                  </p>
                  <p className="text-muted-foreground text-xs">Lo que queda por cobrar.</p>
                </div>
              </>
            )}
          </div>

          {tipoPago === "contado" && (
            <p className="text-muted-foreground text-xs">
              Al contado el pedido se registra pagado: el abono por el total queda hecho y el
              saldo empieza en cero.
            </p>
          )}

          {tipoPago === "credito" && (
            <div ref={bloquePlazo} className="scroll-mt-24">
              <Campo
                grupo
                label="Plazo del crédito"
                requerido
                ayuda={
                  plazoCredito
                    ? `Vence el ${fechaCompleta(sumarDias(hoyIso, plazoCredito))}, contado desde hoy.`
                    : "Días desde el registro del pedido."
                }
                error={form.formState.errors.plazoCredito?.message}
              >
                <Opciones
                  valores={plazoCredito ? [String(plazoCredito)] : []}
                  onToggle={(v) => form.setValue("plazoCredito", Number(v), { shouldValidate: true })}
                  opciones={PLAZOS.map((d) => ({
                    valor: String(d),
                    label: d === 1 ? "1 día" : `${d} días`,
                  }))}
                />
              </Campo>
            </div>
          )}

          {cobraAhora && (
            <Campo
              label="Método de pago"
              ayuda={
                tipoPago === "contado"
                  ? `Por dónde entran los ${money(total)}.`
                  : `Por dónde entra el abono de ${money(abono)}.`
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

        <Seccion n={4} titulo="Para el taller" nota="Opcional">
          <Campo
            label="Notas para el taller"
            ayuda="Lo que el taller tiene que saber de todo el pedido: acabados, pegado, cómo se entrega. Lo de un solo ítem va en sus indicaciones."
            error={form.formState.errors.notas?.message}
          >
            <Textarea rows={3} placeholder="Ej. bordes pulidos; entregar con film" {...form.register("notas")} />
          </Campo>

          <Campo
            grupo
            label="Archivos"
            ayuda="Planos, PDF o imágenes. Hasta 10 MB cada uno. Cada archivo puede ser de un ítem o de todo el pedido."
          >
            <div
              role="button"
              tabIndex={0}
              aria-label="Elegir o arrastrar archivos"
              onClick={() => entradaArchivos.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  entradaArchivos.current?.click();
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setArrastrando(true);
              }}
              onDragLeave={() => setArrastrando(false)}
              onDrop={(e) => {
                e.preventDefault();
                setArrastrando(false);
                anadir(Array.from(e.dataTransfer.files));
              }}
              className={cn(
                "text-muted-foreground flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-5 text-center text-sm transition-colors",
                "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
                arrastrando
                  ? "border-primary bg-primary/[0.06] text-primary"
                  : "hover:border-primary/40 hover:bg-primary/[0.03]",
              )}
            >
              <span className="bg-primary/10 text-primary mb-2 grid size-9 place-items-center rounded-full">
                <Upload className="size-4" />
              </span>
              <span>
                <span className="text-primary font-medium">Elige archivos</span> o arrástralos aquí
              </span>
            </div>
              <input
                ref={entradaArchivos}
                type="file"
                multiple
                accept={ACEPTA}
                className="sr-only"
                aria-label="Elegir archivos"
                tabIndex={-1}
                onChange={(e) => {
                  anadir(Array.from(e.target.files ?? []));
                  e.target.value = "";
                }}
              />

            {archivos.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1.5" aria-label="Archivos por subir">
                {archivos.map((elegido) => (
                  <li
                    key={`${elegido.archivo.name}-${elegido.archivo.size}`}
                    className="bg-muted/60 flex flex-wrap items-center gap-2 rounded-md border py-1 pr-1 pl-2"
                  >
                    <FileText className="text-primary size-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-xs">{elegido.archivo.name}</span>
                    <Select
                      value={elegido.itemClave ?? GENERAL}
                      onValueChange={(v) =>
                        v &&
                        setArchivos((previos) =>
                          previos.map((p) => (p === elegido ? { ...p, itemClave: v === GENERAL ? null : v } : p)),
                        )
                      }
                    >
                      <SelectTrigger
                        size="sm"
                        className="bg-card w-52 max-w-full"
                        aria-label={`¿De qué es ${elegido.archivo.name}?`}
                      >
                        <SelectValue>
                          {elegido.itemClave
                            ? `Ítem ${items.find((i) => i.clave === elegido.itemClave)?.posicion ?? "?"}`
                            : "Todo el pedido"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={GENERAL}>Todo el pedido</SelectItem>
                        {items.map((i) => (
                          <SelectItem key={i.clave} value={i.clave}>
                            Ítem {i.posicion} · {i.nombre}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-6 shrink-0"
                      aria-label={`Quitar ${elegido.archivo.name}`}
                      onClick={() => setArchivos((previos) => previos.filter((p) => p !== elegido))}
                    >
                      <X className="size-3" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Campo>

          <Campo
            label="Responsable en taller"
            ayuda="Logística o Administración lo pueden asignar después."
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

          {conObservaciones ? (
            <Campo
              label="Observaciones internas"
              ayuda="Notas e incidencias del pedido para la oficina; no son instrucciones de producción."
            >
              <Textarea
                rows={2}
                autoFocus={!form.getValues("observaciones")}
                placeholder="Ej. el cliente pasa a revisar la muestra el lunes"
                {...form.register("observaciones")}
              />
            </Campo>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="text-muted-foreground -ml-2 gap-1 self-start"
              onClick={() => setConObservaciones(true)}
            >
              <NotebookPen />
              Agregar observación interna
            </Button>
          )}
        </Seccion>
      </form>

      <BarraEnvio
        form={ID_FORM}
        resumen={resumenBarra}
        problema={faltante}
        texto="Registrar pedido"
        textoPendiente="Registrando en Odoo…"
        pendiente={form.formState.isSubmitting || pendiente}
      />

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

      {disenando && (
        <DisenadorTerminado
          key={disenando.disenoId}
          disenoId={disenando.disenoId}
          nuevo={disenando.nuevo}
          inicial={disenando.inicial}
          datos={diseno}
          catalogo={catalogo}
          terminados={terminados}
          linea={lineas.filter(esTerminado).find((l) => l.clave === disenando.clave) ?? null}
          cliente={cliente?.nombre}
          alCerrar={() => setDisenando(null)}
          alAgregar={(nuevo) => {
            const { lineas: siguientes, clave } = ponerTerminado(lineas, nuevo);
            ponerLineas(siguientes);
            setDisenosDeLinea((d) => ({ ...d, [clave]: disenando.disenoId }));
            setDisenando(null);
            marcar(clave);
            requestAnimationFrame(() => buscadorProducto.current?.focus());
          }}
        />
      )}

      {terminado && (
        <EditorTerminado
          catalogo={terminados}
          planchas={catalogo}
          configCortes={config}
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
function DeLaCotizacion({
  d,
  indicaciones,
  alCambiarIndicaciones,
}: {
  d: DesdeCotizacion;
  indicaciones: Record<string, string>;
  alCambiarIndicaciones: (clave: string, texto: string) => void;
}) {
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
              <IndicacionesDeLinea
                nombre={tituloCorte(l.corte)}
                valor={indicaciones[String(l.posicion)] ?? ""}
                alCambiar={(texto) => alCambiarIndicaciones(String(l.posicion), texto)}
              />
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
              <div className="basis-full">
                <IndicacionesDeLinea
                  nombre={l.nombre}
                  valor={indicaciones[String(l.posicion)] ?? ""}
                  alCambiar={(texto) => alCambiarIndicaciones(String(l.posicion), texto)}
                />
              </div>
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

/** Un campo de dinero con el "S/" delante, como el precio de las líneas. */
function ConSoles({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm">
        S/
      </span>
      {children}
    </div>
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
