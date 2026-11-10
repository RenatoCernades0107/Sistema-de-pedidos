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
import { MODALIDADES, type CalculoCorte, type LineaDesglose, type Modalidad, type PiezaPedida } from "./calcular";
import type { Cobro } from "./cobro";
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
}

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
  rotable: boolean;
  piezas: PiezaPedida[];
  /** La plancha elegida, con su precio de Odoo en ese momento. */
  formato: { codigo: string; ancho: number; alto: number; precio: number };
  planchas: PlanchaGuardada[];
  montoMaterial: number;
  montoServicio: number;
  total: number;
  minutosLaser: number | null;
  desglose: LineaDesglose[];
  /** El producto de Odoo con el que se factura el corte. */
  servicio: { productoId: number; codigo: string; nombre: string };
  /** Si el grupo registraba sobrantes en Odoo cuando se cotizó. */
  sobrantes: boolean;
}

/** Los datos del corte que no salen del cálculo. */
export interface DatosCorte {
  grupoId: string;
  material: string;
  color: string;
  espesorMm: number;
  modalidad: Modalidad;
  rotable: boolean;
  piezas: PiezaPedida[];
  servicio: CorteGuardado["servicio"];
  sobrantes: boolean;
}

const redondear = (n: number, decimales: number) => {
  const f = 10 ** decimales;
  return Math.round((n + Number.EPSILON) * f) / f;
};

/** Medidas al milímetro: de sobra para dibujar, y el JSON no arrastra 0.30000000000000004. */
const cm = (n: number) => redondear(n, 3);

export function guardarCorte(datos: DatosCorte, calculo: CalculoCorte): CorteGuardado {
  return {
    version: 1,
    ...datos,
    piezas: datos.piezas.map((p) => ({ ancho: p.ancho, alto: p.alto, cantidad: Math.floor(p.cantidad) })),
    formato: calculo.formato,
    planchas: calculo.planchas.map((p) => ({
      origen: p.origen,
      ancho: p.ancho,
      alto: p.alto,
      usoPct: redondear(p.usoPct, 1),
      piezas: p.piezas,
      cobro: { ...p.cobro, ancho: cm(p.cobro.ancho), alto: cm(p.cobro.alto) },
      paneles: p.paneles.map((x) => ({ ...x, x1: cm(x.x1), y1: cm(x.y1), x2: cm(x.x2), y2: cm(x.y2) })),
    })),
    montoMaterial: calculo.material,
    montoServicio: calculo.servicio,
    total: calculo.total,
    minutosLaser: calculo.minutosLaser === null ? null : redondear(calculo.minutosLaser, 2),
    desglose: calculo.desglose,
    servicio: datos.servicio,
    sobrantes: datos.sobrantes,
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

const esquema = z.object({
  version: z.literal(1),
  grupoId: z.string(),
  material: z.string(),
  color: z.string(),
  espesorMm: numero,
  modalidad: z.enum(["laser", "manual"]),
  rotable: z.boolean(),
  piezas: z.array(z.object({ ancho: numero, alto: numero, cantidad: numero })),
  formato: z.object({ codigo: z.string(), ancho: numero, alto: numero, precio: numero }),
  planchas: z.array(
    z.object({
      origen: origen.catch({ tipo: "plancha" }),
      ancho: numero,
      alto: numero,
      usoPct: numero,
      piezas: numero,
      cobro: z.object({
        nombre: z.string(),
        factor: numero,
        ancho: numero,
        alto: numero,
        monto: numero,
        nota: z.string().nullable(),
      }),
      paneles: z.array(panel),
    }),
  ),
  montoMaterial: numero,
  montoServicio: numero,
  total: numero,
  minutosLaser: numero.nullable(),
  desglose: z.array(z.object({ etiqueta: z.string(), monto: numero, esTotal: z.boolean().optional() })),
  servicio: z.object({ productoId: numero, codigo: z.string(), nombre: z.string() }),
  sobrantes: z.boolean().catch(false),
}) satisfies z.ZodType<CorteGuardado>;

/** El corte de una línea, o `null` si la línea no es un corte o el JSON no se entiende. */
export function leerCorte(json: unknown): CorteGuardado | null {
  const r = esquema.safeParse(json);
  return r.success ? r.data : null;
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

/** "3 planchas de 122×183". */
export function planchasTexto(c: Pick<CorteGuardado, "planchas" | "formato">): string {
  const cuantas = c.planchas.length;
  return `${cuantas} ${cuantas === 1 ? "plancha" : "planchas"} de ${n(c.formato.ancho)}×${n(c.formato.alto)}`;
}

/** Cuántas piezas son en total. */
export const totalPiezas = (piezas: PiezaPedida[]) =>
  piezas.reduce((s, p) => s + (p.cantidad > 0 ? Math.floor(p.cantidad) : 0), 0);

/** "media plancha", "un cuarto de plancha", "plancha completa". */
export function fraccionEnPalabras(nombre: string): string {
  if (nombre === "1") return "plancha completa";
  if (nombre === "1/2") return "media plancha";
  if (nombre === "1/4") return "un cuarto de plancha";
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
