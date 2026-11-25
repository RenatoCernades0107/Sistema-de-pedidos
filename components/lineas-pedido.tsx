"use client";

import { Fragment, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Boxes,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Factory,
  Loader2,
  NotebookPen,
  Package,
  Plus,
  Printer,
  RotateCw,
  Scissors,
  TriangleAlert,
  X,
  type LucideIcon,
} from "lucide-react";
import * as acciones from "@/app/(app)/acciones";
import { CLASES_ITEM, esTerminal, type Adjunto, type ClaseItem, type Pedido } from "@/lib/dominio";
import { MODALIDADES } from "@/lib/cortes/calcular";
import { materialDeCorte, totalPiezas } from "@/lib/cortes/guardado";
import { money } from "@/lib/formato";
import { useStore } from "@/lib/store";
import {
  PLANCHAS_MAXIMAS,
  hastaDosDecimales,
  planchasCalculadas,
  planchasDe,
  planchasPorFormatoDe,
  type LineaDePedido,
  type MaterialesAnotados,
  type OdooDePedido,
} from "@/lib/pedido-lineas";
import { medidaSobrante, normalizarMedidas, type Sobrante } from "@/lib/sobrantes";
import { CorteGuardadoVista } from "@/components/cortes/corte-guardado";
import { DialogoPlanchas, type PlanchasAnotadas, type SobrantesGuardados } from "@/components/planchas-usadas";
import { SelectorAlmacen } from "@/components/almacen/comun";
import { Campo } from "@/components/ui/campo";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { almacenDeLugar, type Almacen } from "@/lib/almacenes";
import { nombreDeGrupo, type GrupoPlancha } from "@/lib/cortes/catalogo";
import { VisorArchivo } from "@/components/visor-archivo";
import { urlAdjunto } from "@/app/(app)/adjuntos-acciones";
import { cantidadDeMaterial } from "@/lib/terminados/guardado";
import { BarraAgregar } from "@/components/cotizaciones/barra-agregar";
import { Input } from "@/components/ui/input";
import type { ProductoOdoo } from "@/lib/odoo/tipos";
import { cn } from "@/lib/utils";
import { TerminadoGuardadoVista } from "@/components/terminados/terminado-guardado";
import { Button } from "@/components/ui/button";

const n = (x: number) => String(+x.toFixed(2));

/** Después de Listo las planchas ya salieron: es cuando se descuenta el stock. */
const yaTerminado = (p: Pedido) => ["listo", "en_transito", "entregado"].includes(p.estado);

/** De qué es una línea: un corte, un producto terminado o un producto de Odoo tal cual. */
export const claseDeLinea = (l: LineaDePedido): ClaseItem =>
  l.corte ? "corte" : l.terminado ? "terminado" : "producto";

export const ICONO_CLASE: Record<ClaseItem, LucideIcon> = {
  corte: Scissors,
  terminado: Package,
  producto: Boxes,
};

/** Cómo se nombra una línea en la lista: el material del corte, el nombre del terminado o del producto. */
export const nombreDeLinea = (l: LineaDePedido) =>
  l.corte ? materialDeCorte(l.corte) : l.terminado ? l.terminado.nombre : l.nombre;

/** Cuánto es: las piezas de un corte, las unidades de lo demás. */
export function cantidadDeLinea(l: LineaDePedido) {
  if (l.corte) {
    const piezas = totalPiezas(l.corte.piezas);
    return `${piezas} ${piezas === 1 ? "pieza" : "piezas"}`;
  }
  return `${n(l.cantidad)} ${l.cantidad === 1 ? "unidad" : "unidades"}`;
}

/** Las fotos se ven en el carrusel del ítem; el resto (PDF, DXF…) queda en «Archivos del pedido». */
const esImagen = (nombre: string) => /\.(jpe?g|png|webp|gif|heic|heif|avif)$/i.test(nombre);

/** Los adjuntos que cada rol puede ver: el taller no ve la factura ni la guía (lo decide la RLS). */
const adjuntosVisibles = (p: Pedido, verTodo: boolean) =>
  verTodo ? p.adjuntos : p.adjuntos.filter((a) => a.tipo === "diseno" || a.tipo === "foto_entrega");

/**
 * Un ítem del pedido abierto en grande: lo que el taller tiene que hacer con
 * él. Arriba, sus indicaciones (lo primero que hay que leer); luego el plano
 * del corte o la ficha del terminado, con su 3D y sus fotos en un carrusel.
 * Lo del pedido entero —el material, la hoja de corte, Odoo— vive en la vista
 * «Materiales del pedido».
 */
export function PanelItem({
  pedido: p,
  lineas,
  linea: l,
  sobrantes = [],
  alAnterior,
  alSiguiente,
}: {
  pedido: Pedido;
  lineas: LineaDePedido[];
  linea: LineaDePedido;
  /** Los sobrantes que el pedido devolvió al almacén (piloto de sobrantes). */
  sobrantes?: Sobrante[];
  alAnterior?: () => void;
  alSiguiente?: () => void;
}) {
  const { permisos } = useStore();
  const clase = claseDeLinea(l);
  const Icono = ICONO_CLASE[clase];
  const indice = lineas.findIndex((x) => x.posicion === l.posicion);
  const fotos = adjuntosVisibles(p, permisos.verEnvioCompleto).filter(
    (a) => a.lineaPosicion === l.posicion && esImagen(a.nombre),
  );

  return (
    <section className="bg-card shadow-card rounded-xl border" aria-label="Productos y cortes" aria-describedby="titulo-item">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-3">
        <span className="bg-primary text-primary-foreground tnum grid size-8 shrink-0 place-items-center rounded-lg text-sm font-semibold">
          {l.posicion}
        </span>
        <div className="min-w-0 flex-1">
          <p className="eyebrow flex items-center gap-1.5">
            <Icono className="size-3" aria-hidden />
            {l.corte ? MODALIDADES[l.corte.modalidad] : CLASES_ITEM[clase]}
            <span aria-hidden>·</span>
            <span className="tnum">
              Ítem {indice + 1} de {lineas.length}
            </span>
          </p>
          <h2 id="titulo-item" className="truncate text-base font-semibold tracking-tight">
            {nombreDeLinea(l)}
          </h2>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={alAnterior} disabled={!alAnterior} aria-label="Ítem anterior">
            <ChevronLeft />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={alSiguiente} disabled={!alSiguiente} aria-label="Ítem siguiente">
            <ChevronRight />
          </Button>
        </div>
      </header>

      <div className="@container flex min-w-0 flex-col gap-4 p-4">
        {l.indicaciones && (
          <div className="border-brand/60 bg-brand/[0.06] flex gap-2.5 rounded-r-lg border-l-2 px-3 py-2.5">
            <NotebookPen className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="min-w-0">
              <p className="eyebrow">Indicaciones para el taller</p>
              <p className="mt-0.5 text-sm whitespace-pre-line">{l.indicaciones}</p>
            </div>
          </div>
        )}

        {l.corte ? (
          <>
            <CorteGuardadoVista corte={l.corte} conPrecios={permisos.verMontos} />
            {permisos.verMontos && l.importe !== null && (
              <p className="text-muted-foreground text-right text-sm">
                Importe <span className="tnum text-foreground font-medium">{money(l.importe)}</span>
              </p>
            )}
            {l.corte.sobrantes && (
              <Produccion linea={l} sobrantes={sobrantes.filter((s) => s.lineaPosicion === l.posicion)} />
            )}
          </>
        ) : l.terminado ? (
          <>
            <TerminadoGuardadoVista
              terminado={l.terminado}
              cantidad={l.cantidad}
              importe={l.importe}
              conPrecios={permisos.verMontos}
              sinMaterial
              imagenes={fotos.map((a) => ({ clave: a.id, nombre: a.nombre, contenido: <ImagenDeItem adjunto={a} /> }))}
            />
            {l.produccionNombre && (
              <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                <Factory className="size-3.5" aria-hidden />
                {l.produccionNombre} · {l.produccionCerrada ? "cerrada en Odoo" : "abierta en Odoo: reserva el material"}
              </p>
            )}
            {sobrantes.some((s) => s.lineaPosicion === l.posicion) && (
              <Produccion linea={l} sobrantes={sobrantes.filter((s) => s.lineaPosicion === l.posicion)} />
            )}
          </>
        ) : (
          <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
            <dl className="grid min-w-0 flex-1 gap-x-6 gap-y-3 @sm:grid-cols-2">
              <div>
                <dt className="eyebrow">Cantidad</dt>
                <dd className="tnum mt-0.5 text-lg font-semibold">{n(l.cantidad)}</dd>
              </div>
              {l.codigo && (
                <div>
                  <dt className="eyebrow">Código en Odoo</dt>
                  <dd className="mt-0.5 font-mono text-sm">{l.codigo}</dd>
                </div>
              )}
              {l.descripcion && (
                <div className="@sm:col-span-2">
                  <dt className="eyebrow">Descripción</dt>
                  <dd className="mt-0.5 text-sm whitespace-pre-line">{l.descripcion}</dd>
                </div>
              )}
            </dl>
            {permisos.verMontos && l.importe !== null && (
              <div className="text-right">
                <p className="eyebrow">Importe</p>
                <p className="tnum mt-0.5 text-lg font-semibold">{money(l.importe)}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * Una foto del ítem dentro del carrusel. La URL se firma al montarse (vence en
 * minutos, así que no se guarda); tocarla la abre en grande en el visor.
 */
function ImagenDeItem({ adjunto: a }: { adjunto: Adjunto }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [abierta, setAbierta] = useState(false);

  useEffect(() => {
    let vigente = true;
    urlAdjunto(a.id).then((r) => {
      if (!vigente) return;
      if ("url" in r) setUrl(r.url);
      else setError(true);
    });
    return () => {
      vigente = false;
    };
  }, [a.id]);

  return (
    <>
      <button
        type="button"
        onClick={() => url && setAbierta(true)}
        disabled={!url}
        aria-label={`Ver ${a.nombre} en grande`}
        className="relative grid h-44 w-full place-items-center"
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage, de vida corta
          <img src={url} alt={a.nombre} className="absolute inset-0 size-full object-contain p-2" />
        ) : error ? (
          <span className="text-muted-foreground text-xs">No se pudo cargar {a.nombre}</span>
        ) : (
          <Loader2 className="text-muted-foreground size-4 animate-spin" />
        )}
      </button>
      {url && <VisorArchivo abierto={abierta} url={url} titulo={a.nombre} onCerrar={() => setAbierta(false)} />}
    </>
  );
}

/* ── Materiales del pedido ── */

/** Planchas de un corte: ≥ 0, hasta dos decimales (media o cuarto de plancha). */
function leerPlanchas(texto: string): number | string {
  const limpio = texto.trim().replace(",", ".");
  if (!limpio) return "Escribe cuántas planchas se usaron";
  const v = Number(limpio);
  if (!Number.isFinite(v)) return "Escribe un número";
  if (v < 0) return "No pueden ser menos de cero";
  if (v > PLANCHAS_MAXIMAS) return "Son demasiadas planchas";
  if (!hastaDosDecimales(v)) return "Hasta dos decimales";
  return v;
}

/** Cantidad de un material de terminado: ≥ 0, hasta tres decimales. */
function leerCantidad(texto: string): number | string {
  const limpio = texto.trim().replace(",", ".");
  if (!limpio) return "Escribe la cantidad usada";
  const v = Number(limpio);
  if (!Number.isFinite(v) || v < 0) return "Escribe un número, cero o más";
  if (v > 99_999) return "Esa cantidad no es razonable";
  if (Math.abs(v * 1000 - Math.round(v * 1000)) > 1e-6) return "Hasta tres decimales";
  return v;
}

const t3 = (x: number) => String(+x.toFixed(3));

/** Un material de un producto terminado tal como se edita: lo estimado queda fijo; lo usado, no. */
interface MaterialEnEdicion {
  productoId: number;
  codigo: string | null;
  nombre: string;
  unidad: string | null;
  /** Lo que se estimó al cotizar; `null` si se agregó después. */
  estimado: number | null;
  /** Lo escrito en «Usado». */
  usado: string;
  /** Se quitó: no se usó nada de esto. */
  quitado: boolean;
}

interface Borrador {
  /**
   * Planchas usadas de cada corte, por posición (`"3"`); si el corte mezcla
   * formatos, una por formato (`"3|F9.5085"`).
   */
  planchas: Record<string, string>;
  /** Materiales de cada terminado, por posición. */
  materiales: Record<number, MaterialEnEdicion[]>;
}

/** El punto de partida: lo anotado o, si nadie anotó, lo estimado. */
function borradorDe(lineas: LineaDePedido[]): Borrador {
  const planchas: Borrador["planchas"] = {};
  const materiales: Borrador["materiales"] = {};
  for (const l of lineas) {
    if (l.corte) {
      const porFormato = planchasPorFormatoDe(l);
      if (porFormato) for (const f of porFormato) planchas[`${l.posicion}|${f.codigo}`] = n(f.usadas);
      else planchas[l.posicion] = n(planchasDe(l));
    }
    else if (l.terminado) {
      const t = l.terminado;
      const usados = l.materialesUsados;
      const filas: MaterialEnEdicion[] = t.materiales.map((m) => {
        const u = usados ? usados.find((x) => x.productoId === m.productoId) : m;
        return {
          productoId: m.productoId,
          codigo: m.codigo,
          nombre: m.nombre,
          unidad: m.unidad,
          estimado: m.cantidad,
          usado: u ? t3(u.cantidad) : "0",
          quitado: !u,
        };
      });
      for (const u of usados ?? []) {
        if (!t.materiales.some((m) => m.productoId === u.productoId)) {
          filas.push({ ...u, estimado: null, usado: t3(u.cantidad), quitado: false });
        }
      }
      materiales[l.posicion] = filas;
    }
  }
  return { planchas, materiales };
}

const mismoBorrador = (a: Borrador, b: Borrador) => JSON.stringify(a) === JSON.stringify(b);

/**
 * El material de todo el pedido en un lugar, y donde se anota lo que de verdad
 * se usó: lo estimado queda fijo; lo usado se corrige, se quita o se agrega
 * (cambió el color, se rompió una bisagra…). Es lo que se descuenta del stock
 * en Odoo al pasar a Listo.
 *
 * En los cortes solo cambia la cantidad de planchas: la plancha es la que se
 * vendió. En los productos de Odoo tal cual, sale lo vendido.
 *
 * Con `aListo` (se pidió pasar el pedido a Listo), en vez de guardar se
 * confirma lo usado y se mueve el pedido. Con el piloto de sobrantes, antes se
 * piden los pedazos que vuelven al almacén.
 */
export function MaterialesPedido({
  pedido: p,
  lineas,
  odoo,
  retazoMin = 30,
  almacenes = [],
  catalogo = [],
  aListo: pidioListo = false,
  alSalirDeListo,
}: {
  pedido: Pedido;
  lineas: LineaDePedido[];
  odoo: OdooDePedido | null;
  /** El lado mínimo de un sobrante, para proponer los que vuelven al almacén. */
  retazoMin?: number;
  /** A qué almacén puede irse cada sobrante. */
  almacenes?: Almacen[];
  /** De qué material puede ser un sobrante de un producto terminado. */
  catalogo?: GrupoPlancha[];
  aListo?: boolean;
  alSalirDeListo?: () => void;
}) {
  const { cambiarEstado, pendiente: moviendo } = useStore();
  const original = borradorDe(lineas);
  const claveOriginal = JSON.stringify(original);
  const [base, setBase] = useState(claveOriginal);
  const [borrador, setBorrador] = useState<Borrador>(original);
  // Cuando llega lo guardado (o lo cambió otra persona), se parte de nuevo de eso.
  if (base !== claveOriginal) {
    setBase(claveOriginal);
    setBorrador(original);
  }
  const [error, setError] = useState<string | null>(null);
  const [conSobrantes, setConSobrantes] = useState(false);
  /** Los pedazos de plancha que quedaron de cada producto terminado, al pasar a Listo. */
  const [sobrantesTerminados, setSobrantesTerminados] = useState<Record<number, SobranteDeTerminado[]>>({});
  const [guardando, iniciar] = useTransition();

  const cortes = lineas.filter((x) => x.corte);
  const terminados = lineas.filter((x) => x.terminado);
  const editable = !odoo?.stockDescontado && !esTerminal(p.estado);
  // Si el pedido ya pasó a Listo (aunque Odoo no haya descontado), ya no se confirma: se corrige y se reintenta.
  const aListo = pidioListo && !["listo", "en_transito", "entregado"].includes(p.estado);
  const conPiloto = cortes.some((l) => l.corte?.sobrantes);
  // Al pasar a Listo, los productos terminados dicen si quedaron pedazos de plancha (y a qué almacén se fueron).
  const conSobrantesTerminados = aListo && editable && terminados.length > 0 && almacenes.length > 0;
  // Los productos terminados con piezas calculadas también van en la hoja de corte.
  const conHojaDeCorte = lineas.some((x) => x.corte || x.terminado?.corte);
  const cambiado = !mismoBorrador(borrador, original);
  const ocupado = guardando || moviendo;

  const cambiarPlanchas = (clave: string | number, texto: string) => {
    setError(null);
    setBorrador((b) => ({ ...b, planchas: { ...b.planchas, [clave]: texto } }));
  };
  const cambiarMaterial = (posicion: number, productoId: number, cambio: Partial<MaterialEnEdicion>) => {
    setError(null);
    setBorrador((b) => ({
      ...b,
      materiales: {
        ...b.materiales,
        [posicion]: b.materiales[posicion].map((m) => (m.productoId === productoId ? { ...m, ...cambio } : m)),
      },
    }));
  };
  const quitarMaterial = (posicion: number, m: MaterialEnEdicion) => {
    setError(null);
    setBorrador((b) => ({
      ...b,
      materiales: {
        ...b.materiales,
        // Lo estimado se queda a la vista, tachado; lo agregado se va.
        [posicion]:
          m.estimado === null
            ? b.materiales[posicion].filter((x) => x.productoId !== m.productoId)
            : b.materiales[posicion].map((x) => (x.productoId === m.productoId ? { ...x, quitado: true, usado: "0" } : x)),
      },
    }));
  };
  const agregarMaterial = (posicion: number, prod: ProductoOdoo) => {
    setError(null);
    setBorrador((b) => {
      const lista = b.materiales[posicion];
      const ya = lista.find((x) => x.productoId === prod.id);
      return {
        ...b,
        materiales: {
          ...b.materiales,
          [posicion]: ya
            ? lista.map((x) => (x.productoId === prod.id ? { ...x, quitado: false, usado: x.usado === "0" ? "1" : x.usado } : x))
            : [
                ...lista,
                {
                  productoId: prod.id,
                  codigo: prod.codigo,
                  nombre: prod.nombre,
                  unidad: prod.unidad,
                  estimado: null,
                  usado: "1",
                  quitado: false,
                },
              ],
        },
      };
    });
  };

  /** Lo escrito, listo para enviar; o el primer error, con el nombre de lo que falló. */
  const leerBorrador = ():
    | { ok: true; planchas: PlanchasAnotadas; materiales: MaterialesAnotados }
    | { ok: false; error: string } => {
    const planchas: PlanchasAnotadas = [];
    for (const l of cortes) {
      const porFormato = planchasPorFormatoDe(l);
      if (porFormato) {
        // Cada formato por su lado; el total es la suma.
        const anotado: Record<string, number> = {};
        for (const f of porFormato) {
          const v = leerPlanchas(borrador.planchas[`${l.posicion}|${f.codigo}`] ?? "");
          if (typeof v === "string") return { ok: false, error: `Ítem ${l.posicion} (${f.codigo}): ${v}.` };
          anotado[f.codigo] = v;
        }
        const total = Math.round(Object.values(anotado).reduce((s, x) => s + x, 0) * 100) / 100;
        planchas.push({ posicion: l.posicion, planchas: total, porFormato: anotado });
        continue;
      }
      const v = leerPlanchas(borrador.planchas[l.posicion] ?? "");
      if (typeof v === "string") return { ok: false, error: `Ítem ${l.posicion} (${nombreDeLinea(l)}): ${v}.` };
      planchas.push({ posicion: l.posicion, planchas: v });
    }
    const materiales: MaterialesAnotados = [];
    for (const l of terminados) {
      const usados: { productoId: number; cantidad: number }[] = [];
      for (const m of borrador.materiales[l.posicion] ?? []) {
        if (m.quitado) continue;
        const v = leerCantidad(m.usado);
        if (typeof v === "string") return { ok: false, error: `${m.nombre}: ${v}.` };
        if (v > 0) usados.push({ productoId: m.productoId, cantidad: v });
      }
      materiales.push({ posicion: l.posicion, usados });
    }
    return { ok: true, planchas, materiales };
  };

  /** Guarda lo que cambió (solo eso): planchas, materiales o ambos. */
  const anotar = async (leido: { planchas: PlanchasAnotadas; materiales: MaterialesAnotados }) => {
    const planchasCambiadas = JSON.stringify(borrador.planchas) !== JSON.stringify(original.planchas);
    const materialesCambiados = !mismoBorrador(
      { planchas: {}, materiales: borrador.materiales },
      { planchas: {}, materiales: original.materiales },
    );
    if (planchasCambiadas && leido.planchas.length) {
      const r = await acciones.anotarPlanchasUsadas({ codigo: p.codigo, planchas: leido.planchas });
      if (!r.ok) return r;
    }
    if (materialesCambiados && leido.materiales.length) {
      const r = await acciones.anotarMaterialesUsados({ codigo: p.codigo, materiales: leido.materiales });
      if (!r.ok) return r;
    }
    return { ok: true } as acciones.Resultado;
  };

  const guardar = () => {
    const leido = leerBorrador();
    if (!leido.ok) return setError(leido.error);
    iniciar(async () => {
      const r = await anotar(leido);
      if (r.ok) toast.success("Materiales usados guardados");
      else toast.error("No se guardó", { description: r.error });
    });
  };

  /** Los sobrantes de los terminados, listos para enviar; o el primer error. */
  const leerSobrantesTerminados = (): SobrantesGuardados | string => {
    if (!conSobrantesTerminados) return [];
    const guardados: SobrantesGuardados = [];
    for (const l of terminados) {
      const piezas: SobrantesGuardados[number]["piezas"] = [];
      for (const s of sobrantesTerminados[l.posicion] ?? []) {
        const largo = medidaCm(s.largo);
        const ancho = medidaCm(s.ancho);
        if (!s.grupoId) return "Elige de qué material es cada sobrante.";
        if (!largo || !ancho) return "Escribe el largo y el ancho de cada sobrante, o quítalo.";
        const m = normalizarMedidas(largo, ancho);
        if (m.ancho < retazoMin) return `${n(m.largo)}×${n(m.ancho)} es retazo (un lado de menos de ${retazoMin} cm): quítalo.`;
        if (!s.almacenId) return "Elige a qué almacén se fue cada sobrante.";
        piezas.push({ ...m, ubicacion: s.ubicacion.trim() || null, almacenId: s.almacenId, grupoId: s.grupoId });
      }
      // Una línea sin sobrantes también va: así se limpia lo de un intento anterior.
      guardados.push({ posicion: l.posicion, piezas });
    }
    return guardados;
  };

  const pasarAListo = () => {
    const leido = leerBorrador();
    if (!leido.ok) return setError(leido.error);
    const deTerminados = leerSobrantesTerminados();
    if (typeof deTerminados === "string") return setError(deTerminados);
    if (conPiloto) {
      // Lo usado se guarda primero: el diálogo de sobrantes llega con eso puesto.
      iniciar(async () => {
        const r = await anotar(leido);
        if (r.ok) setConSobrantes(true);
        else toast.error("No se guardó", { description: r.error });
      });
      return;
    }
    iniciar(async () => {
      // Al pasar, el aviso se va solo (el pedido ya está en Listo): la URL no se toca
      // mientras la página se refresca.
      await cambiarEstado(p.codigo, "listo", {
        planchas: leido.planchas.length ? leido.planchas : undefined,
        materiales: leido.materiales.length ? leido.materiales : undefined,
        sobrantes: deTerminados.length ? deTerminados : undefined,
      });
    });
  };

  const descartar = () => {
    setError(null);
    setBorrador(original);
  };

  const unidadPlancha = (v: string) => (Number(v.replace(",", ".")) === 1 ? "plancha" : "planchas");

  return (
    <section className="bg-card shadow-card rounded-xl border" aria-labelledby="titulo-materiales">
      <header className="flex flex-wrap items-center gap-2 border-b py-2 pr-2 pl-4">
        <h2 id="titulo-materiales" className="mr-auto text-sm font-medium">
          Materiales del pedido
        </h2>
        {conHojaDeCorte && (
          <Button
            render={<Link href={`/pedidos/${encodeURIComponent(p.codigo)}/hoja-de-corte`} />}
            nativeButton={false}
            variant="outline"
            size="sm"
            className="gap-1.5"
          >
            <Printer className="size-3.5" />
            Hoja de corte
          </Button>
        )}
      </header>

      {aListo && editable && (
        <div className="border-primary/30 bg-primary/[0.06] flex gap-2.5 border-b px-4 py-3 text-sm" role="status">
          <CircleCheck className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            <span className="font-medium">Para pasar a Listo, revisa lo que de verdad se usó.</span>{" "}
            <span className="text-muted-foreground">
              Corrige lo usado si hace falta y confirma: eso se descuenta del stock en Odoo.
            </span>
          </p>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="eyebrow py-2 pr-3 pl-4 text-left">Ítem</th>
              <th className="eyebrow py-2 pr-3 text-left">Material</th>
              <th className="eyebrow py-2 pr-3 text-right">Estimado</th>
              <th className="eyebrow py-2 pr-4 text-right">Usado</th>
            </tr>
          </thead>
          <tbody>
            {lineas.map((l) => {
              if (l.corte) {
                // Un corte que mezcla formatos va en una fila por formato.
                const filas = planchasPorFormatoDe(l)?.map((f) => ({
                  clave: `${l.posicion}|${f.codigo}`,
                  codigo: f.codigo,
                  calculadas: f.calculadas,
                })) ?? [{ clave: String(l.posicion), codigo: l.corte.formato.codigo, calculadas: planchasCalculadas(l) }];
                return (
                  <Fragment key={l.posicion}>
                    {filas.map((f, k) => {
                      const valor = borrador.planchas[f.clave] ?? "";
                      return (
                        <tr key={f.clave} className="border-b">
                          <td className="tnum text-muted-foreground py-2 pr-3 pl-4 align-middle">
                            {k === 0 ? l.posicion : ""}
                          </td>
                          <td className="py-2 pr-3 align-middle">
                            <span className="text-muted-foreground mr-1.5 font-mono text-xs">{f.codigo}</span>
                            {materialDeCorte(l.corte!)}
                          </td>
                          <td className="tnum py-2 pr-3 text-right align-middle whitespace-nowrap">
                            {n(f.calculadas)} {f.calculadas === 1 ? "plancha" : "planchas"}
                          </td>
                          <td className="py-1.5 pr-4 text-right align-middle whitespace-nowrap">
                            {editable ? (
                              <span className="inline-flex items-center gap-1.5">
                                <Input
                                  inputMode="decimal"
                                  aria-label={`Planchas usadas (${f.codigo})`}
                                  className="tnum h-8 w-20 text-right"
                                  value={valor}
                                  onChange={(e) => cambiarPlanchas(f.clave, e.target.value)}
                                />
                                <span className="text-muted-foreground w-14 text-left text-xs">{unidadPlancha(valor)}</span>
                              </span>
                            ) : (
                              <span className="tnum">
                                {valor} {unidadPlancha(valor)}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              }
              if (l.terminado) {
                const filas = borrador.materiales[l.posicion] ?? [];
                return (
                  <Fragment key={l.posicion}>
                    {filas.map((m, i) => (
                      <tr key={m.productoId} className={cn("border-b", m.quitado && "text-muted-foreground")}>
                        <td className="tnum text-muted-foreground py-2 pr-3 pl-4 align-middle">{i === 0 ? l.posicion : ""}</td>
                        <td className={cn("py-2 pr-3 align-middle", m.quitado && "line-through")}>
                          {m.codigo && <span className="text-muted-foreground mr-1.5 font-mono text-xs">{m.codigo}</span>}
                          {m.nombre}
                          {m.estimado === null && (
                            <span className="bg-brand-soft ml-1.5 rounded px-1.5 py-px text-2xs no-underline">agregado</span>
                          )}
                        </td>
                        <td className="tnum py-2 pr-3 text-right align-middle whitespace-nowrap">
                          {m.estimado === null ? "—" : cantidadDeMaterial({ cantidad: m.estimado, unidad: m.unidad })}
                        </td>
                        <td className="py-1.5 pr-4 text-right align-middle whitespace-nowrap">
                          {!editable ? (
                            <span className="tnum">
                              {m.quitado ? "0" : cantidadDeMaterial({ cantidad: Number(m.usado) || 0, unidad: m.unidad })}
                            </span>
                          ) : m.quitado ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => cambiarMaterial(l.posicion, m.productoId, { quitado: false, usado: t3(m.estimado ?? 1) })}
                            >
                              <RotateCw className="size-3.5" />
                              Volver a usar
                            </Button>
                          ) : (
                            <span className="inline-flex items-center gap-1.5">
                              <Input
                                inputMode="decimal"
                                aria-label={`Cantidad usada de ${m.nombre}`}
                                className="tnum h-8 w-20 text-right"
                                value={m.usado}
                                onChange={(e) => cambiarMaterial(l.posicion, m.productoId, { usado: e.target.value })}
                              />
                              <span className="text-muted-foreground w-14 truncate text-left text-xs">{m.unidad ?? "un"}</span>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Quitar ${m.nombre}`}
                                title="No se usó"
                                onClick={() => quitarMaterial(l.posicion, m)}
                              >
                                <X />
                              </Button>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {editable && (
                      <tr className="border-b">
                        <td className="tnum text-muted-foreground py-2 pr-3 pl-4 align-top">{filas.length === 0 ? l.posicion : ""}</td>
                        <td colSpan={3} className="py-2 pr-4">
                          <div className="max-w-md">
                            <BarraAgregar
                              alAgregar={(prod) => agregarMaterial(l.posicion, prod)}
                              catalogo={catalogo}
                              ruta="/api/terminados/materiales"
                              sinPrecio
                              etiqueta={`Agregar material usado en ${l.terminado.nombre}`}
                            />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              }
              return (
                <tr key={l.posicion} className="border-b">
                  <td className="tnum text-muted-foreground py-2 pr-3 pl-4 align-middle">{l.posicion}</td>
                  <td className="py-2 pr-3 align-middle">
                    {l.codigo && <span className="text-muted-foreground mr-1.5 font-mono text-xs">{l.codigo}</span>}
                    {l.nombre}
                  </td>
                  <td className="tnum py-2 pr-3 text-right align-middle whitespace-nowrap">
                    {n(l.cantidad)} {l.cantidad === 1 ? "unidad" : "unidades"}
                  </td>
                  <td className="tnum py-2 pr-4 text-right align-middle whitespace-nowrap">
                    {n(l.cantidad)} {l.cantidad === 1 ? "unidad" : "unidades"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {conSobrantesTerminados && (
        <div className="flex flex-col gap-3 border-b px-4 py-3">
          {terminados.map((l) => (
            <SobrantesDeTerminadoEditor
              key={l.posicion}
              linea={l}
              materiales={borrador.materiales[l.posicion] ?? []}
              catalogo={catalogo}
              almacenes={almacenes}
              sobrantes={sobrantesTerminados[l.posicion] ?? []}
              alCambiar={(lista) => {
                setError(null);
                setSobrantesTerminados((prev) => ({ ...prev, [l.posicion]: lista }));
              }}
              varios={terminados.length > 1}
            />
          ))}
        </div>
      )}

      {error && (
        <p role="alert" className="text-destructive border-b px-4 py-2 text-sm">
          {error}
        </p>
      )}

      {editable && (aListo || cambiado) && (
        <div className="bg-muted/30 flex flex-wrap items-center justify-end gap-2 border-b px-4 py-2.5">
          <p className="text-muted-foreground mr-auto text-xs">
            {aListo ? "Lo usado se descuenta del stock en Odoo al confirmar." : "Cambios sin guardar."}
          </p>
          {aListo ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  descartar();
                  alSalirDeListo?.();
                }}
                disabled={ocupado}
              >
                Cancelar
              </Button>
              <Button size="sm" onClick={pasarAListo} disabled={ocupado} className="gap-1.5">
                {ocupado && <Loader2 className="size-3.5 animate-spin" />}
                Confirmar y pasar a Listo
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={descartar} disabled={ocupado}>
                Descartar
              </Button>
              <Button size="sm" onClick={guardar} disabled={ocupado} className="gap-1.5">
                {guardando && <Loader2 className="size-3.5 animate-spin" />}
                Guardar
              </Button>
            </>
          )}
        </div>
      )}

      {!aListo && editable && !cambiado && (
        <p className="text-muted-foreground border-b px-4 py-2 text-xs">
          Lo usado empieza con lo estimado. Corrígelo, quítalo o agrega lo que se usó de verdad; al pasar a Listo
          se descuenta del stock en Odoo.
        </p>
      )}

      {odoo && <EstadoOdoo pedido={p} odoo={odoo} hayCortes={cortes.length > 0} hayTerminados={terminados.length > 0} />}

      {conPiloto && (
        <DialogoPlanchas
          abierto={conSobrantes}
          alCambiar={setConSobrantes}
          cortes={cortes}
          alPasarAListo
          retazoMin={retazoMin}
          almacenes={almacenes}
          pendiente={moviendo}
          alConfirmar={async (planchas, sobrantes) => {
            const leido = leerBorrador();
            const deTerminados = leerSobrantesTerminados();
            const r = await cambiarEstado(p.codigo, "listo", {
              planchas,
              sobrantes: [...sobrantes, ...(typeof deTerminados === "string" ? [] : deTerminados)],
              materiales: leido.ok && leido.materiales.length ? leido.materiales : undefined,
            });
            return r;
          }}
        />
      )}
    </section>
  );
}

/** Un pedazo de plancha que quedó de un producto terminado, tal como se escribe. */
interface SobranteDeTerminado {
  clave: number;
  grupoId: string | null;
  largo: string;
  ancho: string;
  ubicacion: string;
  almacenId: string | null;
}

let siguienteSobrante = 1;

/** Una medida en cm, si es válida. */
const medidaCm = (texto: string) => {
  const v = Number(texto.trim().replace(",", "."));
  return texto.trim() && Number.isFinite(v) && v > 0 ? v : null;
};

/**
 * Al pasar a Listo: los pedazos de plancha que quedaron de un producto
 * terminado, de qué material son y a qué almacén se fueron. Vuelven al
 * almacén como sobrantes. Si no quedó ninguno, no se agrega nada.
 */
function SobrantesDeTerminadoEditor({
  linea: l,
  materiales,
  catalogo,
  almacenes,
  sobrantes,
  alCambiar,
  varios,
}: {
  linea: LineaDePedido;
  /** Lo usado: un sobrante puede ser de cualquiera de sus planchas. */
  materiales: MaterialEnEdicion[];
  catalogo: GrupoPlancha[];
  almacenes: Almacen[];
  sobrantes: SobranteDeTerminado[];
  alCambiar: (lista: SobranteDeTerminado[]) => void;
  /** Hay más de un terminado: se dice de cuál es cada bloque. */
  varios: boolean;
}) {
  // Los productos terminados se fabrican en el taller: ahí vuelven sus sobrantes, salvo que se diga otra cosa.
  const taller = almacenDeLugar(almacenes, "taller")?.id ?? null;
  /** Los materiales de los que puede ser un sobrante: el del producto y las planchas usadas. */
  const grupos = (() => {
    const ids = new Set<string>();
    const propio = l.terminado?.material?.grupoId;
    if (propio) ids.add(propio);
    for (const m of materiales) {
      if (m.quitado) continue;
      for (const g of catalogo) if (m.codigo && g.formatos.some((x) => x.codigo === m.codigo)) ids.add(g.id);
    }
    return catalogo.filter((g) => ids.has(g.id));
  })();
  const cambiar = (clave: number, cambios: Partial<SobranteDeTerminado>) =>
    alCambiar(sobrantes.map((s) => (s.clave === clave ? { ...s, ...cambios } : s)));

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">
        ¿Quedaron sobrantes de plancha{varios ? ` en el ítem ${l.posicion} (${l.terminado?.nombre})` : ""}?
      </legend>
      {sobrantes.length === 0 && (
        <p className="text-muted-foreground text-xs">Ninguno. Si guardaste un pedazo, agrégalo con su medida.</p>
      )}
      {sobrantes.map((s, k) => {
        const grupo = catalogo.find((g) => g.id === s.grupoId) ?? null;
        return (
          <div key={s.clave} className="flex flex-wrap items-end gap-2" role="group" aria-label={`Sobrante ${k + 1}`}>
            <Campo grupo label="Material" className="min-w-36 flex-1">
              <Select value={s.grupoId} onValueChange={(v) => v && cambiar(s.clave, { grupoId: v })}>
                <SelectTrigger aria-label={`Material del sobrante ${k + 1}`} className="w-full">
                  <SelectValue>{grupo ? nombreDeGrupo(grupo) : "Elige el material"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {grupos.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {nombreDeGrupo(g)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>
            <Campo label="Largo" className="w-20">
              <Input inputMode="decimal" className="tnum" value={s.largo} onChange={(e) => cambiar(s.clave, { largo: e.target.value })} />
            </Campo>
            <Campo label="Ancho" className="w-20">
              <Input inputMode="decimal" className="tnum" value={s.ancho} onChange={(e) => cambiar(s.clave, { ancho: e.target.value })} />
            </Campo>
            <Campo grupo label="Se fue a" className="w-36">
              <SelectorAlmacen
                almacenes={almacenes}
                valor={s.almacenId}
                alCambiar={(id) => cambiar(s.clave, { almacenId: id })}
                etiqueta={`Almacén del sobrante ${k + 1}`}
              />
            </Campo>
            <Campo label="Ubicación" className="w-24">
              <Input
                value={s.ubicacion}
                maxLength={80}
                placeholder="Rack 2"
                onChange={(e) => cambiar(s.clave, { ubicacion: e.target.value })}
              />
            </Campo>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Quitar el sobrante ${k + 1}`}
              onClick={() => alCambiar(sobrantes.filter((x) => x.clave !== s.clave))}
            >
              <X className="size-4" />
            </Button>
          </div>
        );
      })}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="gap-1.5 self-start"
        onClick={() =>
          alCambiar([
            ...sobrantes,
            {
              clave: siguienteSobrante++,
              grupoId: grupos.length === 1 ? grupos[0].id : (l.terminado?.material?.grupoId ?? null),
              largo: "",
              ancho: "",
              ubicacion: "",
              almacenId: taller,
            },
          ])
        }
      >
        <Plus className="size-3.5" />
        Agregar sobrante
      </Button>
    </fieldset>
  );
}

/**
 * Con el piloto de sobrantes: la orden de fabricación del corte y los pedazos
 * que volvieron al almacén, cada uno con su etiqueta.
 */
function Produccion({ linea: l, sobrantes }: { linea: LineaDePedido; sobrantes: Sobrante[] }) {
  return (
    <div className="bg-muted/30 flex flex-col gap-2 rounded-lg border px-3 py-2.5 text-sm">
      <p className="flex flex-wrap items-center gap-x-2">
        <Factory className="text-muted-foreground size-4" aria-hidden />
        <span className="font-medium">Producción</span>
        <span className="text-muted-foreground">
          {l.produccionNombre
            ? `${l.produccionNombre} · ${l.produccionCerrada ? "cerrada en Odoo" : "abierta en Odoo"}`
            : "La orden de fabricación se crea en Odoo al confirmar el pedido."}
        </span>
      </p>
      {sobrantes.length > 0 && (
        <ul className="flex flex-col gap-1.5" aria-label="Sobrantes guardados">
          {sobrantes.map((s) => (
            <li key={s.codigo} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-primary font-mono text-xs font-semibold">{s.codigo}</span>
              <span className="tnum">{medidaSobrante(s)} cm</span>
              <span className="text-xs font-medium">{s.almacen}</span>
              <span className="text-muted-foreground text-xs">{s.ubicacion ?? "Sin ubicación"}</span>
              {s.sincronizacion !== "sincronizada" && (
                <span className="text-st-observado text-xs">Falta crearlo en Odoo</span>
              )}
              <Button
                render={<Link href={`/sobrantes/${encodeURIComponent(s.codigo)}/etiqueta`} />}
                nativeButton={false}
                variant="ghost"
                size="xs"
                className="ml-auto gap-1"
                aria-label={`Etiqueta de ${s.codigo}`}
              >
                <Printer className="size-3" />
                Etiqueta
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EstadoOdoo({
  pedido: p,
  odoo,
  hayCortes,
  hayTerminados,
}: {
  pedido: Pedido;
  odoo: OdooDePedido;
  hayCortes: boolean;
  hayTerminados: boolean;
}) {
  const { permisos } = useStore();
  const [pendiente, iniciar] = useTransition();

  const reintentar = () =>
    iniciar(async () => {
      const r = await acciones.reintentarOdooDePedido({ codigo: p.codigo });
      if (r.ok) toast.success(p.estado === "anulado" ? "Venta cancelada en Odoo" : "Stock descontado en Odoo");
      else toast.error("Odoo no lo hizo", { description: r.error });
    });

  let aviso: { tono: "ok" | "error" | "nota"; texto: string; reintentar?: boolean };
  if (p.estado === "anulado") {
    if (odoo.anuladaEnOdoo) aviso = { tono: "ok", texto: "Venta cancelada en Odoo: lo reservado quedó libre." };
    else if (odoo.errorAnulacion)
      aviso = {
        tono: "error",
        texto: `No se canceló la venta en Odoo. ${odoo.errorAnulacion}`,
        reintentar: !odoo.stockDescontado,
      };
    else return null;
  } else if (odoo.stockDescontado) {
    aviso = { tono: "ok", texto: "Stock descontado en Odoo." };
  } else if (odoo.errorStock) {
    aviso = {
      tono: "error",
      texto: `No se descontó el stock en Odoo. ${odoo.errorStock}`,
      reintentar: yaTerminado(p),
    };
  } else if (yaTerminado(p)) {
    aviso = { tono: "nota", texto: "El stock todavía no se descontó en Odoo.", reintentar: true };
  } else {
    aviso = {
      tono: "nota",
      texto: hayTerminados
        ? "El material se descuenta del stock en Odoo al pasar a Listo, con lo que anotes como usado."
        : hayCortes
        ? "Las planchas se descuentan del stock en Odoo al pasar a Listo, con las que anotes como usadas."
        : "Los productos se descuentan del stock en Odoo al pasar a Listo.",
    };
  }

  const Icono = aviso.tono === "ok" ? CircleCheck : aviso.tono === "error" ? TriangleAlert : null;

  return (
    <footer className="bg-muted/30 flex flex-wrap items-center gap-x-3 gap-y-2 border-t px-4 py-3 text-xs">
      <p className="flex min-w-0 flex-1 items-start gap-1.5" role={aviso.tono === "error" ? "alert" : undefined}>
        {Icono && (
          <Icono
            className={
              aviso.tono === "ok" ? "text-st-entregado mt-px size-3.5 shrink-0" : "text-st-observado mt-px size-3.5 shrink-0"
            }
            aria-hidden
          />
        )}
        <span className={aviso.tono === "nota" ? "text-muted-foreground" : undefined}>{aviso.texto}</span>
      </p>
      {permisos.gestionarCotizaciones && (
        <Link href={`/cotizaciones/${odoo.cotizacionId}`} className="text-muted-foreground font-mono hover:underline">
          {odoo.orderName ?? "Cotización"}
        </Link>
      )}
      {aviso.reintentar && (
        <Button variant="outline" size="sm" onClick={reintentar} disabled={pendiente} className="gap-1.5">
          <RotateCw className="size-3.5" />
          {pendiente ? "Intentando…" : "Reintentar"}
        </Button>
      )}
    </footer>
  );
}
