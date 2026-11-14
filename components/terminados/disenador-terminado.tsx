"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Box, ChevronLeft, ChevronRight, FolderOpen, Info, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import {
  abrirDiseno,
  buscarMisDisenos,
  disenoParaPedido,
  eliminarDiseno,
  renombrarDiseno,
  type DisenoBuscado,
} from "@/app/(app)/disenos/acciones";
import { lineaDeDiseno } from "@/lib/cad/cotizar";
import { valoresPorDefecto } from "@/lib/cad/esquema";
import type { MaterialesPorCopia } from "@/lib/cad/materiales";
import type { MaterialDiseno, ParametrosCad, PlantillaCad } from "@/lib/cad/tipos";
import type { GrupoPlancha } from "@/lib/cortes/catalogo";
import { momentoEnLima } from "@/lib/fecha";
import { money } from "@/lib/formato";
import type { LineaTerminado } from "@/lib/lineas-cotizacion";
import {
  medidasDe,
  textoDeMedidaEstandar,
  type CatalogoTerminados,
  type MedidaEstandar,
  type ProductoEstandar,
} from "@/lib/terminados/catalogo";
import type { Medidas } from "@/lib/terminados/geometria";
import { MEDIDAS_DE_PLANTILLA, medidasAParametrosCad, parametrosCadDe } from "@/lib/terminados/plantilla-cad";
import { cn } from "@/lib/utils";
import { DisenoProvider, useDiseno, type CostosDiseno } from "@/components/disenos/diseno-contexto";
import { useBloqueoDiseno, useCostoDiseno } from "@/components/disenos/panel-costo";
import { VistaDiseno } from "@/components/disenos/vista-diseno";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type TerminadoDeDiseno = Omit<LineaTerminado, "tipo" | "clave"> & { clave?: string };

/** Lo que llega del servidor para diseñar: las plantillas del motor y los precios de las planchas. */
export interface DatosDiseno {
  plantillas: PlantillaCad[];
  avisoMotor: string | null;
  corte: { kerfMm: number; margenMm: number };
  costos: CostosDiseno | null;
}

/** Las medidas de una fila del catálogo; en un cilindro, el largo es la altura. */
function medidasDeFila(m: MedidaEstandar, geometria: ProductoEstandar["geometria"]): Medidas {
  const base = medidasDe(m);
  if (geometria === "cilindro" && !base.altura && base.m1) return { diametro: base.diametro, altura: base.m1 };
  return base;
}

/**
 * El producto terminado de `/pedidos/nuevo`, a pantalla completa y con la misma
 * vista de `/disenos`: el menú con el chat a la izquierda y el modelo 3D a la
 * derecha. Lo que se arma queda guardado como diseño (con su chat y versiones)
 * y la línea del pedido se enlaza a su versión vigente.
 *
 * A diferencia de `/disenos`, aquí se elige la cantidad y el precio (el pie), y
 * la pestaña Modelo ofrece los productos del catálogo que tienen modelo 3D.
 */
export function DisenadorTerminado({
  disenoId,
  inicial,
  nuevo,
  datos,
  catalogo,
  terminados,
  linea,
  cliente,
  alCerrar,
  alAgregar,
}: {
  disenoId: string;
  /** Lo guardado del diseño, al editar una línea. `null`: uno recién creado. */
  inicial: {
    plantilla: string | null;
    parametros: ParametrosCad;
    material: MaterialDiseno | null;
    materiales?: MaterialesPorCopia;
  } | null;
  /** Si el diseño se creó al abrir: al cancelar, se borra. */
  nuevo: boolean;
  datos: DatosDiseno;
  catalogo: GrupoPlancha[];
  terminados: CatalogoTerminados;
  /** La línea que se edita, si es una edición. */
  linea: LineaTerminado | null;
  cliente?: string | null;
  alCerrar: () => void;
  alAgregar: (terminado: TerminadoDeDiseno) => void;
}) {
  // A pantalla completa sobre la app: la página de atrás no se desplaza.
  useEffect(() => {
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = antes;
    };
  }, []);

  const [productoCodigo, setProductoCodigo] = useState<string | null>(linea?.productoCodigo ?? null);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={linea ? "Editar producto terminado" : "Producto terminado"}
      className="bg-background fixed inset-0 z-50 flex flex-col"
    >
      <DisenoProvider
        disenoId={disenoId}
        plantillas={datos.plantillas}
        inicial={inicial ?? { plantilla: null, parametros: {}, material: null }}
        catalogo={catalogo}
        corte={datos.corte}
        costos={datos.costos}
      >
        <Contenido
          disenoId={disenoId}
          nuevo={nuevo}
          datos={datos}
          terminados={terminados}
          linea={linea}
          cliente={cliente}
          productoCodigo={productoCodigo}
          setProductoCodigo={setProductoCodigo}
          alCerrar={alCerrar}
          alAgregar={alAgregar}
        />
      </DisenoProvider>
    </div>,
    document.body,
  );
}

function Contenido({
  disenoId,
  nuevo,
  datos,
  terminados,
  linea,
  cliente,
  productoCodigo,
  setProductoCodigo,
  alCerrar,
  alAgregar,
}: {
  disenoId: string;
  nuevo: boolean;
  datos: DatosDiseno;
  terminados: CatalogoTerminados;
  linea: LineaTerminado | null;
  cliente?: string | null;
  productoCodigo: string | null;
  setProductoCodigo: (c: string | null) => void;
  alCerrar: () => void;
  alAgregar: (terminado: TerminadoDeDiseno) => void;
}) {
  const { plantilla, plantillas, resultado } = useDiseno();
  const [confirmando, setConfirmando] = useState(false);

  // El producto del catálogo vale mientras el diseño siga en su plantilla (el chat puede cambiarla).
  // Si se llegó al modelo por el chat, el producto es el primero del catálogo con esa plantilla:
  // de él salen el nombre y el factor del precio sugerido.
  const producto =
    terminados.productos.find((p) => p.codigo === productoCodigo && p.plantillaCad === plantilla) ??
    (plantilla ? (terminados.productos.find((p) => p.activo && p.plantillaCad === plantilla) ?? null) : null);
  const nombre = producto?.nombre ?? plantillas.find((p) => p.codigo === plantilla)?.nombre ?? linea?.nombre ?? null;

  /** Cancelar: un diseño recién creado se borra; si ya tenía algo, se pregunta antes. */
  const cancelar = () => {
    if (nuevo && resultado) return setConfirmando(true);
    descartar();
  };
  const descartar = () => {
    if (nuevo) void eliminarDiseno(disenoId).catch(() => {});
    alCerrar();
  };

  return (
    <>
      <VistaDiseno
        disenoId={disenoId}
        nombreModelo={nombre}
        avisoMotor={datos.avisoMotor}
        sinAgregarACotizacion
        className="h-dvh md:h-dvh"
        volver={
          <Button variant="ghost" size="sm" className="text-muted-foreground gap-1.5" onClick={cancelar}>
            <ArrowLeft />
            <span className="hidden sm:inline">Volver al pedido</span>
          </Button>
        }
        titulo={
          <>
            {linea ? "Editar producto terminado" : "Producto terminado"}
            {nombre && <span className="text-muted-foreground font-normal"> · {nombre}</span>}
          </>
        }
        extra={
          cliente ? (
            <span className="text-muted-foreground hidden max-w-64 truncate rounded-full border px-2.5 py-0.5 text-xs md:inline">
              Pedido de {cliente}
            </span>
          ) : null
        }
        modelo={
          <ModeloCatalogo
            disenoId={disenoId}
            terminados={terminados}
            productoCodigo={producto?.codigo ?? null}
            alElegir={setProductoCodigo}
          />
        }
        pie={
          <PieTerminado
            disenoId={disenoId}
            nuevo={nuevo}
            linea={linea}
            producto={producto}
            factor={terminados.tipos.find((t) => t.codigo === producto?.tipo)?.factor ?? 1}
            nombre={nombre}
            alCancelar={cancelar}
            alAgregar={alAgregar}
          />
        }
      />

      <AlertDialog open={confirmando} onOpenChange={setConfirmando}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Descartar este producto?</AlertDialogTitle>
            <AlertDialogDescription>
              No se agrega al pedido y se borra el diseño con su conversación.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Seguir diseñando</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={descartar}>
              Descartar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * Pestaña Modelo del pedido: los productos del catálogo que el motor dibuja
 * (los demás no se ofrecen), por tipo, con sus medidas estándar.
 */
/** El valor del selector de tipo que abre los diseños guardados. */
const MIS_DISENOS = "__mis-disenos__";

function ModeloCatalogo({
  disenoId,
  terminados,
  productoCodigo,
  alElegir,
}: {
  disenoId: string;
  terminados: CatalogoTerminados;
  productoCodigo: string | null;
  alElegir: (codigo: string | null) => void;
}) {
  const { plantillas, parametros, plantilla, aplicar, cargando, grupo } = useDiseno();

  const conModelo = useMemo(() => {
    const codigos = new Set(plantillas.map((p) => p.codigo));
    return terminados.productos.filter((p) => p.activo && p.plantillaCad && codigos.has(p.plantillaCad));
  }, [terminados, plantillas]);
  const tipos = terminados.tipos.filter((t) => conModelo.some((p) => p.tipo === t.codigo));

  const elegido = conModelo.find((p) => p.codigo === productoCodigo) ?? null;
  const [tipo, setTipo] = useState<string>(elegido?.tipo ?? tipos[0]?.codigo ?? MIS_DISENOS);
  const opciones = [
    ...tipos.map((t) => ({ valor: t.codigo, nombre: t.nombre })),
    { valor: MIS_DISENOS, nombre: "Mis diseños" },
  ];
  const delTipo = conModelo.filter((p) => p.tipo === tipo);

  const esquemaDe = (codigo: string) => plantillas.find((p) => p.codigo === codigo)?.esquema;

  const elegirProducto = (p: ProductoEstandar) => {
    if (!p.plantillaCad) return;
    alElegir(p.codigo);
    const primera = p.medidas[0];
    const params = parametrosCadDe(p, primera ? medidasDeFila(primera, p.geometria) : {}, {
      espesorMm: grupo?.espesorMm,
    });
    void aplicar(p.plantillaCad, { ...valoresPorDefecto(esquemaDe(p.plantillaCad)), ...params });
  };

  const elegirMedida = (p: ProductoEstandar, m: MedidaEstandar) => {
    if (!p.plantillaCad) return;
    const base = plantilla === p.plantillaCad ? parametros : valoresPorDefecto(esquemaDe(p.plantillaCad));
    void aplicar(p.plantillaCad, { ...base, ...medidasAParametrosCad(p.plantillaCad, medidasDeFila(m, p.geometria)) });
  };

  /** La medida estándar que coincide con los parámetros vigentes, si alguna. */
  const medidaActual = (p: ProductoEstandar) =>
    p.plantillaCad === plantilla
      ? p.medidas.find((m) => {
          const esperado = medidasAParametrosCad(p.plantillaCad!, medidasDeFila(m, p.geometria));
          const claves = Object.keys(esperado);
          return claves.length > 0 && claves.every((k) => Number(parametros[k]) === esperado[k]);
        })?.id
      : undefined;

  return (
    <div className="flex flex-col gap-5">
      <p className="text-muted-foreground text-sm">
        Elige el modelo y su medida estándar, o parte de uno de tus diseños. Luego lo ajustas en Parámetros o en el
        chat.
      </p>

      {/* En celular, un desplegable; desde sm, botones del mismo ancho que llenan la fila. */}
      <Select value={tipo} onValueChange={(v) => v && setTipo(v)}>
        <SelectTrigger className="h-9 w-full sm:hidden" aria-label="Tipo">
          <SelectValue>{opciones.find((o) => o.valor === tipo)?.nombre}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {opciones.map((o) => (
            <SelectItem key={o.valor} value={o.valor}>
              {o.nombre}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div
        role="group"
        aria-label="Tipo"
        className="hidden grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))] gap-1.5 sm:grid"
      >
        {opciones.map((o) => (
          <button
            key={o.valor}
            type="button"
            aria-pressed={o.valor === tipo}
            onClick={() => setTipo(o.valor)}
            className={cn(
              "flex h-9 w-full min-w-0 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm transition-colors",
              o.valor === tipo ? "bg-primary border-primary text-primary-foreground font-medium" : "bg-card hover:bg-muted",
            )}
          >
            {o.valor === MIS_DISENOS && <FolderOpen className="size-4 shrink-0" aria-hidden />}
            <span className="truncate">{o.nombre}</span>
          </button>
        ))}
      </div>

      {tipo === MIS_DISENOS ? (
        <MisDisenos disenoId={disenoId} alElegir={() => alElegir(null)} />
      ) : conModelo.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Ningún producto del catálogo tiene modelo 3D todavía. Descríbelo en el chat: el asistente elige la plantilla.
        </p>
      ) : (
        <>
          <ul className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3" aria-label="Modelos">
            {delTipo.map((p) => {
              const actual = p.codigo === elegido?.codigo && p.plantillaCad === plantilla;
              return (
                <li key={p.codigo}>
                  <button
                    type="button"
                    disabled={cargando}
                    aria-pressed={actual}
                    onClick={() => elegirProducto(p)}
                    className={cn(
                      "bg-card hover:border-primary/40 focus-visible:ring-ring flex h-full w-full flex-col overflow-hidden rounded-xl border text-left transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-60",
                      actual && "border-primary ring-primary/20 ring-2",
                    )}
                  >
                    <span className="from-muted/40 to-muted grid h-20 place-items-center bg-gradient-to-b">
                      <Box className={cn("size-8", actual ? "text-primary" : "text-muted-foreground/70")} aria-hidden />
                    </span>
                    <span className="px-3 py-2">
                      <span className="block text-sm font-medium">{p.nombre}</span>
                      <span className="text-muted-foreground block font-mono text-xs">{p.codigo}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {elegido && elegido.plantillaCad === plantilla && elegido.medidas.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium">Medida estándar</p>
              <div className="flex flex-wrap gap-1.5">
                {elegido.medidas.map((m) => {
                  const on = medidaActual(elegido) === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      disabled={cargando}
                      aria-pressed={on}
                      onClick={() => elegirMedida(elegido, m)}
                      className={cn(
                        "rounded-lg border px-3 py-1.5 text-sm tabular-nums transition-colors disabled:opacity-60",
                        on ? "bg-primary border-primary text-primary-foreground font-medium" : "bg-card hover:bg-muted",
                      )}
                    >
                      {textoDeMedidaEstandar(m)}
                    </button>
                  );
                })}
              </div>
              <p className="text-muted-foreground mt-1.5 text-xs">¿Otra medida? Cámbiala en Parámetros o pídesela al chat.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** "300 × 200 × 150 mm": las medidas principales de la plantilla, si las tiene. */
function resumenMedidas(plantilla: string, parametros: ParametrosCad): string | null {
  const valores = Object.values(MEDIDAS_DE_PLANTILLA[plantilla] ?? {})
    .map((n) => (n ? parametros[n] : undefined))
    .filter((v): v is number => typeof v === "number");
  return valores.length > 0 ? `${valores.join(" × ")} mm` : null;
}

/**
 * Los diseños guardados, para partir de uno: se copian su plantilla, sus
 * medidas y su material al diseño del pedido. El original no se toca.
 */
function MisDisenos({ disenoId, alElegir }: { disenoId: string; alElegir: () => void }) {
  const { plantillas, aplicar, mostrarMaterial, cargando } = useDiseno();
  const [texto, setTexto] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [pagina, setPagina] = useState(1);
  // Lo último que llegó, con la consulta que lo pidió: si ya no es la vigente, se está leyendo.
  const [datos, setDatos] = useState<{
    clave: string;
    disenos: DisenoBuscado[];
    total: number;
    paginas: number;
  } | null>(null);
  const [elegido, setElegido] = useState<string | null>(null);
  const [abriendo, setAbriendo] = useState<string | null>(null);
  const pedido = useRef(0);
  const clave = `${pagina}|${busqueda}`;
  const leyendo = datos?.clave !== clave;

  // La búsqueda espera a que se deje de escribir; una nueva vuelve a la primera página.
  useEffect(() => {
    const t = setTimeout(() => {
      setBusqueda(texto.trim());
      setPagina(1);
    }, 300);
    return () => clearTimeout(t);
  }, [texto]);

  useEffect(() => {
    // Solo vale la última respuesta: las anteriores llegan tarde y se ignoran.
    const este = ++pedido.current;
    const consulta = `${pagina}|${busqueda}`;
    buscarMisDisenos({ texto: busqueda, pagina, excluir: disenoId })
      .then((r) => {
        if (este === pedido.current) setDatos({ ...r, clave: consulta });
      })
      .catch((e) => {
        if (este !== pedido.current) return;
        toast.error(e instanceof Error ? e.message : "No se pudieron leer tus diseños.");
        // Sin esto quedaría "leyendo" para siempre: se deja lo anterior como vigente.
        setDatos((d) => (d ? { ...d, clave: consulta } : { clave: consulta, disenos: [], total: 0, paginas: 1 }));
      });
  }, [busqueda, pagina, disenoId]);

  const usar = async (d: DisenoBuscado) => {
    if (cargando || abriendo) return;
    setAbriendo(d.id);
    try {
      const base = await abrirDiseno(d.id);
      if (!base.plantilla) throw new Error("Ese diseño no tiene modelo todavía.");
      // El material primero, sin guardar: `aplicar` guarda la versión nueva con él.
      mostrarMaterial(base.material, base.materiales);
      alElegir();
      await aplicar(base.plantilla, base.parametros);
      setElegido(d.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo usar ese diseño.");
    } finally {
      setAbriendo(null);
    }
  };

  const nombrePlantilla = (codigo: string) => plantillas.find((p) => p.codigo === codigo)?.nombre ?? codigo;

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
          aria-hidden
        />
        <Input
          type="search"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Buscar por nombre o medidas (200x150)"
          aria-label="Buscar en mis diseños"
          maxLength={80}
          className="h-8 pl-8 text-sm"
        />
      </div>

      {datos === null ? (
        <div className="text-muted-foreground flex items-center gap-2 py-6 text-sm">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Cargando tus diseños…
        </div>
      ) : datos.disenos.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
          {busqueda ? "No hay diseños que coincidan." : "Todavía no tienes diseños guardados con modelo."}
        </p>
      ) : (
        <ul
          className={cn("grid gap-2 transition-opacity sm:grid-cols-2", leyendo && "opacity-60")}
          aria-label="Mis diseños"
          aria-busy={leyendo}
        >
          {datos.disenos.map((d) => {
            const medidas = resumenMedidas(d.plantilla, d.parametros);
            const actual = elegido === d.id;
            return (
              <li key={d.id}>
                <button
                  type="button"
                  disabled={cargando || !!abriendo}
                  aria-pressed={actual}
                  onClick={() => void usar(d)}
                  className={cn(
                    "bg-card hover:border-primary/40 focus-visible:ring-ring flex h-full w-full items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-60",
                    actual && "border-primary ring-primary/20 ring-2",
                  )}
                >
                  {abriendo === d.id ? (
                    <Loader2 className="text-primary mt-0.5 size-4 shrink-0 animate-spin" aria-hidden />
                  ) : (
                    <Box
                      className={cn("mt-0.5 size-4 shrink-0", actual ? "text-primary" : "text-muted-foreground/70")}
                      aria-hidden
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{d.nombre}</span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {nombrePlantilla(d.plantilla)}
                      {medidas && <span className="tabular-nums"> · {medidas}</span>}
                    </span>
                    <span className="text-muted-foreground/80 block truncate text-xs">
                      {momentoEnLima(d.actualizadoEn)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {datos && datos.paginas > 1 && (
        <nav aria-label="Páginas" className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pagina <= 1 || leyendo}
            onClick={() => setPagina((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft /> Anterior
          </Button>
          <span className="text-muted-foreground text-xs tabular-nums">
            Página {pagina} de {datos.paginas} · {datos.total} diseños
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pagina >= datos.paginas || leyendo}
            onClick={() => setPagina((p) => Math.min(datos.paginas, p + 1))}
          >
            Siguiente <ChevronRight />
          </Button>
        </nav>
      )}
    </div>
  );
}

/** El pie del pedido: cuántas, a cuánto, y agregar. */
function PieTerminado({
  disenoId,
  nuevo,
  linea,
  producto,
  factor,
  nombre,
  alCancelar,
  alAgregar,
}: {
  disenoId: string;
  nuevo: boolean;
  linea: LineaTerminado | null;
  producto: ProductoEstandar | null;
  factor: number;
  nombre: string | null;
  alCancelar: () => void;
  alAgregar: (terminado: TerminadoDeDiseno) => void;
}) {
  const { cargando, esperarGuardado, catalogo } = useDiseno();
  const costo = useCostoDiseno();
  const bloqueo = useBloqueoDiseno();
  const [cantidad, setCantidad] = useState(linea ? String(linea.cantidad) : "1");
  const [precio, setPrecio] = useState(linea ? String(linea.precioUnitario) : "");
  const [agregando, setAgregando] = useState(false);

  const unidades = Math.floor(Number(cantidad) || 0);
  const costoUnidad = costo ? costo.total : null;
  const sugerido = costoUnidad !== null ? Math.round(costoUnidad * (factor > 0 ? factor : 1) * 100) / 100 : null;
  const precioFinal = precio.trim() === "" ? sugerido : Number(precio.replace(",", "."));
  const precioValido = precioFinal !== null && Number.isFinite(precioFinal) && precioFinal >= 0;
  const margen =
    precioValido && costoUnidad !== null && precioFinal! > 0 ? (precioFinal! - costoUnidad) / precioFinal! : null;
  const subtotal = precioValido ? Math.round(unidades * precioFinal! * 100) / 100 : 0;

  const falta =
    bloqueo ??
    (unidades < 1 ? "Escribe la cantidad." : !precioValido ? (precio.trim() ? "El precio no es válido." : "Escribe el precio.") : null);

  const agregar = async () => {
    if (falta || agregando) return;
    setAgregando(true);
    try {
      // La versión que se enlaza es la vigente: primero que termine de guardarse.
      await esperarGuardado();
      const r = await disenoParaPedido(disenoId);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      const titulo = (nombre ?? r.diseno.nombre).trim() || "Producto terminado";
      // Un diseño recién creado se llama "Diseño sin nombre": que en /disenos se reconozca.
      if (nuevo) void renombrarDiseno(disenoId, titulo).catch(() => {});
      const grupo = catalogo.find((g) => g.id === r.diseno.grupo?.id) ?? r.diseno.grupo;
      const base = lineaDeDiseno(
        { ...r.diseno, grupo },
        { cantidad: unidades, precioUnitario: precioFinal, nombre: titulo, tipoCodigo: producto?.tipo ?? null },
      );
      alAgregar({
        ...base,
        clave: linea?.clave,
        // Las notas de la línea, si ya tenía; si no, las del diseño (otras planchas).
        notas: linea?.notas || base.notas,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo agregar el producto.");
    } finally {
      setAgregando(false);
    }
  };

  const celda = "flex flex-col gap-1.5";
  const etiqueta = "flex h-4 items-center gap-1 text-xs leading-4 font-medium";

  return (
    <div className="flex flex-col gap-2.5 px-4 py-3">
      <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
        <div className={celda}>
          <label htmlFor="terminado-cantidad" className={etiqueta}>
            Cantidad <span className="text-destructive">*</span>
          </label>
          <div className="flex h-9 items-center overflow-hidden rounded-lg border">
            <button
              type="button"
              aria-label="Una menos"
              className="text-muted-foreground hover:bg-muted h-full w-8"
              onClick={() => setCantidad(String(Math.max(1, unidades - 1)))}
            >
              −
            </button>
            <input
              id="terminado-cantidad"
              inputMode="numeric"
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value.replace(/\D/g, ""))}
              className="w-10 bg-transparent text-center text-sm font-medium tabular-nums outline-none"
            />
            <button
              type="button"
              aria-label="Una más"
              className="text-muted-foreground hover:bg-muted h-full w-8"
              onClick={() => setCantidad(String(unidades + 1))}
            >
              +
            </button>
          </div>
        </div>
        <div className={cn(celda, "hidden sm:flex")} title="Material y corte láser de una unidad.">
          <span className={etiqueta}>Costo/u</span>
          <span className="text-muted-foreground flex h-9 items-center text-sm tabular-nums" data-testid="costo-unidad">
            {costoUnidad !== null ? money(costoUnidad) : "—"}
          </span>
        </div>
        <div className={celda}>
          <label htmlFor="terminado-precio" className={etiqueta}>
            Precio unitario
            {sugerido !== null && (
              <Info className="text-muted-foreground size-3" aria-label={`Sugerido: costo × ${factor}`}>
                <title>{`Sugerido: ${money(sugerido)} (costo × ${factor})`}</title>
              </Info>
            )}
          </label>
          <Input
            id="terminado-precio"
            inputMode="decimal"
            value={precio}
            onChange={(e) => setPrecio(e.target.value)}
            placeholder={sugerido !== null ? String(sugerido) : "0.00"}
            className={cn("h-9 w-28 tabular-nums", precio.trim() && !precioValido && "border-destructive")}
          />
        </div>
        <div className={cn(celda, "hidden sm:flex")} title="Lo que queda del precio después del costo.">
          <span className={etiqueta}>Margen</span>
          <span
            className={cn(
              "flex h-9 items-center text-sm font-medium tabular-nums",
              margen === null ? "text-muted-foreground font-normal" : margen < 0 ? "text-destructive" : "text-st-entregado",
            )}
            data-testid="margen-terminado"
          >
            {margen === null ? "—" : `${Math.round(margen * 100)}%`}
          </span>
        </div>
        <div className={cn(celda, "ml-auto items-end")}>
          <span className={etiqueta}>Subtotal</span>
          <span className="flex h-9 items-center text-base font-semibold tabular-nums" data-testid="subtotal-terminado">
            {money(subtotal)}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {falta && <p className="text-muted-foreground mr-auto text-xs">{falta}</p>}
        <Button type="button" variant="outline" onClick={alCancelar} className="max-sm:flex-1">
          Cancelar
        </Button>
        <Button type="button" onClick={() => void agregar()} disabled={!!falta || agregando || cargando} className="max-sm:flex-1">
          {agregando && <Loader2 className="animate-spin" aria-hidden />}
          {linea ? "Guardar cambios" : "Agregar al pedido"}
        </Button>
      </div>
    </div>
  );
}
