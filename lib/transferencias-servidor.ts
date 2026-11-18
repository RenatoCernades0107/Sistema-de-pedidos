/**
 * Las transferencias entre almacenes del lado del servidor.
 *
 * Van en dos pasos, como el material de verdad. Al **enviar**, se guarda la
 * transferencia (así no se pierde si Odoo falla), sus sobrantes quedan en
 * tránsito y en Odoo sale del origen a la ubicación de Tránsito. Al
 * **recibir**, en Odoo pasa del Tránsito al destino, los sobrantes quedan en su
 * almacén nuevo y los avisos que la transferencia atendía se dan por resueltos.
 *
 * Cada paso en Odoo se puede repetir: la operación se busca por su origen.
 */

import { cargarAlmacenes, odooDeAlmacenId } from "./almacenes-servidor";
import { mensajeDeError } from "./errores";
import { revisarFaltantesDePedido } from "./faltantes-servidor";
import type { EstadoTransferencia, NuevaTransferencia, TransferenciaResumen } from "./inventario";
import { enviarATransito, recibirDeTransito, stockPorAlmacen, type LineaDeTransferencia } from "./odoo/almacenes";
import { productosPorId } from "./odoo/catalogos";
import { origenDe } from "./odoo/pedidos-venta";
import { ErrorOdoo, ODOO_NO_CONFIGURADO, odooConfigurado } from "./odoo/rpc";
import { productosDeLotes } from "./odoo/sobrantes";
import { clienteServidor } from "./supabase-servidor";

type Resultado = { ok: true; codigo?: string; aviso?: string } | { ok: false; error: string };

const mensajeOdoo = (e: unknown, contexto: string) => {
  if (e instanceof ErrorOdoo) return e.message;
  console.error(`[transferencias] ${contexto}`, e);
  return "Algo falló al hablar con Odoo.";
};

const uno = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

/* ── Leer ──────────────────────────────────────────────────────────────────── */

export async function cargarTransferencias(limite = 60): Promise<TransferenciaResumen[]> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from("transferencias_stock")
    .select(
      `id, codigo, estado, desde_id, hacia_id, nota, enviado_en, recibido_en, odoo_envio_id, sincronizacion, error_sincronizacion,
       desde:almacenes!transferencias_stock_desde_id_fkey ( nombre ),
       hacia:almacenes!transferencias_stock_hacia_id_fkey ( nombre ),
       pedido:pedidos ( codigo ),
       enviador:usuarios!transferencias_stock_enviado_por_fkey ( nombre ),
       receptor:usuarios!transferencias_stock_recibido_por_fkey ( nombre ),
       transferencias_stock_lineas ( posicion, producto_odoo_id, codigo, nombre, cantidad, sobrante_codigo )`,
    )
    .order("enviado_en", { ascending: false })
    .limit(limite);
  if (error) throw new Error(`No se pudieron leer las transferencias: ${error.message}`);
  return (data ?? []).map((f) => ({
    id: f.id,
    codigo: f.codigo,
    estado: f.estado as EstadoTransferencia,
    desdeId: f.desde_id,
    desde: uno(f.desde)?.nombre ?? "(almacén borrado)",
    haciaId: f.hacia_id,
    hacia: uno(f.hacia)?.nombre ?? "(almacén borrado)",
    pedidoCodigo: uno(f.pedido)?.codigo ?? null,
    nota: f.nota,
    lineas: [...(f.transferencias_stock_lineas ?? [])]
      .sort((a, b) => a.posicion - b.posicion)
      .map((l) => ({
        productoId: l.producto_odoo_id,
        codigo: l.codigo,
        nombre: l.nombre,
        cantidad: l.cantidad,
        sobrante: l.sobrante_codigo,
      })),
    enviadoPor: uno(f.enviador)?.nombre ?? null,
    enviadoEn: f.enviado_en,
    recibidoPor: uno(f.receptor)?.nombre ?? null,
    recibidoEn: f.recibido_en,
    sincronizacion: f.sincronizacion,
    error: f.error_sincronizacion,
    salioEnOdoo: f.odoo_envio_id !== null,
  }));
}

/** Lo que está en camino, por producto y almacén de destino: `{ productoId: { almacenId: cantidad } }`. */
export function enCamino(transferencias: TransferenciaResumen[]): Record<number, Record<string, number>> {
  const salida: Record<number, Record<string, number>> = {};
  for (const t of transferencias.filter((x) => x.estado === "enviada")) {
    for (const l of t.lineas.filter((x) => !x.sobrante)) {
      const porAlmacen = (salida[l.productoId] ??= {});
      porAlmacen[t.haciaId] = (porAlmacen[t.haciaId] ?? 0) + l.cantidad;
    }
  }
  return salida;
}

/* ── Enviar ────────────────────────────────────────────────────────────────── */

/**
 * Guarda una transferencia y la envía: sale del origen (en Odoo, a Tránsito).
 * No deja enviar más de lo que hay en el origen, ni un sobrante que no está
 * disponible allí.
 */
export async function crearTransferencia(v: NuevaTransferencia): Promise<Resultado> {
  if (!odooConfigurado()) return { ok: false, error: ODOO_NO_CONFIGURADO };
  const almacenes = await cargarAlmacenes();
  const desde = almacenes.find((a) => a.id === v.desdeId && a.activo);
  const hacia = almacenes.find((a) => a.id === v.haciaId && a.activo);
  if (!desde || !hacia) return { ok: false, error: "Uno de los almacenes ya no está activo. Vuelve a elegirlo." };

  const supabase = await clienteServidor();

  // Los sobrantes: disponibles en el origen y con su lote en Odoo.
  const { data: sobrantes, error: alLeerSobrantes } = v.sobrantes.length
    ? await supabase.from("sobrantes").select("codigo, estado, almacen_id, odoo_lot_id").in("codigo", v.sobrantes)
    : { data: [], error: null };
  if (alLeerSobrantes) return { ok: false, error: mensajeDeError(alLeerSobrantes) };
  for (const codigo of v.sobrantes) {
    const s = sobrantes?.find((x) => x.codigo === codigo);
    if (!s) return { ok: false, error: `El sobrante ${codigo} ya no existe.` };
    if (s.estado !== "disponible" || s.almacen_id !== desde.id) {
      return { ok: false, error: `El sobrante ${codigo} no está disponible en ${desde.nombre}.` };
    }
    if (!s.odoo_lot_id) return { ok: false, error: `El sobrante ${codigo} todavía no tiene lote en Odoo. Reinténtalo desde Sobrantes.` };
  }

  let productos: Awaited<ReturnType<typeof productosPorId>>;
  let productoDeLote: Map<number, number>;
  try {
    productos = await productosPorId(v.lineas.map((l) => l.productoId));
    productoDeLote = await productosDeLotes((sobrantes ?? []).map((s) => s.odoo_lot_id!));
    if (v.lineas.length) {
      const origen = await odooDeAlmacenId(desde.id);
      const stock = await stockPorAlmacen(
        v.lineas.map((l) => l.productoId),
        [{ almacenId: desde.id, ubicacionId: origen.ubicacionId }],
      );
      for (const l of v.lineas) {
        const p = productos.get(l.productoId);
        if (!p) return { ok: false, error: "Uno de los productos ya no existe en Odoo. Quítalo y vuelve a buscarlo." };
        const hay = stock.get(l.productoId)?.porAlmacen[desde.id] ?? 0;
        if (l.cantidad > hay) {
          return { ok: false, error: `En ${desde.nombre} hay ${hay} de ${p.codigo ?? p.nombre}: no se pueden enviar ${l.cantidad}.` };
        }
      }
    }
  } catch (e) {
    return { ok: false, error: mensajeOdoo(e, "preparar") };
  }
  for (const s of sobrantes ?? []) {
    if (!productoDeLote.get(s.odoo_lot_id!)) return { ok: false, error: `El lote del sobrante ${s.codigo} ya no está en Odoo.` };
  }

  const { data: t, error } = await supabase
    .from("transferencias_stock")
    .insert({ desde_id: desde.id, hacia_id: hacia.id, nota: v.nota, pedido_id: v.pedidoId })
    .select("id, codigo")
    .single();
  if (error || !t) return { ok: false, error: mensajeDeError(error) };

  const lineas = [
    ...v.lineas.map((l) => {
      const p = productos.get(l.productoId)!;
      return { producto_odoo_id: p.id, codigo: p.codigo, nombre: p.nombre, cantidad: l.cantidad, sobrante_codigo: null };
    }),
    ...(sobrantes ?? []).map((s) => ({
      producto_odoo_id: productoDeLote.get(s.odoo_lot_id!)!,
      codigo: s.codigo,
      nombre: `Sobrante ${s.codigo}`,
      cantidad: 1,
      sobrante_codigo: s.codigo,
    })),
  ].map((l, i) => ({ ...l, transferencia_id: t.id, posicion: i + 1 }));
  const { error: alLineas } = await supabase.from("transferencias_stock_lineas").insert(lineas);
  if (alLineas) {
    await supabase.rpc("anular_transferencia", { p_id: t.id });
    return { ok: false, error: mensajeDeError(alLineas) };
  }

  if (v.sobrantes.length) {
    const { error: alEnviar } = await supabase.rpc("enviar_sobrantes", { p_transferencia: t.id });
    if (alEnviar) {
      await supabase.rpc("anular_transferencia", { p_id: t.id });
      return { ok: false, error: mensajeDeError(alEnviar) };
    }
  }

  if (v.faltanteIds.length) {
    await supabase
      .from("faltantes_stock")
      .update({ estado: "en_camino", transferencia_id: t.id })
      .in("id", v.faltanteIds)
      .eq("estado", "pendiente");
  }

  const odoo = await llevarAOdoo(t.id);
  return odoo.ok
    ? { ok: true, codigo: t.codigo }
    : { ok: true, codigo: t.codigo, aviso: `Quedó registrada, pero no salió en Odoo: ${odoo.error}` };
}

/** Las líneas de una transferencia como las pide Odoo: los sobrantes, con su lote. */
async function paraOdoo(id: string) {
  const supabase = await clienteServidor();
  const { data: t, error } = await supabase
    .from("transferencias_stock")
    .select(
      `id, codigo, estado, desde_id, hacia_id, pedido_id, odoo_envio_id, odoo_recepcion_id,
       transferencias_stock_lineas ( posicion, producto_odoo_id, cantidad, sobrante_codigo )`,
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(mensajeDeError(error));
  if (!t) return null;
  const codigos = (t.transferencias_stock_lineas ?? []).flatMap((l) => (l.sobrante_codigo ? [l.sobrante_codigo] : []));
  const { data: lotes } = codigos.length
    ? await supabase.from("sobrantes").select("codigo, odoo_lot_id").in("codigo", codigos)
    : { data: [] };
  const lineas: LineaDeTransferencia[] = [...(t.transferencias_stock_lineas ?? [])]
    .sort((a, b) => a.posicion - b.posicion)
    .map((l) => ({
      productoId: l.producto_odoo_id,
      cantidad: l.cantidad,
      loteId: l.sobrante_codigo ? (lotes?.find((x) => x.codigo === l.sobrante_codigo)?.odoo_lot_id ?? null) : null,
    }));
  const sinLote = (t.transferencias_stock_lineas ?? []).filter((l, i) => l.sobrante_codigo && !lineas[i]?.loteId);
  if (sinLote.length) throw new ErrorOdoo(`El sobrante ${sinLote[0].sobrante_codigo} ya no tiene lote en Odoo.`);
  return { t, lineas };
}

/** El envío en Odoo: del origen a Tránsito. Se puede repetir. */
export async function llevarAOdoo(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await clienteServidor();
  const anotar = (cambios: { odoo_envio_id?: number; sincronizacion: "sincronizada" | "error"; error_sincronizacion: string | null }) =>
    supabase.from("transferencias_stock").update(cambios).eq("id", id);
  if (!odooConfigurado()) return { ok: false, error: ODOO_NO_CONFIGURADO };
  try {
    const datos = await paraOdoo(id);
    if (!datos) return { ok: false, error: "Esa transferencia ya no existe." };
    if (datos.t.odoo_envio_id) return { ok: true };
    if (datos.t.estado === "anulada") return { ok: false, error: "Esa transferencia está anulada." };
    const envio = await enviarATransito({
      desde: await odooDeAlmacenId(datos.t.desde_id),
      hacia: await odooDeAlmacenId(datos.t.hacia_id),
      origen: origenDe(datos.t.codigo),
      lineas: datos.lineas,
    });
    await anotar({ odoo_envio_id: envio, sincronizacion: "sincronizada", error_sincronizacion: null });
    return { ok: true };
  } catch (e) {
    const mensaje = mensajeOdoo(e, "enviar");
    await anotar({ sincronizacion: "error", error_sincronizacion: mensaje });
    return { ok: false, error: mensaje };
  }
}

/* ── Recibir ───────────────────────────────────────────────────────────────── */

/**
 * Recibe una transferencia: en Odoo entra al destino y aquí queda recibida, con
 * sus sobrantes en el almacén nuevo. Si el envío no había llegado a Odoo, se
 * hace primero. Después se vuelve a mirar qué le falta al pedido que la pidió
 * (si quien recibe gestiona el stock; si no, sus avisos ya quedaron resueltos).
 */
export async function recibirTransferencia(id: string, gestionaStock: boolean): Promise<Resultado> {
  if (!odooConfigurado()) return { ok: false, error: ODOO_NO_CONFIGURADO };
  const supabase = await clienteServidor();
  let datos: Awaited<ReturnType<typeof paraOdoo>>;
  try {
    datos = await paraOdoo(id);
  } catch (e) {
    return { ok: false, error: mensajeOdoo(e, "leer") };
  }
  if (!datos) return { ok: false, error: "Esa transferencia ya no existe." };
  if (datos.t.estado === "recibida") return { ok: true, codigo: datos.t.codigo };
  if (datos.t.estado === "anulada") return { ok: false, error: "Esa transferencia está anulada." };

  if (!datos.t.odoo_envio_id) {
    const envio = await llevarAOdoo(id);
    if (!envio.ok) return { ok: false, error: `Todavía no salió en Odoo: ${envio.error}` };
  }

  let recepcion: number;
  try {
    recepcion = await recibirDeTransito({
      desde: await odooDeAlmacenId(datos.t.desde_id),
      hacia: await odooDeAlmacenId(datos.t.hacia_id),
      origen: origenDe(datos.t.codigo),
      lineas: datos.lineas,
    });
  } catch (e) {
    const mensaje = mensajeOdoo(e, "recibir");
    // Quien recibe puede ser el taller, que no escribe la transferencia: el error se le muestra igual.
    await supabase.from("transferencias_stock").update({ sincronizacion: "error", error_sincronizacion: mensaje }).eq("id", id);
    return { ok: false, error: mensaje };
  }

  const { error } = await supabase.rpc("recibir_transferencia", { p_id: id, p_odoo_recepcion_id: recepcion });
  if (error) return { ok: false, error: `Entró en Odoo, pero no se pudo anotar aquí: ${mensajeDeError(error)}` };

  if (gestionaStock) {
    const { data: afectados } = await supabase.from("faltantes_stock").select("pedido_id").eq("transferencia_id", id);
    const pedidos = new Set([...(afectados ?? []).map((f) => f.pedido_id), ...(datos.t.pedido_id ? [datos.t.pedido_id] : [])]);
    for (const p of pedidos) await revisarFaltantesDePedido(p, { libre: false, avisar: false });
  }
  return { ok: true, codigo: datos.t.codigo };
}

/** Anula una transferencia que todavía no salió en Odoo. Si ya salió, se devuelve con otra transferencia. */
export async function anularTransferencia(id: string): Promise<Resultado> {
  const supabase = await clienteServidor();
  const { error } = await supabase.rpc("anular_transferencia", { p_id: id });
  if (error) return { ok: false, error: mensajeDeError(error) };
  return { ok: true };
}
