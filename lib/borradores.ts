import { z } from "zod";
import type { Canal } from "@/lib/cotizaciones";
import type { ClienteOdoo } from "@/lib/odoo/tipos";
import { totalReferencial, type Linea } from "@/lib/lineas-cotizacion";

/**
 * Borradores de "Nuevo pedido" y "Nueva cotización": el formulario entero, que
 * se guarda solo mientras se llena y se retoma desde la lista.
 *
 * Vencen a las 48 h sin abrirlos ni editarlos (la base renueva el plazo en
 * cada guardado o apertura) y solo los ve quien los creó (RLS).
 *
 * Lo que se guarda es lo que el formulario tenía en pantalla. No se confía en
 * ello: al crear el pedido o la cotización, el servidor lo valida y recalcula
 * todo como siempre.
 */

export type TipoBorrador = "pedido" | "cotizacion";

export const HORAS_BORRADOR = 48;

/** Lo que se ve de un borrador en la lista, sin abrir `datos`. */
export interface ResumenBorrador {
  cliente: string | null;
  productos: number;
  total: number;
}

export interface DatosBorradorCotizacion {
  version: 1;
  canal: Canal;
  cliente: ClienteOdoo | null;
  lineas: Linea[];
  notas: string;
  /** El diseño CAD de cada línea de producto terminado, por clave: para volver a abrirlo. */
  disenosDeLinea: Record<string, string>;
}

export interface DatosBorradorPedido {
  version: 1;
  cliente: ClienteOdoo | null;
  lineas: Linea[];
  /** Los campos de react-hook-form (entrega, pago, fechas…). */
  campos: Record<string, unknown>;
  /** Las indicaciones para el taller, por ítem. */
  indicaciones: Record<string, string>;
  conObservaciones: boolean;
  disenosDeLinea: Record<string, string>;
  /** Los archivos que tenía adjuntos: no se guardan, se avisa al retomar. */
  archivosOmitidos: string[];
}

export type DatosBorrador = DatosBorradorCotizacion | DatosBorradorPedido;

/** Un borrador de la lista. */
export interface BorradorListado {
  id: string;
  tipo: TipoBorrador;
  cotizacionId: string | null;
  resumen: ResumenBorrador;
  actualizadoEn: string;
  venceEn: string;
}

/** Un borrador abierto para retomarlo. */
export interface BorradorAbierto<D extends DatosBorrador = DatosBorrador> {
  id: string;
  cotizacionId: string | null;
  datos: D;
}

/* ── Validación ──────────────────────────────────────────────────────────────
   Las líneas no se validan campo a campo: son el estado del formulario, y al
   crear el pedido o la cotización pasan por los esquemas de siempre. Aquí basta
   con que tengan la forma general y no sean desmedidas. */

/** Tope del JSON de un borrador: de sobra para un pedido grande, y no más. */
export const MAX_BYTES_BORRADOR = 1_000_000;

const esquemaLinea = z.looseObject({ clave: z.string().min(1).max(100) });

const esquemaCliente = z.looseObject({ id: z.number().int(), nombre: z.string() }).nullable();

const esquemaClaves = z.record(z.string().max(100), z.string().max(100));

export const esquemaDatosCotizacion = z.object({
  version: z.literal(1),
  canal: z.string().max(40),
  cliente: esquemaCliente,
  lineas: z.array(esquemaLinea).max(500),
  notas: z.string().max(2000),
  disenosDeLinea: esquemaClaves,
});

export const esquemaDatosPedido = z.object({
  version: z.literal(1),
  cliente: esquemaCliente,
  lineas: z.array(esquemaLinea).max(500),
  campos: z.record(z.string().max(60), z.unknown()),
  indicaciones: z.record(z.string().max(100), z.string().max(5000)),
  conObservaciones: z.boolean(),
  disenosDeLinea: esquemaClaves,
  archivosOmitidos: z.array(z.string().max(300)).max(200),
});

export const esquemaResumen = z.object({
  cliente: z.string().max(300).nullable(),
  productos: z.number().int().min(0),
  total: z.number().finite(),
});

export const esquemaGuardarBorrador = z.object({
  id: z.uuid().nullable(),
  tipo: z.enum(["pedido", "cotizacion"]),
  cotizacionId: z.uuid().nullable(),
  datos: z.unknown(),
  resumen: esquemaResumen,
});

/** Los datos de un borrador, si tienen la forma de su tipo. */
export function leerDatos(tipo: "cotizacion", datos: unknown): DatosBorradorCotizacion | null;
export function leerDatos(tipo: "pedido", datos: unknown): DatosBorradorPedido | null;
export function leerDatos(tipo: TipoBorrador, datos: unknown): DatosBorrador | null;
export function leerDatos(tipo: TipoBorrador, datos: unknown): DatosBorrador | null {
  const r = (tipo === "pedido" ? esquemaDatosPedido : esquemaDatosCotizacion).safeParse(datos);
  return r.success ? (r.data as unknown as DatosBorrador) : null;
}

/* ── Resumen y plazos ──────────────────────────────────────────────────────── */

export function resumenDe(cliente: { nombre: string } | null, lineas: Linea[]): ResumenBorrador {
  return { cliente: cliente?.nombre ?? null, productos: lineas.length, total: totalReferencial(lineas) };
}

/** Horas enteras que le quedan (redondeando hacia arriba; 0 si ya venció). */
export function horasRestantes(venceEn: string, ahora: number = Date.now()): number {
  const ms = new Date(venceEn).getTime() - ahora;
  return ms > 0 ? Math.ceil(ms / 3_600_000) : 0;
}

/** "hace 5 min", "hace 3 h", "hace 2 días". */
export function haceCuanto(fecha: string, ahora: number = Date.now()): string {
  const min = Math.max(0, Math.floor((ahora - new Date(fecha).getTime()) / 60_000));
  if (min < 1) return "hace un momento";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "hace 1 día" : `hace ${d} días`;
}

/** Dónde se retoma un borrador. */
export function rutaDeBorrador(b: Pick<BorradorListado, "id" | "tipo" | "cotizacionId">): string {
  if (b.tipo === "cotizacion") return `/cotizaciones/nueva?borrador=${b.id}`;
  const desde = b.cotizacionId ? `cotizacion=${b.cotizacionId}&` : "";
  return `/pedidos/nuevo?${desde}borrador=${b.id}`;
}
