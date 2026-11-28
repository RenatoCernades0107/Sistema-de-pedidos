import { z } from "zod";
import type { Canal } from "@/lib/cotizaciones";
import type { ClienteOdoo, ContactoOdoo } from "@/lib/odoo/tipos";
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

export type TipoBorrador = "pedido" | "cotizacion" | "compra";

export const HORAS_BORRADOR = 48;

/** Lo que se ve de un borrador en la lista, sin abrir `datos`. */
export interface ResumenBorrador {
  cliente: string | null;
  productos: number;
  total: number;
  /** Solo en compras: la moneda en que está el total (si no, soles). */
  moneda?: "PEN" | "USD";
}

export interface DatosBorradorCotizacion {
  version: 1;
  canal: Canal;
  cliente: ClienteOdoo | null;
  /** Quién atiende por la empresa, si se eligió. */
  contacto?: ContactoOdoo | null;
  lineas: Linea[];
  notas: string;
  /** El diseño CAD de cada línea de producto terminado, por clave: para volver a abrirlo. */
  disenosDeLinea: Record<string, string>;
}

export interface DatosBorradorPedido {
  version: 1;
  cliente: ClienteOdoo | null;
  contacto?: ContactoOdoo | null;
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

/** Un ítem del editor de compra tal como se escribe (todo texto). */
export interface FilaBorradorCompra {
  productoId: number;
  codigo: string;
  titulo: string;
  cantidad: string;
  kilos: string;
  precio: string;
  total: string;
}

/** El editor de "Nueva compra" a medio llenar: tal cual está en pantalla, sin validar. */
export interface DatosBorradorCompra {
  version: 1;
  tipo: "nacional" | "importacion";
  proveedor: ClienteOdoo | null;
  almacenId: string | null;
  documento: string;
  moneda: "PEN" | "USD";
  tcMerc: string;
  tcGastos: string;
  incoterm: "FOB" | "CIF" | null;
  condicion: "contado" | "contra_entrega" | "adelantado" | "credito";
  dias: string;
  embarque: string;
  llegada: string;
  nota: string;
  filas: FilaBorradorCompra[];
}

export type DatosBorrador = DatosBorradorCotizacion | DatosBorradorPedido | DatosBorradorCompra;

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

const esquemaContacto = z.looseObject({ id: z.number().int(), nombre: z.string() }).nullish();

const esquemaClaves = z.record(z.string().max(100), z.string().max(100));

export const esquemaDatosCotizacion = z.object({
  version: z.literal(1),
  canal: z.string().max(40),
  cliente: esquemaCliente,
  contacto: esquemaContacto,
  lineas: z.array(esquemaLinea).max(500),
  notas: z.string().max(2000),
  disenosDeLinea: esquemaClaves,
});

export const esquemaDatosPedido = z.object({
  version: z.literal(1),
  cliente: esquemaCliente,
  contacto: esquemaContacto,
  lineas: z.array(esquemaLinea).max(500),
  campos: z.record(z.string().max(60), z.unknown()),
  indicaciones: z.record(z.string().max(100), z.string().max(5000)),
  conObservaciones: z.boolean(),
  disenosDeLinea: esquemaClaves,
  archivosOmitidos: z.array(z.string().max(300)).max(200),
});

const texto = (max: number) => z.string().max(max);

export const esquemaDatosCompra = z.object({
  version: z.literal(1),
  tipo: z.enum(["nacional", "importacion"]),
  proveedor: esquemaCliente,
  almacenId: z.string().max(60).nullable(),
  documento: texto(200),
  moneda: z.enum(["PEN", "USD"]),
  tcMerc: texto(40),
  tcGastos: texto(40),
  incoterm: z.enum(["FOB", "CIF"]).nullable(),
  condicion: z.enum(["contado", "contra_entrega", "adelantado", "credito"]),
  dias: texto(40),
  embarque: texto(20),
  llegada: texto(20),
  nota: texto(2000),
  filas: z
    .array(
      z.object({
        productoId: z.number().int(),
        codigo: texto(100),
        titulo: texto(300),
        cantidad: texto(40),
        kilos: texto(40),
        precio: texto(40),
        total: texto(40),
      }),
    )
    .max(500),
});

export const esquemaResumen = z.object({
  cliente: z.string().max(300).nullable(),
  productos: z.number().int().min(0),
  total: z.number().finite(),
  moneda: z.enum(["PEN", "USD"]).optional(),
});

export const esquemaGuardarBorrador = z.object({
  id: z.uuid().nullable(),
  tipo: z.enum(["pedido", "cotizacion", "compra"]),
  cotizacionId: z.uuid().nullable(),
  datos: z.unknown(),
  resumen: esquemaResumen,
});

/** Los datos de un borrador, si tienen la forma de su tipo. */
export function leerDatos(tipo: "cotizacion", datos: unknown): DatosBorradorCotizacion | null;
export function leerDatos(tipo: "pedido", datos: unknown): DatosBorradorPedido | null;
export function leerDatos(tipo: "compra", datos: unknown): DatosBorradorCompra | null;
export function leerDatos(tipo: TipoBorrador, datos: unknown): DatosBorrador | null;
export function leerDatos(tipo: TipoBorrador, datos: unknown): DatosBorrador | null {
  const esquema = tipo === "pedido" ? esquemaDatosPedido : tipo === "compra" ? esquemaDatosCompra : esquemaDatosCotizacion;
  const r = esquema.safeParse(datos);
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
  if (b.tipo === "compra") return `/compras/nueva?borrador=${b.id}`;
  const desde = b.cotizacionId ? `cotizacion=${b.cotizacionId}&` : "";
  return `/pedidos/nuevo?${desde}borrador=${b.id}`;
}
