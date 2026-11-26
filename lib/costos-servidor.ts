/**
 * Costos y precios del lado del servidor: el costo de adquisición de cada
 * plancha (de `costos_historial`, lo que dejan las liquidaciones), el precio de
 * venta de Odoo, el margen y el precio sugerido. Solo Administración.
 *
 * El margen se calcula con el ÚLTIMO costo liquidado (lo que cuesta reponer la
 * plancha hoy); el promedio ponderado queda como referencia.
 */

import { cache } from "react";
import { cargarCatalogoPlanchas } from "./cortes-servidor";
import { colorDe, espesorTexto, medidaDe } from "./cortes/catalogo";
import {
  CLAVE_CONFIG_COSTOS,
  costoPromedio,
  leerConfigCostos,
  margenActual,
  margenObjetivo,
  precioSugerido,
  type ConfigCostos,
} from "./costeo";
import { mensajeDeError } from "./errores";
import { productosPorCodigo } from "./odoo/catalogos";
import { ErrorOdoo, ODOO_NO_CONFIGURADO, odooConfigurado } from "./odoo/rpc";
import type { ProductoOdoo } from "./odoo/tipos";
import { cambiarPrecioProducto } from "./stock-servidor";
import { clienteServidor } from "./supabase-servidor";
import type { Json } from "./supabase-tipos";

type Resultado = { ok: true; aviso?: string } | { ok: false; error: string };

export interface PuntoCosto {
  fecha: string;
  origen: "liquidacion" | "ingreso";
  /** CMP-00001 o ING-00001. */
  referencia: string | null;
  cantidad: number;
  costoUnitarioPen: number;
  costoUnitarioUsd: number | null;
  costoKgPen: number | null;
  desglose: { mercaderia?: number; gastos?: Record<string, number> };
}

export interface CambioPrecio {
  fecha: string;
  precioAnterior: number | null;
  precioNuevo: number;
  costoBase: number | null;
  margenPct: number | null;
  quien: string | null;
}

export interface FilaCostoPrecio {
  productoId: number | null;
  codigo: string;
  material: string;
  /** "Cristal · 3 mm · 122×244". */
  titulo: string;
  ultimoCosto: PuntoCosto | null;
  costoPromedio: number | null;
  precio: number | null;
  margenActual: number | null;
  margenObjetivo: number;
  origenMargen: "plancha" | "material" | "general";
  /** La excepción de esta plancha, si tiene. */
  margenPlancha: number | null;
  sugerido: number | null;
}

export interface DatosCostosPrecios {
  config: ConfigCostos;
  filas: FilaCostoPrecio[];
  materiales: string[];
  errorOdoo: string | null;
}

export const cargarConfigCostos = cache(async (): Promise<ConfigCostos> => {
  const supabase = await clienteServidor();
  const { data } = await supabase.from("configuracion").select("valor").eq("clave", CLAVE_CONFIG_COSTOS).maybeSingle();
  return leerConfigCostos(data?.valor ?? null);
});

export async function guardarConfigCostos(c: ConfigCostos): Promise<Resultado> {
  const supabase = await clienteServidor();
  const { error } = await supabase
    .from("configuracion")
    .upsert({ clave: CLAVE_CONFIG_COSTOS, valor: c as unknown as Json }, { onConflict: "clave" });
  return error ? { ok: false, error: mensajeDeError(error) } : { ok: true };
}

/** El margen propio de una plancha (`null` lo quita: vuelve al de su material). */
export async function guardarMargenPlancha(codigo: string, margen: number | null): Promise<Resultado> {
  const supabase = await clienteServidor();
  const { error } =
    margen === null
      ? await supabase.from("margenes_plancha").delete().eq("codigo_odoo", codigo)
      : await supabase
          .from("margenes_plancha")
          .upsert({ codigo_odoo: codigo, margen_pct: margen, actualizado_en: new Date().toISOString() }, { onConflict: "codigo_odoo" });
  return error ? { ok: false, error: mensajeDeError(error) } : { ok: true };
}

type FilaHistorial = {
  producto_odoo_id: number;
  fecha: string;
  origen: string;
  cantidad: number;
  costo_unitario_pen: number;
  costo_unitario_usd: number | null;
  costo_kg_pen: number | null;
  desglose: Json;
  creado_en: string;
  compra: { codigo: string } | { codigo: string }[] | null;
  ingreso: { codigo: string } | { codigo: string }[] | null;
};

const uno = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

const dePunto = (f: FilaHistorial): PuntoCosto => ({
  fecha: f.fecha,
  origen: f.origen as PuntoCosto["origen"],
  referencia: uno(f.compra)?.codigo ?? uno(f.ingreso)?.codigo ?? null,
  cantidad: f.cantidad,
  costoUnitarioPen: Number(f.costo_unitario_pen),
  costoUnitarioUsd: f.costo_unitario_usd === null ? null : Number(f.costo_unitario_usd),
  costoKgPen: f.costo_kg_pen === null ? null : Number(f.costo_kg_pen),
  desglose: (f.desglose && typeof f.desglose === "object" ? f.desglose : {}) as PuntoCosto["desglose"],
});

const COLUMNAS_HISTORIAL = `producto_odoo_id, fecha, origen, cantidad, costo_unitario_pen, costo_unitario_usd, costo_kg_pen,
  desglose, creado_en, compra:compras ( codigo ), ingreso:ingresos_stock ( codigo )`;

/** La tabla: cada plancha activa del catálogo con su costo, su precio y su margen. */
export async function cargarCostosYPrecios(): Promise<DatosCostosPrecios> {
  const supabase = await clienteServidor();
  const [config, catalogo, historial, margenes] = await Promise.all([
    cargarConfigCostos(),
    cargarCatalogoPlanchas(true),
    supabase.from("costos_historial").select(COLUMNAS_HISTORIAL).order("fecha", { ascending: false }).order("creado_en", { ascending: false }),
    supabase.from("margenes_plancha").select("codigo_odoo, margen_pct"),
  ]);
  if (historial.error) throw new Error(`No se pudo leer el historial de costos: ${historial.error.message}`);
  if (margenes.error) throw new Error(`No se pudieron leer los márgenes: ${margenes.error.message}`);

  const porProducto = new Map<number, PuntoCosto[]>();
  for (const f of (historial.data ?? []) as unknown as FilaHistorial[]) {
    const lista = porProducto.get(f.producto_odoo_id) ?? [];
    lista.push(dePunto(f));
    porProducto.set(f.producto_odoo_id, lista);
  }
  const margenDe = new Map((margenes.data ?? []).map((m) => [m.codigo_odoo, Number(m.margen_pct)]));

  const codigos = catalogo.flatMap((g) => g.formatos.map((f) => f.codigo));
  let productos = new Map<string, ProductoOdoo>();
  let errorOdoo: string | null = null;
  if (!odooConfigurado()) errorOdoo = ODOO_NO_CONFIGURADO;
  else {
    try {
      productos = await productosPorCodigo(codigos);
    } catch (e) {
      errorOdoo = e instanceof ErrorOdoo ? e.message : "No se pudieron leer los precios de Odoo.";
      console.error("[costos] precios de Odoo", e);
    }
  }

  const filas: FilaCostoPrecio[] = catalogo.flatMap((g) =>
    g.formatos.map((f) => {
      const p = productos.get(f.codigo) ?? null;
      const puntos = p ? (porProducto.get(p.id) ?? []) : [];
      // El último costo: el de la liquidación más reciente; un ingreso viejo solo si no hay liquidación.
      const ultimo = puntos.find((x) => x.origen === "liquidacion") ?? puntos[0] ?? null;
      const excepcion = margenDe.get(f.codigo) ?? null;
      const objetivo = margenObjetivo(config, g.material, excepcion);
      const precio = p?.precio ?? null;
      return {
        productoId: p?.id ?? null,
        codigo: f.codigo,
        material: g.material,
        titulo: `${colorDe(g)} · ${espesorTexto(g.espesorMm)} · ${medidaDe(f)}`,
        ultimoCosto: ultimo,
        costoPromedio: costoPromedio(puntos),
        precio,
        margenActual: precio !== null && ultimo ? margenActual(precio, ultimo.costoUnitarioPen, config) : null,
        margenObjetivo: objetivo.pct,
        origenMargen: objetivo.origen,
        margenPlancha: excepcion,
        sugerido: ultimo ? precioSugerido(ultimo.costoUnitarioPen, objetivo.pct, config) : null,
      };
    }),
  );
  return { config, filas, materiales: [...new Set(catalogo.map((g) => g.material))], errorOdoo };
}

/** El historial de una plancha: sus costos (cada compra) y sus cambios de precio. */
export async function historialDe(productoId: number): Promise<{ costos: PuntoCosto[]; precios: CambioPrecio[] }> {
  const supabase = await clienteServidor();
  const [costos, precios] = await Promise.all([
    supabase
      .from("costos_historial")
      .select(COLUMNAS_HISTORIAL)
      .eq("producto_odoo_id", productoId)
      .order("fecha", { ascending: false })
      .order("creado_en", { ascending: false })
      .limit(100),
    supabase
      .from("cambios_precio")
      .select("creado_en, precio_anterior, precio_nuevo, costo_base, margen_pct, quien:usuarios!cambios_precio_creado_por_fkey ( nombre )")
      .eq("producto_odoo_id", productoId)
      .order("creado_en", { ascending: false })
      .limit(100),
  ]);
  if (costos.error) throw new Error(costos.error.message);
  if (precios.error) throw new Error(precios.error.message);
  return {
    costos: ((costos.data ?? []) as unknown as FilaHistorial[]).map(dePunto),
    precios: (precios.data ?? []).map((p) => ({
      fecha: p.creado_en,
      precioAnterior: p.precio_anterior === null ? null : Number(p.precio_anterior),
      precioNuevo: Number(p.precio_nuevo),
      costoBase: p.costo_base === null ? null : Number(p.costo_base),
      margenPct: p.margen_pct === null ? null : Number(p.margen_pct),
      quien: uno(p.quien)?.nombre ?? null,
    })),
  };
}

export interface PrecioAAplicar {
  productoId: number;
  codigo: string;
  nombre: string;
  precioAnterior: number | null;
  precio: number;
  costoBase: number | null;
  margenPct: number | null;
}

/**
 * Pone en Odoo los precios elegidos y deja cada cambio en el historial. Sigue
 * con los demás si uno falla, y dice cuáles no pasaron.
 */
export async function aplicarPrecios(lista: PrecioAAplicar[]): Promise<Resultado> {
  const supabase = await clienteServidor();
  const fallidos: string[] = [];
  for (const p of lista) {
    const r = await cambiarPrecioProducto(p.productoId, p.precio);
    if (!r.ok) {
      fallidos.push(`${p.codigo}: ${r.error}`);
      continue;
    }
    const { error } = await supabase.from("cambios_precio").insert({
      producto_odoo_id: p.productoId,
      codigo: p.codigo,
      nombre: p.nombre,
      precio_anterior: p.precioAnterior,
      precio_nuevo: p.precio,
      costo_base: p.costoBase,
      margen_pct: p.margenPct,
    });
    if (error) console.error("[costos] historial de precio", error);
  }
  if (fallidos.length === lista.length) return { ok: false, error: fallidos.join(" · ") };
  return fallidos.length ? { ok: true, aviso: `No se cambiaron: ${fallidos.join(" · ")}` } : { ok: true };
}
