/**
 * Las compras del lado del servidor: guardar la pre-compra, confirmarla (orden
 * de compra en Odoo), recibir lo que llega, cargar los gastos y liquidar el costo.
 *
 * Como los ingresos: todo se guarda primero en Supabase y después va a Odoo. Si
 * Odoo falla, lo escrito no se pierde y se reintenta. Reintentar no duplica: la
 * orden se busca por su origen ("App Plexiacril CMP-00001").
 */

import { cache } from "react";
import { cargarAlmacenes, odooDeAlmacenId } from "./almacenes-servidor";
import {
  desgloseUnitario,
  estadoPorRecepcion,
  gastoParaCosteo,
  sePuedeConfirmar,
  sePuedeEditar,
  sePuedenCargarGastos,
  sePuedeLiquidar,
  sePuedeRecibir,
  type CompraDetalle,
  type CompraResumen,
  type CondicionPago,
  type EstadoCompra,
  type GastosDeCompra,
  type NuevaCompra,
  type NuevaRecepcion,
  type Sincronizacion,
} from "./compras";
import { liquidar, type ConceptoGasto, type Incoterm, type Moneda, type Reparto, type TipoCompra, type TipoManoObra } from "./costeo";
import { mensajeDeError } from "./errores";
import { hoy } from "./fecha";
import { planificarImportacion, type CompraPorImportar, type OrdenOmitida } from "./compras-importar";
import { cancelarOrdenCompra, crearOrdenCompra, recibirOrdenCompra, tipoDeCambioUsd } from "./odoo/almacenes";
import { productosPorId } from "./odoo/catalogos";
import { leerOrdenesDeCompra } from "./odoo/compras-importar";
import { origenDe } from "./odoo/pedidos-venta";
import { ErrorOdoo, ODOO_NO_CONFIGURADO, odooConfigurado } from "./odoo/rpc";
import { codigosDelCatalogo } from "./stock-servidor";
import { clienteServidor } from "./supabase-servidor";

export type ResultadoCompra = { ok: true; codigo?: string; aviso?: string } | { ok: false; error: string };

const mensajeOdoo = (e: unknown, contexto: string) => {
  if (e instanceof ErrorOdoo) return e.message;
  console.error(`[compras] ${contexto}`, e);
  return "Algo falló al hablar con Odoo.";
};

const uno = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
const num = (v: number | string | null) => (v === null ? null : Number(v));

/* ── Leer ──────────────────────────────────────────────────────────────────── */

const CAMPOS_RESUMEN = `id, codigo, tipo, estado, proveedor_nombre, documento_proveedor, moneda_mercaderia,
  fecha_llegada_estimada, sincronizacion, error_sincronizacion, creado_en,
  almacen:almacenes ( nombre ),
  compras_lineas ( cantidad, precio_unitario )`;

type FilaResumen = {
  id: string;
  codigo: string;
  tipo: string;
  estado: string;
  proveedor_nombre: string;
  documento_proveedor: string | null;
  moneda_mercaderia: string;
  fecha_llegada_estimada: string | null;
  sincronizacion: Sincronizacion | null;
  error_sincronizacion: string | null;
  creado_en: string;
  almacen: { nombre: string } | { nombre: string }[] | null;
  compras_lineas: { cantidad: number; precio_unitario: number }[] | null;
};

function deResumen(f: FilaResumen): CompraResumen {
  const lineas = f.compras_lineas ?? [];
  return {
    id: f.id,
    codigo: f.codigo,
    tipo: f.tipo as TipoCompra,
    estado: f.estado as EstadoCompra,
    proveedor: f.proveedor_nombre,
    almacen: uno(f.almacen)?.nombre ?? "(almacén borrado)",
    documentoProveedor: f.documento_proveedor,
    monedaMercaderia: f.moneda_mercaderia as Moneda,
    totalMercaderia: Math.round(lineas.reduce((t, l) => t + l.cantidad * Number(l.precio_unitario), 0) * 100) / 100,
    items: lineas.length,
    fechaLlegadaEstimada: f.fecha_llegada_estimada,
    sincronizacion: f.sincronizacion,
    error: f.error_sincronizacion,
    creadoEn: f.creado_en,
  };
}

export async function cargarCompras(limite = 200): Promise<CompraResumen[]> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase.from("compras").select(CAMPOS_RESUMEN).order("creado_en", { ascending: false }).limit(limite);
  if (error) throw new Error(`No se pudieron leer las compras: ${error.message}`);
  return (data ?? []).map((f) => deResumen(f as FilaResumen));
}

const SELECT_DETALLE =
  `${CAMPOS_RESUMEN}, proveedor_odoo_id, almacen_id, tc_mercaderia, tc_gastos, incoterm, condicion_pago, dias_credito,
       fecha_embarque, nota, odoo_orden_id, confirmada_en, liquidada_en,
       creador:usuarios!compras_creado_por_fkey ( nombre ),
       liquidador:usuarios!compras_liquidada_por_fkey ( nombre ),
       lineas:compras_lineas ( posicion, producto_odoo_id, codigo, nombre, cantidad, kilos, precio_unitario, total_proveedor, cantidad_recibida ),
       compras_gastos ( concepto, descripcion, moneda, monto, reparto, tipo_mano_obra, personas, horas, tarifa, fecha_pago, documento, creado_en ),
       compras_recepciones ( id, creado_en, nota, sincronizacion, error_sincronizacion,
         creador:usuarios!compras_recepciones_creado_por_fkey ( nombre ),
         compras_recepciones_lineas ( posicion, cantidad ) )`;

/** Solo para sacar el tipo de la fila: Supabase lo infiere del texto del select. */
const consultaDetalle = (supabase: Awaited<ReturnType<typeof clienteServidor>>) =>
  supabase.from("compras").select(SELECT_DETALLE);
type FilaDetalle = NonNullable<Awaited<ReturnType<typeof consultaDetalle>>["data"]>[number];

/** La fila de `compras` con su detalle (líneas, gastos, recepciones) ya con la forma de la UI. */
function armarDetalle(f: FilaDetalle): CompraDetalle {
  return {
    ...deResumen(f as unknown as FilaResumen),
    proveedorId: f.proveedor_odoo_id,
    almacenId: f.almacen_id,
    tcMercaderia: num(f.tc_mercaderia),
    tcGastos: num(f.tc_gastos),
    incoterm: f.incoterm as Incoterm | null,
    condicionPago: f.condicion_pago as CondicionPago,
    diasCredito: f.dias_credito,
    fechaEmbarque: f.fecha_embarque,
    nota: f.nota,
    odooOrdenId: f.odoo_orden_id,
    confirmadaEn: f.confirmada_en,
    liquidadaEn: f.liquidada_en,
    liquidadaPor: uno(f.liquidador)?.nombre ?? null,
    creadoPor: uno(f.creador)?.nombre ?? null,
    lineas: [...(f.lineas ?? [])]
      .sort((a, b) => a.posicion - b.posicion)
      .map((l) => ({
        posicion: l.posicion,
        productoId: l.producto_odoo_id,
        codigo: l.codigo,
        nombre: l.nombre,
        cantidad: l.cantidad,
        kilos: num(l.kilos),
        precioUnitario: Number(l.precio_unitario),
        totalProveedor: num(l.total_proveedor),
        recibida: l.cantidad_recibida,
      })),
    gastos: [...(f.compras_gastos ?? [])]
      .sort((a, b) => a.creado_en.localeCompare(b.creado_en))
      .map((g) => ({
        concepto: g.concepto as ConceptoGasto,
        descripcion: g.descripcion,
        moneda: g.moneda as Moneda,
        monto: Number(g.monto),
        reparto: g.reparto as Reparto,
        tipoManoObra: g.tipo_mano_obra as TipoManoObra | null,
        personas: num(g.personas),
        horas: num(g.horas),
        tarifa: num(g.tarifa),
        fechaPago: g.fecha_pago,
        documento: g.documento,
      })),
    recepciones: [...(f.compras_recepciones ?? [])]
      .sort((a, b) => a.creado_en.localeCompare(b.creado_en))
      .map((r) => ({
        id: r.id,
        creadoEn: r.creado_en,
        creadoPor: uno(r.creador)?.nombre ?? null,
        nota: r.nota,
        sincronizacion: r.sincronizacion,
        error: r.error_sincronizacion,
        lineas: (r.compras_recepciones_lineas ?? []).map((l) => ({ posicion: l.posicion, cantidad: l.cantidad })),
      })),
  };
}

export const cargarCompra = cache(async (codigo: string): Promise<CompraDetalle | null> => {
  const supabase = await clienteServidor();
  const { data: f, error } = await consultaDetalle(supabase).eq("codigo", codigo).maybeSingle();
  if (error) throw new Error(`No se pudo leer la compra: ${error.message}`);
  if (!f) return null;
  return armarDetalle(f);
});

/** Las compras confirmadas a las que les falta llegar algo: lo que Almacén puede recibir. */
export async function comprasPorRecibir(): Promise<CompraDetalle[]> {
  const supabase = await clienteServidor();
  // Una sola consulta con el detalle de todas, no una por compra.
  const { data, error } = await consultaDetalle(supabase)
    .in("estado", ["confirmada", "recibida_parcial"])
    .order("fecha_llegada_estimada", { ascending: true, nullsFirst: false });
  if (error) throw new Error(`No se pudieron leer las compras por recibir: ${error.message}`);
  return (data ?? []).map(armarDetalle);
}

/** La tarifa por hora de cada tipo de mano de obra (Configuración → Costos y precios). */
export async function tarifasManoObra(): Promise<Record<TipoManoObra, number>> {
  const supabase = await clienteServidor();
  const { data } = await supabase.rpc("config_tarifas_mano_obra");
  const o = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const n = (k: TipoManoObra) => (Number.isFinite(Number(o[k])) ? Number(o[k]) : 0);
  return { descarga: n("descarga"), supervision: n("supervision"), despacho: n("despacho") };
}

/** El tipo de cambio para proponer: la tasa de Odoo, o el último que se usó en una compra. */
export async function tipoDeCambioSugerido(): Promise<{ tc: number | null; fuente: "odoo" | "ultima" | null }> {
  if (odooConfigurado()) {
    try {
      const tc = await tipoDeCambioUsd();
      if (tc) return { tc, fuente: "odoo" };
    } catch (e) {
      console.error("[compras] tipo de cambio de Odoo", e);
    }
  }
  const supabase = await clienteServidor();
  const { data } = await supabase
    .from("compras")
    .select("tc_mercaderia, tc_gastos")
    .or("tc_mercaderia.not.is.null,tc_gastos.not.is.null")
    .order("creado_en", { ascending: false })
    .limit(1)
    .maybeSingle();
  const tc = num(data?.tc_gastos ?? data?.tc_mercaderia ?? null);
  return tc ? { tc, fuente: "ultima" } : { tc: null, fuente: null };
}

/* ── Escribir ──────────────────────────────────────────────────────────────── */

async function estadoDe(id: string): Promise<{ codigo: string; estado: EstadoCompra } | null> {
  const supabase = await clienteServidor();
  const { data } = await supabase.from("compras").select("codigo, estado").eq("id", id).maybeSingle();
  return data ? { codigo: data.codigo, estado: data.estado as EstadoCompra } : null;
}

/** Guarda la pre-compra: nueva, o los cambios de una que sigue en borrador. */
export async function guardarCompra(v: NuevaCompra): Promise<ResultadoCompra> {
  const almacen = (await cargarAlmacenes()).find((a) => a.id === v.almacenId && a.activo);
  if (!almacen) return { ok: false, error: "Ese almacén ya no está activo. Vuelve a elegirlo." };

  if (v.id) {
    const actual = await estadoDe(v.id);
    if (!actual) return { ok: false, error: "Esa compra ya no existe." };
    if (!sePuedeEditar(actual.estado)) return { ok: false, error: "La compra ya se confirmó: sus ítems no se cambian." };
  }

  let productos;
  try {
    productos = await productosPorId(v.lineas.map((l) => l.productoId));
  } catch (e) {
    return { ok: false, error: mensajeOdoo(e, "leer productos de la compra") };
  }
  const delCatalogo = await codigosDelCatalogo();
  for (const l of v.lineas) {
    const p = productos.get(l.productoId);
    if (!p) return { ok: false, error: "Uno de los productos ya no existe en Odoo. Quítalo y vuelve a buscarlo." };
    if (!p.codigo || !delCatalogo.has(p.codigo)) return { ok: false, error: `${p.nombre} no es una plancha ni un accesorio del almacén.` };
  }

  const fila = {
    tipo: v.tipo,
    proveedor_odoo_id: v.proveedorId,
    proveedor_nombre: v.proveedorNombre,
    almacen_id: almacen.id,
    documento_proveedor: v.documentoProveedor,
    moneda_mercaderia: v.monedaMercaderia,
    tc_mercaderia: v.monedaMercaderia === "USD" ? v.tcMercaderia : null,
    tc_gastos: v.tcGastos,
    incoterm: v.tipo === "importacion" ? v.incoterm : null,
    condicion_pago: v.condicionPago,
    dias_credito: v.condicionPago === "credito" ? v.diasCredito : null,
    fecha_embarque: v.fechaEmbarque,
    fecha_llegada_estimada: v.fechaLlegadaEstimada,
    nota: v.nota,
    actualizado_en: new Date().toISOString(),
  };

  const supabase = await clienteServidor();
  let id = v.id;
  let codigo: string;
  if (id) {
    const { data, error } = await supabase.from("compras").update(fila).eq("id", id).eq("estado", "borrador").select("codigo").single();
    if (error || !data) return { ok: false, error: mensajeDeError(error) };
    codigo = data.codigo;
    const { error: alBorrar } = await supabase.from("compras_lineas").delete().eq("compra_id", id);
    if (alBorrar) return { ok: false, error: mensajeDeError(alBorrar) };
  } else {
    const { data, error } = await supabase.from("compras").insert(fila).select("id, codigo").single();
    if (error || !data) return { ok: false, error: mensajeDeError(error) };
    id = data.id;
    codigo = data.codigo;
  }

  const { error: alLineas } = await supabase.from("compras_lineas").insert(
    v.lineas.map((l, i) => {
      const p = productos.get(l.productoId)!;
      return {
        compra_id: id!,
        posicion: i + 1,
        producto_odoo_id: p.id,
        codigo: p.codigo,
        nombre: p.nombre,
        cantidad: l.cantidad,
        kilos: l.kilos,
        precio_unitario: l.precioUnitario,
        total_proveedor: l.totalProveedor,
      };
    }),
  );
  if (alLineas) return { ok: false, error: mensajeDeError(alLineas) };
  return { ok: true, codigo };
}

/** Confirma la pre-compra: queda como orden de compra en Odoo, sin recibir. */
export async function confirmarCompra(id: string): Promise<ResultadoCompra> {
  const actual = await estadoDe(id);
  if (!actual) return { ok: false, error: "Esa compra ya no existe." };
  if (!sePuedeConfirmar(actual.estado)) return { ok: false, error: "Esa compra ya estaba confirmada." };
  const supabase = await clienteServidor();
  const { error } = await supabase
    .from("compras")
    .update({ estado: "confirmada", sincronizacion: "pendiente", confirmada_en: new Date().toISOString() })
    .eq("id", id)
    .eq("estado", "borrador");
  if (error) return { ok: false, error: mensajeDeError(error) };
  const odoo = await llevarCompraAOdoo(id);
  return odoo.ok
    ? { ok: true, codigo: actual.codigo }
    : { ok: true, codigo: actual.codigo, aviso: `Quedó confirmada, pero la orden no llegó a Odoo: ${odoo.error}` };
}

/** Crea (o retoma) la orden de compra en Odoo. */
export async function llevarCompraAOdoo(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await clienteServidor();
  const { data: c, error } = await supabase
    .from("compras")
    .select(
      `codigo, estado, almacen_id, proveedor_odoo_id, documento_proveedor, moneda_mercaderia, fecha_llegada_estimada,
       odoo_orden_id, sincronizacion, compras_lineas ( posicion, producto_odoo_id, cantidad, precio_unitario )`,
    )
    .eq("id", id)
    .maybeSingle();
  if (error) return { ok: false, error: mensajeDeError(error) };
  if (!c) return { ok: false, error: "Esa compra ya no existe." };
  if (c.sincronizacion === "sincronizada" && c.odoo_orden_id) return { ok: true };

  const anotar = (cambios: { odoo_orden_id?: number; sincronizacion: "sincronizada" | "error"; error_sincronizacion: string | null }) =>
    supabase.from("compras").update(cambios).eq("id", id);
  if (!odooConfigurado()) {
    await anotar({ sincronizacion: "error", error_sincronizacion: ODOO_NO_CONFIGURADO });
    return { ok: false, error: ODOO_NO_CONFIGURADO };
  }
  try {
    const ordenId = await crearOrdenCompra({
      almacen: await odooDeAlmacenId(c.almacen_id),
      proveedorId: c.proveedor_odoo_id,
      origen: origenDe(c.codigo),
      documento: c.documento_proveedor,
      moneda: c.moneda_mercaderia as Moneda,
      fechaPrevista: c.fecha_llegada_estimada,
      lineas: [...(c.compras_lineas ?? [])]
        .sort((a, b) => a.posicion - b.posicion)
        .map((l) => ({ productoId: l.producto_odoo_id, cantidad: l.cantidad, costo: Number(l.precio_unitario) })),
    });
    await anotar({ odoo_orden_id: ordenId, sincronizacion: "sincronizada", error_sincronizacion: null });
    return { ok: true };
  } catch (e) {
    const mensaje = mensajeOdoo(e, "llevar compra");
    await anotar({ sincronizacion: "error", error_sincronizacion: mensaje });
    return { ok: false, error: mensaje };
  }
}

/** Anula una compra que todavía no recibió nada. Si ya era orden en Odoo, se cancela allí. */
export async function anularCompra(id: string): Promise<ResultadoCompra> {
  const supabase = await clienteServidor();
  const { data: c, error } = await supabase
    .from("compras")
    .select("codigo, estado, odoo_orden_id, compras_recepciones ( id )")
    .eq("id", id)
    .maybeSingle();
  if (error) return { ok: false, error: mensajeDeError(error) };
  if (!c) return { ok: false, error: "Esa compra ya no existe." };
  if (!["borrador", "confirmada"].includes(c.estado) || (c.compras_recepciones ?? []).length > 0) {
    return { ok: false, error: "Solo se anula una compra a la que todavía no le llegó nada." };
  }
  if (c.odoo_orden_id) {
    try {
      await cancelarOrdenCompra(c.odoo_orden_id);
    } catch (e) {
      return { ok: false, error: `No se pudo cancelar la orden en Odoo: ${mensajeOdoo(e, "cancelar compra")}` };
    }
  }
  const { error: alAnular } = await supabase.from("compras").update({ estado: "anulada" }).eq("id", id);
  if (alAnular) return { ok: false, error: mensajeDeError(alAnular) };
  return { ok: true, codigo: c.codigo };
}

/** Reemplaza los gastos de la compra (y el tipo de cambio de los gastos). */
export async function guardarGastos(v: GastosDeCompra): Promise<ResultadoCompra> {
  const actual = await estadoDe(v.compraId);
  if (!actual) return { ok: false, error: "Esa compra ya no existe." };
  if (!sePuedenCargarGastos(actual.estado)) {
    return { ok: false, error: "La compra ya está liquidada: reabre la liquidación para cambiar sus gastos." };
  }
  const supabase = await clienteServidor();
  const { error: alTc } = await supabase.from("compras").update({ tc_gastos: v.tcGastos, actualizado_en: new Date().toISOString() }).eq("id", v.compraId);
  if (alTc) return { ok: false, error: mensajeDeError(alTc) };
  const { error: alBorrar } = await supabase.from("compras_gastos").delete().eq("compra_id", v.compraId);
  if (alBorrar) return { ok: false, error: mensajeDeError(alBorrar) };
  if (v.gastos.length) {
    const base = Date.now();
    const { error } = await supabase.from("compras_gastos").insert(
      v.gastos.map((g, i) => {
        const conHoras = g.concepto === "mano_obra";
        const r = gastoParaCosteo({ ...g, monto: g.monto });
        return {
          compra_id: v.compraId,
          concepto: g.concepto,
          descripcion: g.descripcion,
          moneda: conHoras ? "PEN" : g.moneda,
          monto: Math.round(r.monto * 100) / 100,
          reparto: g.reparto,
          tipo_mano_obra: conHoras ? g.tipoManoObra : null,
          personas: conHoras ? g.personas : null,
          horas: conHoras ? g.horas : null,
          tarifa: conHoras ? g.tarifa : null,
          fecha_pago: g.fechaPago,
          documento: g.documento,
          // El orden en que se escribieron.
          creado_en: new Date(base + i).toISOString(),
        };
      }),
    );
    if (error) return { ok: false, error: mensajeDeError(error) };
  }
  return { ok: true, codigo: actual.codigo };
}

/**
 * Recibe lo que llegó: queda anotado en la compra y después se valida en Odoo.
 * Si Odoo falla, la recepción queda pendiente y se reintenta.
 */
export async function recibirCompra(v: NuevaRecepcion): Promise<ResultadoCompra> {
  const c = await cargarCompraPorId(v.compraId);
  if (!c) return { ok: false, error: "Esa compra ya no existe." };
  if (!sePuedeRecibir(c.estado)) return { ok: false, error: "Esa compra no está esperando mercadería." };
  if (c.recepciones.some((r) => r.sincronizacion !== "sincronizada")) {
    return { ok: false, error: "Hay una recepción anterior que no llegó a Odoo: reinténtala primero." };
  }
  const llegan = v.lineas.filter((l) => l.cantidad > 0);
  if (llegan.length === 0) return { ok: false, error: "Escribe cuántas llegaron de al menos un ítem." };
  for (const l of llegan) {
    const linea = c.lineas.find((x) => x.posicion === l.posicion);
    if (!linea) return { ok: false, error: "Uno de los ítems ya no está en la compra." };
    if (linea.recibida + l.cantidad > linea.cantidad) {
      return { ok: false, error: `De ${linea.codigo ?? linea.nombre} faltan ${linea.cantidad - linea.recibida}: no pueden llegar ${l.cantidad}.` };
    }
  }

  const supabase = await clienteServidor();
  const { data: rec, error } = await supabase.from("compras_recepciones").insert({ compra_id: c.id, nota: v.nota }).select("id").single();
  if (error || !rec) return { ok: false, error: mensajeDeError(error) };
  const { error: alLineas } = await supabase
    .from("compras_recepciones_lineas")
    .insert(llegan.map((l) => ({ recepcion_id: rec.id, posicion: l.posicion, cantidad: l.cantidad })));
  if (alLineas) return { ok: false, error: mensajeDeError(alLineas) };

  const recibidas = c.lineas.map((x) => ({ ...x, recibida: x.recibida + (llegan.find((l) => l.posicion === x.posicion)?.cantidad ?? 0) }));
  for (const x of recibidas) {
    const antes = c.lineas.find((y) => y.posicion === x.posicion)!.recibida;
    if (x.recibida === antes) continue;
    const { error: e } = await supabase
      .from("compras_lineas")
      .update({ cantidad_recibida: x.recibida })
      .eq("compra_id", c.id)
      .eq("posicion", x.posicion);
    if (e) return { ok: false, error: mensajeDeError(e) };
  }
  const { error: alEstado } = await supabase
    .from("compras")
    .update({ estado: estadoPorRecepcion(recibidas), actualizado_en: new Date().toISOString() })
    .eq("id", c.id);
  if (alEstado) return { ok: false, error: mensajeDeError(alEstado) };

  const odoo = await llevarRecepcionAOdoo(rec.id);
  return odoo.ok
    ? { ok: true, codigo: c.codigo }
    : { ok: true, codigo: c.codigo, aviso: `Quedó anotada, pero no llegó a Odoo: ${odoo.error}` };
}

async function cargarCompraPorId(id: string): Promise<CompraDetalle | null> {
  const actual = await estadoDe(id);
  return actual ? cargarCompra(actual.codigo) : null;
}

/** Valida en Odoo una recepción anotada (la primera vez o al reintentar). */
export async function llevarRecepcionAOdoo(recepcionId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await clienteServidor();
  const { data: r, error } = await supabase
    .from("compras_recepciones")
    .select("id, compra_id, creado_en, sincronizacion")
    .eq("id", recepcionId)
    .maybeSingle();
  if (error) return { ok: false, error: mensajeDeError(error) };
  if (!r) return { ok: false, error: "Esa recepción ya no existe." };
  if (r.sincronizacion === "sincronizada") return { ok: true };

  const anotar = (cambios: { odoo_picking_id?: number; sincronizacion: "sincronizada" | "error"; error_sincronizacion: string | null }) =>
    supabase.from("compras_recepciones").update(cambios).eq("id", recepcionId);
  const c = await cargarCompraPorId(r.compra_id);
  if (!c) return { ok: false, error: "La compra ya no existe." };
  if (!c.odooOrdenId) {
    const mensaje = "La orden de compra todavía no está en Odoo: reintenta primero la compra.";
    await anotar({ sincronizacion: "error", error_sincronizacion: mensaje });
    return { ok: false, error: mensaje };
  }
  const anteriores = c.recepciones.filter((x) => x.id !== r.id && x.creadoEn < r.creado_en);
  if (anteriores.some((x) => x.sincronizacion !== "sincronizada")) {
    return { ok: false, error: "Reintenta primero la recepción anterior." };
  }
  const esta = c.recepciones.find((x) => x.id === r.id);
  if (!esta) return { ok: false, error: "Esa recepción ya no existe." };
  const antesDe = (posicion: number) =>
    anteriores.reduce((t, x) => t + (x.lineas.find((l) => l.posicion === posicion)?.cantidad ?? 0), 0);

  if (!odooConfigurado()) {
    await anotar({ sincronizacion: "error", error_sincronizacion: ODOO_NO_CONFIGURADO });
    return { ok: false, error: ODOO_NO_CONFIGURADO };
  }
  try {
    const picking = await recibirOrdenCompra(
      c.odooOrdenId,
      esta.lineas.map((l) => {
        const linea = c.lineas.find((x) => x.posicion === l.posicion)!;
        return { productoId: linea.productoId, cantidad: l.cantidad, recibidoAntes: antesDe(l.posicion) };
      }),
    );
    await anotar({ odoo_picking_id: picking, sincronizacion: "sincronizada", error_sincronizacion: null });
    return { ok: true };
  } catch (e) {
    const mensaje = mensajeOdoo(e, "recibir compra");
    await anotar({ sincronizacion: "error", error_sincronizacion: mensaje });
    return { ok: false, error: mensaje };
  }
}

/**
 * Cierra la liquidación: reparte los gastos (`lib/costeo.ts`) y deja el costo de
 * cada ítem en el historial. Volver a liquidar reemplaza esas filas.
 */
export async function liquidarCompra(id: string): Promise<ResultadoCompra> {
  const c = await cargarCompraPorId(id);
  if (!c) return { ok: false, error: "Esa compra ya no existe." };
  if (!sePuedeLiquidar(c.estado)) return { ok: false, error: "Se liquida cuando llegó toda la mercadería." };
  const l = liquidar(
    { tipo: c.tipo, monedaMercaderia: c.monedaMercaderia, tcMercaderia: c.tcMercaderia, tcGastos: c.tcGastos, incoterm: c.incoterm },
    c.lineas.map((x) => ({ cantidad: x.cantidad, kilos: x.kilos, precioUnitario: x.precioUnitario })),
    c.gastos.map(gastoParaCosteo),
  );
  if (l.errores.length) return { ok: false, error: l.errores.join(" ") };

  const supabase = await clienteServidor();
  const { error: alBorrar } = await supabase.from("costos_historial").delete().eq("compra_id", c.id);
  if (alBorrar) return { ok: false, error: mensajeDeError(alBorrar) };
  const fecha = hoy();
  const { error } = await supabase.from("costos_historial").insert(
    c.lineas.map((x, i) => ({
      producto_odoo_id: x.productoId,
      codigo: x.codigo,
      nombre: x.nombre,
      origen: "liquidacion",
      compra_id: c.id,
      fecha,
      cantidad: x.cantidad,
      costo_unitario_pen: l.lineas[i].costoUnitarioPen,
      costo_unitario_usd: l.lineas[i].costoUnitarioUsd,
      costo_kg_pen: l.lineas[i].costoKgPen,
      desglose: desgloseUnitario(l.lineas[i], x.cantidad),
    })),
  );
  if (error) return { ok: false, error: mensajeDeError(error) };
  const { data: sesion } = await supabase.auth.getUser();
  const { error: alEstado } = await supabase
    .from("compras")
    .update({ estado: "liquidada", liquidada_en: new Date().toISOString(), liquidada_por: sesion.user?.id ?? null })
    .eq("id", c.id);
  if (alEstado) return { ok: false, error: mensajeDeError(alEstado) };
  return { ok: true, codigo: c.codigo };
}

/** Reabre la liquidación para corregir gastos: el costo sale del historial hasta volver a cerrarla. */
export async function reabrirLiquidacion(id: string): Promise<ResultadoCompra> {
  const actual = await estadoDe(id);
  if (!actual) return { ok: false, error: "Esa compra ya no existe." };
  if (actual.estado !== "liquidada") return { ok: false, error: "Esa compra no está liquidada." };
  const supabase = await clienteServidor();
  const { error } = await supabase.from("costos_historial").delete().eq("compra_id", id);
  if (error) return { ok: false, error: mensajeDeError(error) };
  const { error: alEstado } = await supabase
    .from("compras")
    .update({ estado: "recibida", liquidada_en: null, liquidada_por: null })
    .eq("id", id);
  if (alEstado) return { ok: false, error: mensajeDeError(alEstado) };
  return { ok: true, codigo: actual.codigo };
}

/* ── Traer de Odoo las órdenes que la app no tiene ─────────────────────────── */

/** Una orden de Odoo que entra (o entraría) a la app, en lo que se ve en el aviso. */
export interface CompraTraida {
  orden: string;
  proveedor: string;
  tipo: TipoCompra;
  moneda: Moneda;
  total: number;
  items: number;
  estado: EstadoCompra;
  fecha: string;
}

export type ResultadoImportacion =
  | {
      ok: true;
      /** false: solo se mostró lo que entraría, no se guardó nada. */
      aplicado: boolean;
      porImportar: CompraTraida[];
      omitidas: OrdenOmitida[];
      /** Las que no se pudieron guardar (solo al aplicar). */
      fallidas: { orden: string; error: string }[];
      importadas: number;
      /** Las órdenes de Odoo que nacieron en la app: no se tocan. */
      deLaApp: number;
      /** Había más órdenes de las que se leyeron. */
      truncado: boolean;
    }
  | { ok: false; error: string };

const resumenTraida = (c: CompraPorImportar): CompraTraida => ({
  orden: c.ordenNombre,
  proveedor: c.proveedorNombre,
  tipo: c.tipo,
  moneda: c.moneda,
  total: Math.round(c.lineas.reduce((t, l) => t + l.cantidad * l.precio, 0) * 100) / 100,
  items: c.lineas.length,
  estado: c.estado,
  fecha: c.creadaEn.slice(0, 10),
});

/**
 * Guarda una orden de Odoo como compra de la app: ya sincronizada, en el estado
 * que le toca por lo recibido, y con esa recepción anotada (así Almacén puede
 * recibir el resto sin que la cuenta de Odoo y la de la app se contradigan).
 */
async function guardarTraida(c: CompraPorImportar): Promise<{ ok: true } | { ok: false; error: string; yaEstaba?: boolean }> {
  const supabase = await clienteServidor();
  const { data: compra, error } = await supabase
    .from("compras")
    .insert({
      tipo: c.tipo,
      estado: c.estado,
      proveedor_odoo_id: c.proveedorId,
      proveedor_nombre: c.proveedorNombre,
      almacen_id: c.almacenId,
      documento_proveedor: c.documento,
      moneda_mercaderia: c.moneda,
      tc_mercaderia: c.tcMercaderia,
      condicion_pago: c.condicionPago,
      fecha_llegada_estimada: c.fechaLlegadaEstimada,
      nota: c.nota,
      odoo_orden_id: c.ordenId,
      sincronizacion: "sincronizada",
      confirmada_en: c.confirmadaEn,
      creado_en: c.creadaEn,
    })
    .select("id")
    .single();
  // Otro usuario la trajo a la vez: el índice único de `odoo_orden_id` la rechaza.
  if (error?.code === "23505") return { ok: false, error: "Ya estaba en la app.", yaEstaba: true };
  if (error || !compra) return { ok: false, error: mensajeDeError(error) };

  const deshacer = async (e: Parameters<typeof mensajeDeError>[0]) => {
    // Sin recepciones guardadas todavía, borrar la compra se lleva sus ítems.
    await supabase.from("compras").delete().eq("id", compra.id);
    return { ok: false as const, error: mensajeDeError(e) };
  };

  const { error: alLineas } = await supabase.from("compras_lineas").insert(
    c.lineas.map((l, i) => ({
      compra_id: compra.id,
      posicion: i + 1,
      producto_odoo_id: l.productoId,
      codigo: l.codigo,
      nombre: l.nombre,
      cantidad: l.cantidad,
      precio_unitario: l.precio,
      cantidad_recibida: l.recibida,
    })),
  );
  if (alLineas) return deshacer(alLineas);

  const recibido = c.lineas.map((l, i) => ({ posicion: i + 1, cantidad: l.recibida })).filter((l) => l.cantidad > 0);
  if (recibido.length === 0) return { ok: true };
  const { data: rec, error: alRecibir } = await supabase
    .from("compras_recepciones")
    .insert({
      compra_id: compra.id,
      odoo_picking_id: c.ultimaRecepcionId,
      sincronizacion: "sincronizada",
      nota: "Recibido en Odoo antes de traer la orden a la app.",
    })
    .select("id")
    .single();
  if (alRecibir || !rec) return deshacer(alRecibir);
  const { error: alDetalle } = await supabase
    .from("compras_recepciones_lineas")
    .insert(recibido.map((l) => ({ recepcion_id: rec.id, ...l })));
  if (alDetalle) return deshacer(alDetalle);
  return { ok: true };
}

/**
 * Las órdenes de compra confirmadas que están en Odoo y no en la app. Con
 * `aplicar: false` solo dice cuáles entrarían y cuáles no (y por qué); con
 * `aplicar: true` las guarda. Repetirlo no duplica: lo que ya está se salta.
 */
export async function traerComprasDeOdoo(opciones: { aplicar: boolean; desde: string | null }): Promise<ResultadoImportacion> {
  if (!odooConfigurado()) return { ok: false, error: ODOO_NO_CONFIGURADO };
  const supabase = await clienteServidor();
  const { data: conocidas, error } = await supabase.from("compras").select("odoo_orden_id").not("odoo_orden_id", "is", null);
  if (error) return { ok: false, error: mensajeDeError(error) };

  let plan;
  let truncado: boolean;
  try {
    const leidas = await leerOrdenesDeCompra((conocidas ?? []).map((c) => c.odoo_orden_id as number));
    truncado = leidas.truncado;
    const enDolares = leidas.ordenes.some((o) => o.moneda === "USD" && !o.tasaPorDolar);
    plan = planificarImportacion(leidas.ordenes, {
      almacenes: (await cargarAlmacenes()).filter((a) => a.activo),
      catalogo: await codigosDelCatalogo(),
      tcActual: enDolares ? (await tipoDeCambioSugerido()).tc : null,
      desde: opciones.desde,
    });
  } catch (e) {
    return { ok: false, error: mensajeOdoo(e, "traer compras de Odoo") };
  }

  const base = { ok: true as const, omitidas: plan.omitidas, deLaApp: plan.deLaApp, truncado };
  if (!opciones.aplicar) {
    return { ...base, aplicado: false, porImportar: plan.porImportar.map(resumenTraida), fallidas: [], importadas: 0 };
  }

  const fallidas: { orden: string; error: string }[] = [];
  let importadas = 0;
  for (const c of plan.porImportar) {
    const r = await guardarTraida(c);
    if (r.ok) importadas++;
    else if (!r.yaEstaba) fallidas.push({ orden: c.ordenNombre, error: r.error });
  }
  return {
    ...base,
    aplicado: true,
    porImportar: plan.porImportar.map(resumenTraida),
    fallidas,
    importadas,
  };
}
