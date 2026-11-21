/**
 * Un corte tal como se guarda con su línea (`cotizacion_productos.corte`).
 *
 * Es el cálculo entero, congelado: lo que se le cotizó al cliente. No se rehace
 * al leer —si mañana cambia el precio del corte, esta cotización sigue diciendo
 * lo que dijo—, y trae el acomodo de las piezas, que es de donde sale la hoja de
 * corte del taller.
 *
 * Sin dependencias de servidor: lo leen también los componentes del navegador.
 */

import { z } from "zod";
import {
  MODALIDADES,
  type CalculoCorte,
  type EleccionPlancha,
  type LineaDesglose,
  type Modalidad,
  type PiezaPedida,
} from "./calcular";
import type { Cobro } from "./cobro";
import type { CorteManual } from "./metros";
import type { Origen, Panel } from "./optimizador";

export interface PlanchaGuardada {
  /** De dónde sale: una plancha nueva o un sobrante del almacén. */
  origen: Origen;
  ancho: number;
  alto: number;
  usoPct: number;
  /** Cuántas piezas lleva. */
  piezas: number;
  cobro: Cobro;
  paneles: Panel[];
  /** Solo con corte manual: los cortes de cutter, en orden. Los de antes no los traen. */
  cortes?: CorteManual[];
}

/**
 * Dónde se corta: el láser y los productos terminados, siempre en el taller; un
 * corte manual, en el taller o en la tienda. De ese almacén salen las planchas y
 * los sobrantes que usa, y ahí vuelven los que quedan.
 */
export type LugarCorte = "taller" | "tienda";

export const LUGARES_CORTE: Record<LugarCorte, string> = {
  taller: "En el taller",
  tienda: "En la tienda",
};

/** El lugar que vale: el láser no se mueve del taller. */
export const lugarDeCorte = (c: { modalidad: Modalidad; lugar?: LugarCorte | null }): LugarCorte =>
  c.modalidad === "laser" ? "taller" : (c.lugar ?? "taller");

export interface CorteGuardado {
  version: 1;
  /** El grupo del catálogo (`grupos_plancha.id`) del que se cortó. */
  grupoId: string;
  /** "Acrílico ECO". */
  material: string;
  /** "Cristal", "Blanco lechoso" o, si el código es de varios colores, el que se pidió. */
  color: string;
  espesorMm: number;
  modalidad: Modalidad;
  /** Dónde se corta (`lugarDeCorte`). */
  lugar: LugarCorte;
  rotable: boolean;
  piezas: PiezaPedida[];
  /** La plancha elegida, con su precio de Odoo en ese momento. */
  formato: { codigo: string; ancho: number; alto: number; precio: number };
  planchas: PlanchaGuardada[];
  montoMaterial: number;
  montoServicio: number;
  total: number;
  minutosLaser: number | null;
  /** Metros lineales de cutter (solo corte manual; los de antes no lo guardaban). */
  metrosManual?: number | null;
  desglose: LineaDesglose[];
  /** El producto de Odoo con el que se factura el corte. */
  servicio: { productoId: number; codigo: string; nombre: string };
  /** Si el grupo registraba sobrantes en Odoo cuando se cotizó. */
  sobrantes: boolean;
  /**
   * La plancha o el sobrante que se eligió a mano. Sin ella (o `null`), manda la
   * sugerencia: al reservar se usan los sobrantes que haya.
   */
  eleccion?: EleccionPlancha | null;
}

/** Los datos del corte que no salen del cálculo. */
export interface DatosCorte {
  grupoId: string;
  material: string;
  color: string;
  espesorMm: number;
  modalidad: Modalidad;
  lugar: LugarCorte;
  rotable: boolean;
  piezas: PiezaPedida[];
  servicio: CorteGuardado["servicio"];
  sobrantes: boolean;
  eleccion?: EleccionPlancha | null;
}

const redondear = (n: number, decimales: number) => {
  const f = 10 ** decimales;
  return Math.round((n + Number.EPSILON) * f) / f;
};

/** Medidas al milímetro: de sobra para dibujar, y el JSON no arrastra 0.30000000000000004. */
const cm = (n: number) => redondear(n, 3);

/** Las planchas del cálculo como se guardan: redondeadas al milímetro. */
export function guardarPlanchas(planchas: CalculoCorte["planchas"]): PlanchaGuardada[] {
  return planchas.map((p) => ({
    origen: p.origen,
    ancho: p.ancho,
    alto: p.alto,
    usoPct: redondear(p.usoPct, 1),
    piezas: p.piezas,
    cobro: { ...p.cobro, ancho: cm(p.cobro.ancho), alto: cm(p.cobro.alto) },
    paneles: p.paneles.map((x) => ({ ...x, x1: cm(x.x1), y1: cm(x.y1), x2: cm(x.x2), y2: cm(x.y2) })),
    ...(p.cortes && {
      cortes: p.cortes.map((x) => ({ ...x, x1: cm(x.x1), y1: cm(x.y1), x2: cm(x.x2), y2: cm(x.y2), largo: cm(x.largo) })),
    }),
  }));
}

export function guardarCorte(datos: DatosCorte, calculo: CalculoCorte): CorteGuardado {
  return {
    version: 1,
    ...datos,
    lugar: lugarDeCorte(datos),
    piezas: datos.piezas.map((p) => ({ ancho: p.ancho, alto: p.alto, cantidad: Math.floor(p.cantidad) })),
    formato: calculo.formato,
    planchas: guardarPlanchas(calculo.planchas),
    montoMaterial: calculo.material,
    montoServicio: calculo.servicio,
    total: calculo.total,
    minutosLaser: calculo.minutosLaser === null ? null : redondear(calculo.minutosLaser, 2),
    metrosManual: calculo.metrosManual === null ? null : redondear(calculo.metrosManual, 2),
    desglose: calculo.desglose,
    servicio: datos.servicio,
    sobrantes: datos.sobrantes,
    eleccion: datos.eleccion ?? null,
  };
}

/* ── Leer lo guardado ──────────────────────────────────────────────────────── */

const numero = z.number().finite();

const panel = z.object({
  x1: numero,
  y1: numero,
  x2: numero,
  y2: numero,
  libre: z.boolean(),
  piezaId: z.string().optional(),
  rotada: z.boolean().optional(),
  sobrante: z.boolean().optional(),
});

const origen = z.union([
  z.object({ tipo: z.literal("plancha") }),
  z.object({ tipo: z.literal("sobrante"), id: z.string() }),
]);

/** Una plancha guardada, para leerla también desde la ficha de un producto terminado. */
export const esquemaPlancha = z.object({
  origen: origen.catch({ tipo: "plancha" }),
  ancho: numero,
  alto: numero,
  usoPct: numero,
  piezas: numero,
  cobro: z.object({
    nombre: z.string(),
    factor: numero,
    // Los cortes de antes del recargo por fracción no lo guardaban.
    recargoPct: numero.catch(0),
    ancho: numero,
    alto: numero,
    monto: numero,
    nota: z.string().nullable(),
  }),
  paneles: z.array(panel),
  cortes: z
    .array(z.object({ n: numero, x1: numero, y1: numero, x2: numero, y2: numero, largo: numero }))
    .optional()
    .catch(undefined),
}) satisfies z.ZodType<PlanchaGuardada>;

/** La plancha o el sobrante elegidos a mano, al leerlos de lo guardado. */
export const esquemaEleccion = z
  .object({ tipo: z.enum(["formato", "sobrante"]), codigo: z.string() })
  .nullable()
  .optional()
  .catch(null);

const esquema = z.object({
  version: z.literal(1),
  grupoId: z.string(),
  material: z.string(),
  color: z.string(),
  espesorMm: numero,
  modalidad: z.enum(["laser", "manual"]),
  // Los cortes de antes de los almacenes se hicieron todos en el taller.
  lugar: z.enum(["taller", "tienda"]).catch("taller"),
  rotable: z.boolean(),
  piezas: z.array(z.object({ ancho: numero, alto: numero, cantidad: numero })),
  formato: z.object({ codigo: z.string(), ancho: numero, alto: numero, precio: numero }),
  planchas: z.array(esquemaPlancha),
  montoMaterial: numero,
  montoServicio: numero,
  total: numero,
  minutosLaser: numero.nullable(),
  metrosManual: numero.nullable().optional().catch(null),
  desglose: z.array(z.object({ etiqueta: z.string(), monto: numero, esTotal: z.boolean().optional() })),
  servicio: z.object({ productoId: numero, codigo: z.string(), nombre: z.string() }),
  sobrantes: z.boolean().catch(false),
  eleccion: esquemaEleccion,
}) satisfies z.ZodType<CorteGuardado>;

/** El corte de una línea, o `null` si la línea no es un corte o el JSON no se entiende. */
export function leerCorte(json: unknown): CorteGuardado | null {
  const r = esquema.safeParse(json);
  return r.success ? { ...r.data, lugar: lugarDeCorte(r.data) } : null;
}

/* ── Decirlo en palabras ───────────────────────────────────────────────────── */

const n = (x: number) => String(+x.toFixed(2));

/** "10 × 60×80 cm, 4 × 30×30 cm". */
export const resumenPiezas = (piezas: PiezaPedida[]) =>
  piezas
    .filter((p) => p.cantidad > 0)
    .map((p) => `${Math.floor(p.cantidad)} × ${n(p.ancho)}×${n(p.alto)} cm`)
    .join(", ");

type ParaTitulo = Pick<CorteGuardado, "material" | "color" | "espesorMm" | "modalidad">;

/** "Acrílico ECO · Cristal · 3 mm". */
export const materialDeCorte = (c: Omit<ParaTitulo, "modalidad">) =>
  [c.material, c.color, `${n(c.espesorMm)} mm`].filter(Boolean).join(" · ");

/** "Corte láser · Acrílico ECO · Cristal · 3 mm". */
export const tituloCorte = (c: ParaTitulo) => `${MODALIDADES[c.modalidad]} · ${materialDeCorte(c)}`;

/** Las planchas nuevas que abre un corte: sin los sobrantes del almacén. */
export const planchasNuevas = (c: Pick<CorteGuardado, "planchas">) =>
  c.planchas.filter((p) => p.origen.tipo === "plancha").length;

/** Los sobrantes del almacén que usa un corte, por su código. */
export const sobrantesUsados = (c: Pick<CorteGuardado, "planchas">) =>
  c.planchas.flatMap((p) => (p.origen.tipo === "sobrante" ? [p.origen.id] : []));

/** "3 planchas de 122×183"; con sobrantes, "2 planchas de 122×183 y 1 sobrante". */
export function planchasTexto(c: Pick<CorteGuardado, "planchas" | "formato">): string {
  const cuantas = planchasNuevas(c);
  const sobrantes = c.planchas.length - cuantas;
  const nuevas = `${cuantas} ${cuantas === 1 ? "plancha" : "planchas"} de ${n(c.formato.ancho)}×${n(c.formato.alto)}`;
  if (!sobrantes) return nuevas;
  const deAlmacen = `${sobrantes} ${sobrantes === 1 ? "sobrante" : "sobrantes"}`;
  return cuantas ? `${nuevas} y ${deAlmacen}` : deAlmacen;
}

/** Cuántas piezas son en total. */
export const totalPiezas = (piezas: PiezaPedida[]) =>
  piezas.reduce((s, p) => s + (p.cantidad > 0 ? Math.floor(p.cantidad) : 0), 0);

/** "media plancha", "un cuarto de plancha", "plancha completa". */
export function fraccionEnPalabras(nombre: string): string {
  if (nombre === "1") return "plancha completa";
  if (nombre === "1/2") return "media plancha";
  if (nombre === "1/4") return "un cuarto de plancha";
  if (nombre === "3/4") return "tres cuartos de plancha";
  if (nombre === "1/8") return "un octavo de plancha";
  if (nombre === "1/16") return "un dieciseisavo de plancha";
  return `${nombre} de plancha`;
}

/**
 * Las planchas de un corte agrupadas por lo que se cobra de cada una: así van a
 * Odoo, una línea por precio distinto ("2 planchas completas", "1 media").
 */
export function planchasPorCobro(c: Pick<CorteGuardado, "planchas">) {
  const grupos = new Map<string, { nombre: string; monto: number; cantidad: number }>();
  for (const p of c.planchas) {
    const clave = `${p.cobro.nombre}|${p.cobro.monto}`;
    const g = grupos.get(clave);
    if (g) g.cantidad += 1;
    else grupos.set(clave, { nombre: p.cobro.nombre, monto: p.cobro.monto, cantidad: 1 });
  }
  // Las completas primero: es como se lee una cotización.
  return [...grupos.values()].sort((a, b) => b.monto - a.monto);
}
