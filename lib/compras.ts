/**
 * Las compras en el idioma de la pantalla: estados, lo que llega del navegador
 * y lo que se muestra. Sin dependencias de servidor.
 *
 * El recorrido (docs/proceso-compras.svg):
 *   borrador (pre-compra) → confirmada (orden de compra en Odoo) → Almacén recibe
 *   (recibida_parcial / recibida) → se cargan los gastos → liquidada.
 */

import { z } from "zod";
import { sumarDias } from "./dominio";
import { diaEnLima } from "./fecha";
import {
  CONCEPTOS,
  montoManoObra,
  type ConceptoGasto,
  type GastoCosteo,
  type Incoterm,
  type Liquidacion,
  type Moneda,
  type Reparto,
  type TipoCompra,
  type TipoManoObra,
} from "./costeo";

export type EstadoCompra = "borrador" | "confirmada" | "recibida_parcial" | "recibida" | "liquidada" | "anulada";
export type CondicionPago = "contado" | "contra_entrega" | "adelantado" | "credito";
export type Sincronizacion = "pendiente" | "sincronizada" | "error";

export const ESTADOS_COMPRA: Record<EstadoCompra, string> = {
  borrador: "Pre-compra",
  confirmada: "Confirmada",
  recibida_parcial: "Recibida en parte",
  recibida: "Recibida",
  liquidada: "Liquidada",
  anulada: "Anulada",
};

export const TIPOS_COMPRA: Record<TipoCompra, string> = {
  nacional: "Nacional",
  importacion: "Importación",
};

export const CONDICIONES_PAGO: Record<CondicionPago, string> = {
  contado: "Al contado",
  contra_entrega: "Contra entrega",
  adelantado: "Adelantado",
  credito: "Crédito",
};

/** Las condiciones que tiene sentido ofrecer en cada tipo de compra. */
export const condicionesDe = (tipo: TipoCompra): CondicionPago[] =>
  tipo === "nacional" ? ["contado", "contra_entrega", "credito"] : ["adelantado", "credito"];

/** Qué se puede hacer con una compra en cada estado. */
export const sePuedeEditar = (e: EstadoCompra) => e === "borrador";
export const sePuedeConfirmar = (e: EstadoCompra) => e === "borrador";
export const sePuedeRecibir = (e: EstadoCompra) => e === "confirmada" || e === "recibida_parcial";
export const sePuedenCargarGastos = (e: EstadoCompra) => e !== "liquidada" && e !== "anulada";
export const sePuedeLiquidar = (e: EstadoCompra) => e === "recibida";

/** El estado según lo recibido de cada ítem. */
export function estadoPorRecepcion(lineas: { cantidad: number; recibida: number }[]): EstadoCompra {
  const algo = lineas.some((l) => l.recibida > 0);
  const todo = lineas.every((l) => l.recibida >= l.cantidad);
  return todo ? "recibida" : algo ? "recibida_parcial" : "confirmada";
}

/** El vencimiento del crédito: en importación se cuenta desde el embarque. */
export function vencimientoCredito(c: {
  condicionPago: CondicionPago;
  diasCredito: number | null;
  fechaEmbarque: string | null;
  confirmadaEn: string | null;
  tipo: TipoCompra;
}): string | null {
  if (c.condicionPago !== "credito" || !c.diasCredito) return null;
  const desde = c.tipo === "importacion" ? c.fechaEmbarque : (c.confirmadaEn?.slice(0, 10) ?? null);
  return desde ? sumarDias(desde, c.diasCredito) : null;
}

/** La diferencia entre cantidad × precio y el total que escribió el proveedor. */
export function descuadre(l: { cantidad: number; precioUnitario: number; totalProveedor: number | null }): number | null {
  if (l.totalProveedor === null) return null;
  const d = Math.round((l.cantidad * l.precioUnitario - l.totalProveedor) * 100) / 100;
  return Math.abs(d) >= 0.01 ? d : null;
}

/* ── Lo que llega del navegador ────────────────────────────────────────────── */

const texto = (max: number, mensaje: string) =>
  z
    .string()
    .trim()
    .max(max, mensaje)
    .transform((v) => v || null)
    .nullable();

const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha no es válida")
  .nullable();

const tc = z
  .number({ error: "El tipo de cambio es un número" })
  .positive("El tipo de cambio tiene que ser mayor que cero")
  .max(20, "Ese tipo de cambio no es razonable")
  .nullable();

const monto = (max: number) =>
  z.number({ error: "Escribe un número" }).min(0, "No puede ser negativo").max(max, "Ese monto no es razonable");

export const esquemaCompra = z
  .object({
    id: z.uuid().nullable(),
    tipo: z.enum(["nacional", "importacion"]),
    proveedorId: z.number({ error: "Elige el proveedor" }).int().positive("Elige el proveedor"),
    proveedorNombre: z.string().trim().min(1, "Elige el proveedor").max(160),
    almacenId: z.uuid("Elige el almacén al que llega"),
    documentoProveedor: texto(60, "La proforma o cotización es muy larga"),
    monedaMercaderia: z.enum(["PEN", "USD"]),
    tcMercaderia: tc,
    tcGastos: tc,
    incoterm: z.enum(["FOB", "CIF"]).nullable(),
    condicionPago: z.enum(["contado", "contra_entrega", "adelantado", "credito"]),
    diasCredito: z.number().int().min(1, "Los días de crédito van de 1 a 365").max(365, "Los días de crédito van de 1 a 365").nullable(),
    fechaEmbarque: fecha,
    fechaLlegadaEstimada: fecha,
    nota: texto(1000, "La nota es muy larga"),
    lineas: z
      .array(
        z.object({
          productoId: z.number().int().positive(),
          cantidad: z
            .number({ error: "La cantidad es un número" })
            .int("Las planchas van en unidades enteras")
            .min(1, "Cada ítem lleva al menos una unidad")
            .max(99_999, "Son demasiadas unidades"),
          kilos: z.number({ error: "Los kilos son un número" }).positive("Los kilos tienen que ser mayores que cero").max(1_000_000).nullable(),
          precioUnitario: monto(1_000_000),
          totalProveedor: monto(100_000_000).nullable(),
        }),
      )
      .min(1, "Agrega al menos un ítem")
      .max(100, "Son demasiados ítems para una sola compra"),
  })
  .superRefine((v, ctx) => {
    if (v.tipo === "nacional" && v.incoterm) {
      ctx.addIssue({ code: "custom", path: ["incoterm"], message: "Una compra nacional no lleva incoterm" });
    }
    if (v.tipo === "importacion" && !v.incoterm) {
      ctx.addIssue({ code: "custom", path: ["incoterm"], message: "Elige si es FOB o CIF" });
    }
    if (v.monedaMercaderia === "USD" && !v.tcMercaderia) {
      ctx.addIssue({ code: "custom", path: ["tcMercaderia"], message: "Escribe el tipo de cambio de la mercadería" });
    }
    if (v.condicionPago === "credito" && !v.diasCredito) {
      ctx.addIssue({ code: "custom", path: ["diasCredito"], message: "Escribe los días de crédito" });
    }
    const ids = v.lineas.map((l) => l.productoId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", path: ["lineas"], message: "Un producto está dos veces: júntalo en un solo ítem" });
    }
  });

export type NuevaCompra = z.output<typeof esquemaCompra>;

export const esquemaGastos = z.object({
  compraId: z.uuid(),
  tcGastos: tc,
  gastos: z
    .array(
      z
        .object({
          concepto: z.enum(CONCEPTOS),
          descripcion: texto(120, "La descripción es muy larga"),
          moneda: z.enum(["PEN", "USD"]),
          monto: monto(100_000_000),
          reparto: z.enum(["valor", "peso", "cantidad", "no_costo"]),
          tipoManoObra: z.enum(["descarga", "supervision", "despacho"]).nullable(),
          personas: z.number().min(0).max(1000).nullable(),
          horas: z.number().min(0).max(10_000).nullable(),
          tarifa: monto(1000).nullable(),
          fechaPago: fecha,
          documento: texto(60, "El documento es muy largo"),
        })
        .superRefine((g, ctx) => {
          if (g.concepto === "mano_obra" && (!g.tipoManoObra || g.personas === null || g.horas === null || g.tarifa === null)) {
            ctx.addIssue({ code: "custom", path: ["horas"], message: "La mano de obra lleva tipo, personas, horas y tarifa" });
          }
        }),
    )
    .max(80, "Son demasiados gastos"),
});

export type GastosDeCompra = z.output<typeof esquemaGastos>;

export const esquemaRecepcion = z.object({
  compraId: z.uuid(),
  nota: texto(500, "La nota es muy larga"),
  lineas: z
    .array(
      z.object({
        posicion: z.number().int().positive(),
        cantidad: z.number({ error: "Escribe cuántas llegaron" }).int("Van en unidades enteras").min(0).max(99_999),
      }),
    )
    .min(1),
});

export type NuevaRecepcion = z.output<typeof esquemaRecepcion>;

/* ── Lo que se muestra ─────────────────────────────────────────────────────── */

export interface LineaCompra {
  posicion: number;
  productoId: number;
  codigo: string | null;
  nombre: string;
  cantidad: number;
  kilos: number | null;
  precioUnitario: number;
  totalProveedor: number | null;
  recibida: number;
}

export interface GastoCompra {
  concepto: ConceptoGasto;
  descripcion: string | null;
  moneda: Moneda;
  monto: number;
  reparto: Reparto;
  tipoManoObra: TipoManoObra | null;
  personas: number | null;
  horas: number | null;
  tarifa: number | null;
  fechaPago: string | null;
  documento: string | null;
}

export interface RecepcionCompra {
  id: string;
  creadoEn: string;
  creadoPor: string | null;
  nota: string | null;
  sincronizacion: Sincronizacion;
  error: string | null;
  lineas: { posicion: number; cantidad: number }[];
}

export interface CompraResumen {
  id: string;
  codigo: string;
  tipo: TipoCompra;
  estado: EstadoCompra;
  proveedor: string;
  almacen: string;
  /** La factura o proforma del proveedor. */
  documentoProveedor: string | null;
  /** El número de la orden en Odoo ("P01727"), cuando ya se conoce. */
  odooOrden: string | null;
  monedaMercaderia: Moneda;
  /** Cantidad × precio, en la moneda de la mercadería. */
  totalMercaderia: number;
  items: number;
  fechaLlegadaEstimada: string | null;
  sincronizacion: Sincronizacion | null;
  error: string | null;
  creadoEn: string;
}

export interface CompraDetalle extends CompraResumen {
  proveedorId: number;
  almacenId: string;
  tcMercaderia: number | null;
  tcGastos: number | null;
  incoterm: Incoterm | null;
  condicionPago: CondicionPago;
  diasCredito: number | null;
  fechaEmbarque: string | null;
  nota: string | null;
  odooOrdenId: number | null;
  confirmadaEn: string | null;
  liquidadaEn: string | null;
  liquidadaPor: string | null;
  creadoPor: string | null;
  lineas: LineaCompra[];
  gastos: GastoCompra[];
  recepciones: RecepcionCompra[];
}

/** Un gasto listo para `liquidar`: la mano de obra se resuelve con sus horas. */
export function gastoParaCosteo(g: GastoCompra): GastoCosteo {
  const m =
    g.concepto === "mano_obra" && g.personas !== null && g.horas !== null && g.tarifa !== null
      ? montoManoObra(g.personas, g.horas, g.tarifa)
      : g.monto;
  return { concepto: g.concepto, moneda: g.moneda, monto: m, reparto: g.reparto };
}

/** Lo que se guarda en el historial por plancha, del resultado de la liquidación. */
export function desgloseUnitario(l: Liquidacion["lineas"][number], cantidad: number) {
  const porUnidad = (n: number) => Math.round((n / cantidad) * 10_000) / 10_000;
  return {
    mercaderia: porUnidad(l.mercaderiaPen),
    gastos: Object.fromEntries(Object.entries(l.gastos).map(([k, v]) => [k, porUnidad(v ?? 0)])),
  };
}

/**
 * Lo que la persona ve como identificador de una compra: el número de la orden
 * en Odoo ("P01722") si ya existe; si no (pre-compra o aún sin orden), el CMP.
 * Solo es para mostrar: la URL, el valor guardado y el origen en Odoo usan `codigo`.
 */
export const codigoVisible = (c: { codigo: string; odooOrden: string | null }) => c.odooOrden?.trim() || c.codigo;

/**
 * ¿La compra se creó dentro del rango de días (en Lima, ambos inclusivos)?
 * `desde` y `hasta` vienen de un input date ("2026-11-26") o vacíos.
 */
export function creadaEnRango(creadoEn: string, desde: string, hasta: string): boolean {
  if (!desde && !hasta) return true;
  const dia = diaEnLima(creadoEn);
  if (!dia) return false;
  return (!desde || dia >= desde) && (!hasta || dia <= hasta);
}
