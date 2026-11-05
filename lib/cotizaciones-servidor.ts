/**
 * Las cotizaciones del sistema del lado del servidor: leerlas de Supabase y
 * llevarlas a Odoo.
 *
 * Como en el resto de la app, se lee y se escribe con la sesión de quien pide
 * (`clienteServidor`), nunca con la clave de servicio: la RLS de `cotizaciones`
 * es la que dice que solo Administración cotiza.
 */

import { cache } from "react";
import { clienteServidor } from "./supabase-servidor";
import { mensajeDeError } from "./errores";
import type { Canal, Cotizacion, Sincronizacion } from "./cotizaciones";
import { leerCliente } from "./odoo/clientes";
import { crearPedidoDeVenta, leerPedidoDeVenta } from "./odoo/pedidos-venta";
import { ErrorOdoo, odooConfigurado } from "./odoo/rpc";
import type { ClienteOdoo } from "./odoo/tipos";

const COLUMNAS = `
  id, canal, odoo_partner_id, cliente_nombre, cliente_documento, cliente_telefono,
  odoo_order_id, odoo_order_name, sincronizacion, error_sincronizacion,
  monto_sin_impuestos, monto_impuestos, monto_total, notas, chat_agente_id, creado_en,
  creador:usuarios!cotizaciones_creado_por_fkey ( nombre ),
  cotizacion_productos ( posicion, odoo_product_id, producto_nombre, producto_codigo,
                         descripcion, cantidad, precio_unitario )
`;

interface Fila {
  id: string;
  canal: Canal;
  odoo_partner_id: number;
  cliente_nombre: string;
  cliente_documento: string | null;
  cliente_telefono: string | null;
  odoo_order_id: number | null;
  odoo_order_name: string | null;
  sincronizacion: Sincronizacion;
  error_sincronizacion: string | null;
  monto_sin_impuestos: number | null;
  monto_impuestos: number | null;
  monto_total: number | null;
  notas: string | null;
  chat_agente_id: string | null;
  creado_en: string;
  creador: { nombre: string } | { nombre: string }[] | null;
  cotizacion_productos: {
    posicion: number;
    odoo_product_id: number;
    producto_nombre: string;
    producto_codigo: string | null;
    descripcion: string | null;
    cantidad: number;
    precio_unitario: number;
  }[];
}

/** PostgREST devuelve `numeric` como número, pero con decimales largos puede venir como texto. */
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function deFila(f: Fila): Cotizacion {
  const creador = Array.isArray(f.creador) ? f.creador[0] : f.creador;
  return {
    id: f.id,
    canal: f.canal,
    cliente: {
      id: f.odoo_partner_id,
      nombre: f.cliente_nombre,
      documento: f.cliente_documento,
      telefono: f.cliente_telefono,
    },
    odooOrderId: f.odoo_order_id,
    odooOrderName: f.odoo_order_name,
    sincronizacion: f.sincronizacion,
    errorSincronizacion: f.error_sincronizacion,
    montoSinImpuestos: num(f.monto_sin_impuestos),
    montoImpuestos: num(f.monto_impuestos),
    montoTotal: num(f.monto_total),
    notas: f.notas,
    chatAgenteId: f.chat_agente_id,
    creadoPor: creador?.nombre ?? null,
    creadoEn: f.creado_en,
    lineas: [...(f.cotizacion_productos ?? [])]
      .sort((a, b) => a.posicion - b.posicion)
      .map((l) => ({
        posicion: l.posicion,
        productoId: l.odoo_product_id,
        nombre: l.producto_nombre,
        codigo: l.producto_codigo,
        descripcion: l.descripcion,
        cantidad: Number(l.cantidad),
        precioUnitario: Number(l.precio_unitario),
      })),
  };
}

/** Las más recientes. Sin paginar todavía: a este ritmo, 300 son meses de trabajo. */
export async function cargarCotizaciones(limite = 300): Promise<Cotizacion[]> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from("cotizaciones")
    .select(COLUMNAS)
    .order("creado_en", { ascending: false })
    .limit(limite);
  if (error) throw new Error(`No se pudieron leer las cotizaciones: ${error.message}`);
  return ((data ?? []) as unknown as Fila[]).map(deFila);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const cargarCotizacion = cache(async (id: string): Promise<Cotizacion | null> => {
  // Un id mal formado haría fallar a Postgres con un error de sintaxis; es un 404.
  if (!UUID.test(id)) return null;
  const supabase = await clienteServidor();
  const { data, error } = await supabase.from("cotizaciones").select(COLUMNAS).eq("id", id).maybeSingle();
  if (error) throw new Error(`No se pudo leer la cotización: ${error.message}`);
  return data ? deFila(data as unknown as Fila) : null;
});

/* ── Sugerencias ───────────────────────────────────────────────────────────── */

/** Los últimos clientes cotizados, para el buscador vacío. */
export async function clientesRecientes(limite = 8): Promise<{ cliente: ClienteOdoo; veces: number }[]> {
  const supabase = await clienteServidor();
  const { data } = await supabase
    .from("clientes_cotizados")
    .select("odoo_partner_id, cliente_nombre, cliente_documento, cliente_telefono, veces")
    .order("ultima_vez", { ascending: false })
    .limit(limite);

  return (data ?? [])
    .filter((f) => f.odoo_partner_id !== null)
    .map((f) => ({
      cliente: {
        id: f.odoo_partner_id!,
        nombre: f.cliente_nombre ?? "(sin nombre)",
        documento: f.cliente_documento,
        telefono: f.cliente_telefono,
        email: null,
        ciudad: null,
        esEmpresa: false,
        empresa: null,
      },
      veces: f.veces ?? 0,
    }));
}

/** Cuántas veces se cotizó cada cliente, para desempatar en el buscador. */
export async function popularidadClientes(): Promise<Map<number, number>> {
  const supabase = await clienteServidor();
  const { data } = await supabase
    .from("clientes_cotizados")
    .select("odoo_partner_id, veces")
    .order("veces", { ascending: false })
    .limit(1000);
  return new Map((data ?? []).map((f) => [f.odoo_partner_id!, f.veces ?? 0]));
}

/** Cuántas veces se cotizó cada producto en los últimos 90 días, de más a menos. */
export async function popularidadProductos(): Promise<Map<number, number>> {
  const supabase = await clienteServidor();
  const { data } = await supabase
    .from("productos_mas_cotizados")
    .select("odoo_product_id, veces")
    .order("veces", { ascending: false })
    .limit(1000);
  return new Map((data ?? []).map((f) => [f.odoo_product_id!, f.veces ?? 0]));
}

/* ── Odoo ──────────────────────────────────────────────────────────────────── */

export type ResultadoSincronizacion =
  | { ok: true; orderName: string }
  | { ok: false; error: string };

/**
 * Crea en Odoo la cotización de una fila que todavía no lo está, y anota el
 * resultado. Si Odoo falla, la fila queda en `error` con el motivo: lo cotizado
 * no se pierde y la pantalla ofrece reintentar.
 *
 * Reintentar no duplica: `crearPedidoDeVenta` busca primero una orden con la
 * marca de esta fila (ver `origenDe`).
 */
export async function sincronizarConOdoo(id: string): Promise<ResultadoSincronizacion> {
  const c = await cargarCotizacion(id);
  if (!c) return { ok: false, error: "La cotización ya no existe." };
  if (c.sincronizacion === "sincronizada" && c.odooOrderName) {
    return { ok: true, orderName: c.odooOrderName };
  }

  const supabase = await clienteServidor();

  try {
    const venta = await crearPedidoDeVenta({
      cotizacionId: c.id,
      clienteId: c.cliente.id,
      lineas: c.lineas.map((l) => ({
        productoId: l.productoId,
        nombreProducto: l.nombre,
        codigo: l.codigo,
        cantidad: l.cantidad,
        precioUnitario: l.precioUnitario,
        descripcion: l.descripcion,
      })),
    });

    const { data, error } = await supabase
      .from("cotizaciones")
      .update({
        odoo_order_id: venta.orderId,
        odoo_order_name: venta.orderName,
        sincronizacion: "sincronizada",
        error_sincronizacion: null,
        monto_sin_impuestos: venta.montoSinImpuestos,
        monto_impuestos: venta.montoImpuestos,
        monto_total: venta.montoTotal,
      })
      .eq("id", id)
      .select("id");

    if (error) {
      return {
        ok: false,
        error: `Se creó ${venta.orderName} en Odoo, pero no se pudo anotar aquí: ${mensajeDeError(error)}`,
      };
    }
    if (!data?.length) return { ok: false, error: "Tu rol no puede actualizar esta cotización." };
    return { ok: true, orderName: venta.orderName };
  } catch (e) {
    const mensaje =
      e instanceof ErrorOdoo ? e.message : "Algo falló al crear la cotización en Odoo.";
    if (!(e instanceof ErrorOdoo)) console.error("[cotizaciones] sincronizar", e);

    await supabase
      .from("cotizaciones")
      .update({ sincronizacion: "error", error_sincronizacion: mensaje })
      .eq("id", id);
    return { ok: false, error: mensaje };
  }
}

/**
 * Registra en la tabla la cotización que acaba de crear el asistente en Odoo.
 * Corre después de responder al chat (`after`), así que nunca lo frena ni lo
 * rompe: si algo falla, se anota en el log y el chat sigue como si nada.
 *
 * Se puede repetir: `crear_cotizacion` devuelve la fila existente si esa orden
 * ya estaba registrada.
 */
export async function registrarDesdeAsistente(chatId: string, orderId: number): Promise<void> {
  if (!odooConfigurado()) return;
  try {
    const supabase = await clienteServidor();
    const { data: ya } = await supabase
      .from("cotizaciones")
      .select("id")
      .eq("odoo_order_id", orderId)
      .maybeSingle();
    if (ya) return;

    const venta = await leerPedidoDeVenta(orderId);
    if (!venta || venta.lineas.length === 0) return;
    const cliente = await leerCliente(venta.clienteId);

    const { error } = await supabase.rpc("crear_cotizacion", {
      p_canal: "tienda",
      p_odoo_partner_id: venta.clienteId,
      p_cliente_nombre: cliente?.nombre ?? `Cliente ${venta.clienteId}`,
      p_cliente_documento: cliente?.documento ?? undefined,
      p_cliente_telefono: cliente?.telefono ?? undefined,
      p_lineas: venta.lineas.map((l) => ({
        odoo_product_id: l.productoId,
        producto_nombre: l.nombre,
        producto_codigo: l.codigo,
        descripcion: l.descripcion,
        cantidad: l.cantidad,
        precio_unitario: l.precioUnitario,
      })),
      p_odoo_order_id: venta.orderId,
      p_odoo_order_name: venta.orderName,
      p_monto_sin_impuestos: venta.montoSinImpuestos ?? undefined,
      p_monto_impuestos: venta.montoImpuestos ?? undefined,
      p_monto_total: venta.montoTotal ?? undefined,
      p_chat_agente_id: chatId,
    });
    if (error) console.error("[cotizaciones] registrar desde el asistente", error.message);
  } catch (e) {
    console.error("[cotizaciones] registrar desde el asistente", e);
  }
}
