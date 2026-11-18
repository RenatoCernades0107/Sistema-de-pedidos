/**
 * Los casos de stock del lado del servidor: reportar una baja, leer los casos y
 * cerrarlos.
 *
 * Reportar no toca Odoo: queda un caso pendiente y se avisa a Administración.
 * Cerrarlo aplicándolo sí: una baja es un desecho (`stock.scrap`) y una
 * diferencia de conteo, una transferencia desde o hacia la ubicación de ajustes,
 * las dos con el código del caso como origen (reintentar no duplica). Primero
 * Odoo y después la base (`cerrar_caso`), así un caso cerrado siempre está en
 * Odoo; si Odoo falla, el caso sigue pendiente con el motivo.
 */

import { cargarAlmacenes, odooDeAlmacenId } from "./almacenes-servidor";
import type { Caso, CierreCaso, EstadoCaso, MotivoBaja, NuevaBaja, TipoCaso } from "./casos";
import { mensajeDeError } from "./errores";
import { ajustarPorDiferencia, darDeBaja, stockPorAlmacen } from "./odoo/almacenes";
import { productosPorId } from "./odoo/catalogos";
import { origenDe } from "./odoo/pedidos-venta";
import { ErrorOdoo, ODOO_NO_CONFIGURADO, odooConfigurado } from "./odoo/rpc";
import { productosDeLotes } from "./odoo/sobrantes";
import { clienteServidor } from "./supabase-servidor";

type Resultado = { ok: true; codigo?: string; aviso?: string } | { ok: false; error: string };

const mensajeOdoo = (e: unknown, contexto: string) => {
  if (e instanceof ErrorOdoo) return e.message;
  console.error(`[casos] ${contexto}`, e);
  return "Algo falló al hablar con Odoo.";
};

const uno = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/* ── Leer ──────────────────────────────────────────────────────────────────── */

export async function cargarCasos(limite = 150): Promise<Caso[]> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from("casos_stock")
    .select(
      `id, codigo, tipo, almacen_id, producto_odoo_id, codigo_producto, nombre, sobrante_codigo, cantidad, motivo,
       descripcion, esperado, contado, estado, razon_cierre, cerrado_en, reportado_en, error_sincronizacion,
       almacen:almacenes ( nombre ),
       conteo:conteos_stock ( codigo ),
       reportador:usuarios!casos_stock_reportado_por_fkey ( nombre ),
       cerrador:usuarios!casos_stock_cerrado_por_fkey ( nombre )`,
    )
    .order("reportado_en", { ascending: false })
    .limit(limite);
  if (error) throw new Error(`No se pudieron leer los casos: ${error.message}`);
  return (data ?? []).map((f) => ({
    id: f.id,
    codigo: f.codigo,
    tipo: f.tipo as TipoCaso,
    almacenId: f.almacen_id,
    almacen: uno(f.almacen)?.nombre ?? "(almacén borrado)",
    productoId: f.producto_odoo_id,
    codigoProducto: f.codigo_producto,
    nombre: f.nombre,
    sobrante: f.sobrante_codigo,
    cantidad: Number(f.cantidad),
    motivo: f.motivo as MotivoBaja | null,
    descripcion: f.descripcion,
    conteo: uno(f.conteo)?.codigo ?? null,
    esperado: num(f.esperado),
    contado: num(f.contado),
    estado: f.estado as EstadoCaso,
    razon: f.razon_cierre,
    cerradoPor: uno(f.cerrador)?.nombre ?? null,
    cerradoEn: f.cerrado_en,
    reportadoPor: uno(f.reportador)?.nombre ?? null,
    reportadoEn: f.reportado_en,
    error: f.error_sincronizacion,
  }));
}

/* ── Reportar una baja ─────────────────────────────────────────────────────── */

/**
 * Deja una baja reportada, pendiente de que Administración la cierre. No deja
 * reportar más de lo que hay en ese almacén, ni un sobrante que no está
 * disponible allí. Avisa a Administración.
 */
export async function reportarBaja(v: NuevaBaja): Promise<Resultado> {
  if (!odooConfigurado()) return { ok: false, error: ODOO_NO_CONFIGURADO };
  const almacen = (await cargarAlmacenes()).find((a) => a.id === v.almacenId && a.activo);
  if (!almacen) return { ok: false, error: "Ese almacén ya no está activo." };
  const supabase = await clienteServidor();

  let fila: { producto_odoo_id: number; codigo_producto: string | null; nombre: string; sobrante_codigo: string | null };
  try {
    if (v.sobrante) {
      const { data: s } = await supabase
        .from("sobrantes")
        .select("codigo, estado, almacen_id, odoo_lot_id")
        .eq("codigo", v.sobrante)
        .maybeSingle();
      if (!s) return { ok: false, error: "Ese sobrante ya no existe." };
      if ((s.estado !== "disponible" && s.estado !== "reservado") || s.almacen_id !== almacen.id) {
        return { ok: false, error: `El sobrante ${s.codigo} no está en ${almacen.nombre}.` };
      }
      if (!s.odoo_lot_id) return { ok: false, error: `El sobrante ${s.codigo} todavía no tiene lote en Odoo.` };
      const producto = (await productosDeLotes([s.odoo_lot_id])).get(s.odoo_lot_id);
      if (!producto) return { ok: false, error: `El lote del sobrante ${s.codigo} ya no está en Odoo.` };
      fila = { producto_odoo_id: producto, codigo_producto: s.codigo, nombre: `Sobrante ${s.codigo}`, sobrante_codigo: s.codigo };
    } else {
      const p = (await productosPorId([v.productoId!])).get(v.productoId!);
      if (!p) return { ok: false, error: "Ese producto ya no existe en Odoo." };
      const ubicacion = (await odooDeAlmacenId(almacen.id)).ubicacionId;
      const hay = (await stockPorAlmacen([p.id], [{ almacenId: almacen.id, ubicacionId: ubicacion }])).get(p.id)?.porAlmacen[almacen.id] ?? 0;
      if (v.cantidad > hay) {
        return { ok: false, error: `En ${almacen.nombre} hay ${hay} de ${p.codigo ?? p.nombre}: no se pueden dar de baja ${v.cantidad}.` };
      }
      fila = { producto_odoo_id: p.id, codigo_producto: p.codigo, nombre: p.nombre, sobrante_codigo: null };
    }
  } catch (e) {
    return { ok: false, error: mensajeOdoo(e, "reportar") };
  }

  const { data, error } = await supabase
    .from("casos_stock")
    .insert({
      ...fila,
      tipo: "baja",
      almacen_id: almacen.id,
      cantidad: -v.cantidad,
      motivo: v.motivo,
      descripcion: v.descripcion,
    })
    .select("id, codigo")
    .single();
  if (error || !data) {
    if (/casos_stock_sobrante_abierto/.test(error?.message ?? "")) {
      return { ok: false, error: `El sobrante ${v.sobrante} ya tiene un caso abierto.` };
    }
    return { ok: false, error: mensajeDeError(error) };
  }
  await avisar([data.codigo]);
  return { ok: true, codigo: data.codigo };
}

/** Encola el aviso a Administración. Si falla, se pierde el aviso, no el caso. */
export async function avisar(codigos: string[]) {
  if (codigos.length === 0) return;
  const supabase = await clienteServidor();
  const { error } = await supabase.rpc("avisar_casos", { p_codigos: codigos });
  if (error) console.warn("[casos] no se encoló el aviso:", error.message);
}

/* ── Cerrar ────────────────────────────────────────────────────────────────── */

/**
 * Cierra un caso con la razón de Administración. Aplicarlo cambia Odoo (y un
 * sobrante que se da de baja sale del almacén); descartarlo, no.
 */
export async function cerrarCaso(v: CierreCaso): Promise<Resultado> {
  const supabase = await clienteServidor();
  const { data: c, error } = await supabase
    .from("casos_stock")
    .select("id, codigo, tipo, almacen_id, producto_odoo_id, sobrante_codigo, cantidad, estado")
    .eq("id", v.id)
    .maybeSingle();
  if (error) return { ok: false, error: mensajeDeError(error) };
  if (!c) return { ok: false, error: "Ese caso no existe." };
  if (c.estado !== "pendiente") return { ok: false, error: "Ese caso ya está cerrado." };

  let ref: number | null = null;
  if (v.decision === "aplicar") {
    if (!odooConfigurado()) return { ok: false, error: ODOO_NO_CONFIGURADO };
    try {
      const almacen = await odooDeAlmacenId(c.almacen_id);
      const cantidad = Number(c.cantidad);
      let loteId: number | null = null;
      if (c.sobrante_codigo) {
        const { data: s } = await supabase.from("sobrantes").select("odoo_lot_id").eq("codigo", c.sobrante_codigo).maybeSingle();
        loteId = s?.odoo_lot_id ?? null;
        if (!loteId) throw new ErrorOdoo(`El sobrante ${c.sobrante_codigo} no tiene lote en Odoo.`);
      }
      const origen = origenDe(c.codigo);
      ref =
        c.tipo === "baja" || (c.sobrante_codigo && cantidad < 0)
          ? await darDeBaja({ ubicacionId: almacen.ubicacionId, productoId: c.producto_odoo_id, cantidad: Math.abs(cantidad), loteId, origen })
          : await ajustarPorDiferencia({ almacen, productoId: c.producto_odoo_id, delta: cantidad, loteId, origen });
    } catch (e) {
      const mensaje = mensajeOdoo(e, "aplicar");
      await supabase.from("casos_stock").update({ sincronizacion: "error", error_sincronizacion: mensaje }).eq("id", c.id);
      return { ok: false, error: mensaje };
    }
  }

  const { error: alCerrar } = await supabase.rpc("cerrar_caso", {
    p_id: c.id,
    p_decision: v.decision,
    p_razon: v.razon,
    p_odoo_ref: ref ?? undefined,
  });
  if (alCerrar) {
    const aviso = ref ? "Se aplicó en Odoo, pero no se pudo cerrar aquí: " : "";
    return { ok: false, error: `${aviso}${mensajeDeError(alCerrar)}` };
  }
  return { ok: true, codigo: c.codigo };
}
