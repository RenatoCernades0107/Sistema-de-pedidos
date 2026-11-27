/**
 * Costos y precios del lado del servidor. Solo Administración.
 *
 *   1er costo: lo que cuesta poner la plancha en el almacén (la liquidación de
 *              su compra, en `costos_historial`). Vale el de la ÚLTIMA compra.
 *   2do costo: el 1ro más los gastos de operar (administrativos, financieros,
 *              almacén propio, ventas y despacho), con la tasa de los últimos
 *              meses: gastos del mes ÷ costo de lo vendido en el mes.
 *   Precio:    2do costo × factor, más IGV.
 */

import { cache } from "react";
import { cargarCatalogoPlanchas } from "./cortes-servidor";
import { colorDe, espesorTexto, medidaDe } from "./cortes/catalogo";
import {
  CLAVE_CONFIG_COSTOS,
  costoPromedio,
  factorActual,
  factorObjetivo,
  leerConfigCostos,
  margenActual,
  precioSugerido,
  segundoCosto,
  tasaDelMes,
  tasaOperativa,
  type ConceptoOperativo,
  type ConfigCostos,
  type MesOperativo,
} from "./costeo";
import { mensajeDeError } from "./errores";
import { hoy } from "./fecha";
import { salidasAClientes } from "./odoo/almacenes";
import { productosPorCodigo } from "./odoo/catalogos";
import { costosPorId } from "./odoo/productos";
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
  segundoCosto: number | null;
  factor: number | null;
  margenPct: number | null;
  quien: string | null;
}

export interface FilaCostoPrecio {
  productoId: number | null;
  codigo: string;
  material: string;
  /** "Cristal", "Blanco lechoso". */
  color: string;
  espesorMm: number;
  /** "122×244". */
  medida: string;
  areaM2: number;
  /** Lo que pesa una plancha, según la última compra con kilos. */
  kgPorPlancha: number | null;
  /** "Cristal · 3 mm · 122×244". */
  titulo: string;
  ultimoCosto: PuntoCosto | null;
  costoPromedio: number | null;
  segundoCosto: number | null;
  precio: number | null;
  /** Sobre el 2do costo. */
  margenActual: number | null;
  factorActual: number | null;
  factorObjetivo: number;
  origenFactor: "plancha" | "material" | "general";
  /** El factor propio de esta plancha, si tiene. */
  factorPlancha: number | null;
  sugerido: number | null;
}

export interface MesDetalle extends MesOperativo {
  porConcepto: Partial<Record<ConceptoOperativo, number>>;
  gastosDetalle: { concepto: ConceptoOperativo; descripcion: string | null; monto: number }[];
  baseOdoo: number | null;
  baseManual: number | null;
  calculadoEn: string | null;
  nota: string | null;
  tasa: number | null;
}

/** Lo que dibuja el gráfico: cada costo y cada cambio de precio, por producto. */
export interface Series {
  costos: Record<number, { fecha: string; costo: number }[]>;
  precios: Record<number, { fecha: string; precio: number }[]>;
}

export interface DatosCostosPrecios {
  config: ConfigCostos;
  filas: FilaCostoPrecio[];
  materiales: string[];
  meses: MesDetalle[];
  /** La tasa de los gastos de operar que vale hoy. */
  tasaVigente: number | null;
  series: Series;
  errorOdoo: string | null;
}

/** "2026-11". */
export const mesDe = (fecha: string) => fecha.slice(0, 7);

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

/** El factor propio de una plancha (`null` lo quita: vuelve al de su material). */
export async function guardarFactorPlancha(codigo: string, factor: number | null): Promise<Resultado> {
  const supabase = await clienteServidor();
  const { error } =
    factor === null
      ? await supabase.from("factores_plancha").delete().eq("codigo_odoo", codigo)
      : await supabase
          .from("factores_plancha")
          .upsert({ codigo_odoo: codigo, factor, actualizado_en: new Date().toISOString() }, { onConflict: "codigo_odoo" });
  return error ? { ok: false, error: mensajeDeError(error) } : { ok: true };
}

/* ── Los gastos de operar y la base de cada mes ────────────────────────────── */

const primerDia = (mes: string) => `${mes}-01`;
const mesSiguiente = (mes: string) => {
  const [a, m] = mes.split("-").map(Number);
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`;
};

export async function cargarMeses(): Promise<MesDetalle[]> {
  const supabase = await clienteServidor();
  const [gastos, bases] = await Promise.all([
    supabase.from("gastos_operativos").select("mes, concepto, descripcion, monto, creado_en").order("creado_en"),
    supabase.from("bases_mes").select("mes, costo_ventas_odoo, costo_ventas_manual, calculado_en, nota"),
  ]);
  if (gastos.error) throw new Error(`No se pudieron leer los gastos de operar: ${gastos.error.message}`);
  if (bases.error) throw new Error(`No se pudo leer la base de los meses: ${bases.error.message}`);
  const meses = new Map<string, MesDetalle>();
  const de = (mes: string): MesDetalle => {
    const m = meses.get(mes) ?? {
      mes,
      gastos: 0,
      base: null,
      porConcepto: {},
      gastosDetalle: [],
      baseOdoo: null,
      baseManual: null,
      calculadoEn: null,
      nota: null,
      tasa: null,
    };
    meses.set(mes, m);
    return m;
  };
  for (const g of gastos.data ?? []) {
    const m = de(mesDe(g.mes));
    const monto = Number(g.monto);
    const c = g.concepto as ConceptoOperativo;
    m.gastos = Math.round((m.gastos + monto) * 100) / 100;
    m.porConcepto[c] = Math.round(((m.porConcepto[c] ?? 0) + monto) * 100) / 100;
    m.gastosDetalle.push({ concepto: c, descripcion: g.descripcion, monto });
  }
  for (const b of bases.data ?? []) {
    const m = de(mesDe(b.mes));
    m.baseOdoo = b.costo_ventas_odoo === null ? null : Number(b.costo_ventas_odoo);
    m.baseManual = b.costo_ventas_manual === null ? null : Number(b.costo_ventas_manual);
    m.calculadoEn = b.calculado_en;
    m.nota = b.nota;
  }
  for (const m of meses.values()) {
    m.base = m.baseManual ?? m.baseOdoo;
    m.tasa = tasaDelMes(m);
  }
  return [...meses.values()].sort((a, b) => b.mes.localeCompare(a.mes));
}

/** Reemplaza los gastos de operar de un mes. */
export async function guardarGastosDelMes(
  mes: string,
  gastos: { concepto: ConceptoOperativo; descripcion: string | null; monto: number }[],
): Promise<Resultado> {
  const supabase = await clienteServidor();
  const { error: alBorrar } = await supabase.from("gastos_operativos").delete().eq("mes", primerDia(mes));
  if (alBorrar) return { ok: false, error: mensajeDeError(alBorrar) };
  if (gastos.length) {
    const base = Date.now();
    const { error } = await supabase.from("gastos_operativos").insert(
      gastos.map((g, i) => ({
        mes: primerDia(mes),
        concepto: g.concepto,
        descripcion: g.descripcion,
        monto: g.monto,
        creado_en: new Date(base + i).toISOString(),
      })),
    );
    if (error) return { ok: false, error: mensajeDeError(error) };
  }
  return { ok: true };
}

/** Corrige a mano la base de un mes (`null` vuelve a la calculada con Odoo). */
export async function guardarBaseManual(mes: string, valor: number | null, nota: string | null): Promise<Resultado> {
  const supabase = await clienteServidor();
  const { error } = await supabase
    .from("bases_mes")
    .upsert({ mes: primerDia(mes), costo_ventas_manual: valor, nota, actualizado_en: new Date().toISOString() }, { onConflict: "mes" });
  return error ? { ok: false, error: mensajeDeError(error) } : { ok: true };
}

/**
 * El costo de lo vendido en un mes, con Odoo: lo que salió a clientes (menos lo
 * devuelto) × el 1er costo de cada producto a fin de ese mes. Sin costo en la
 * app, se usa el costo de Odoo (`standard_price`). Queda guardado en el mes.
 */
export async function calcularBaseDelMes(mes: string): Promise<Resultado & { base?: number }> {
  if (!odooConfigurado()) return { ok: false, error: ODOO_NO_CONFIGURADO };
  // El mes en Lima (UTC−5), en la hora de Odoo (UTC).
  let salidas: Map<number, number>;
  try {
    salidas = await salidasAClientes(`${primerDia(mes)} 05:00:00`, `${primerDia(mesSiguiente(mes))} 05:00:00`);
  } catch (e) {
    return { ok: false, error: e instanceof ErrorOdoo ? e.message : "No se pudo leer lo vendido en Odoo." };
  }
  const ids = [...salidas.keys()];
  const supabase = await clienteServidor();
  const costoDe = new Map<number, number>();
  if (ids.length) {
    const { data, error } = await supabase
      .from("costos_historial")
      .select("producto_odoo_id, fecha, costo_unitario_pen, origen")
      .in("producto_odoo_id", ids)
      .lt("fecha", primerDia(mesSiguiente(mes)))
      .order("fecha", { ascending: false })
      .order("creado_en", { ascending: false });
    if (error) return { ok: false, error: mensajeDeError(error) };
    for (const f of data ?? []) if (!costoDe.has(f.producto_odoo_id)) costoDe.set(f.producto_odoo_id, Number(f.costo_unitario_pen));
  }
  const faltan = ids.filter((id) => !costoDe.has(id));
  let sinCosto = 0;
  if (faltan.length) {
    try {
      const deOdoo = await costosPorId(faltan);
      for (const id of faltan) {
        const c = deOdoo.get(id);
        if (c && c > 0) costoDe.set(id, c);
        else sinCosto++;
      }
    } catch {
      sinCosto = faltan.length;
    }
  }
  const base = Math.round(ids.reduce((t, id) => t + (salidas.get(id) ?? 0) * (costoDe.get(id) ?? 0), 0) * 100) / 100;
  const { error } = await supabase
    .from("bases_mes")
    .upsert({ mes: primerDia(mes), costo_ventas_odoo: base, calculado_en: new Date().toISOString(), actualizado_en: new Date().toISOString() }, { onConflict: "mes" });
  if (error) return { ok: false, error: mensajeDeError(error) };
  return sinCosto
    ? { ok: true, base, aviso: `${sinCosto} ${sinCosto === 1 ? "producto vendido no tiene" : "productos vendidos no tienen"} costo: no suman.` }
    : { ok: true, base };
}

/* ── La tabla y el gráfico ─────────────────────────────────────────────────── */

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

/** La tabla: cada plancha activa con sus dos costos, su precio y su factor; y las series del gráfico. */
export async function cargarCostosYPrecios(): Promise<DatosCostosPrecios> {
  const supabase = await clienteServidor();
  const [config, catalogo, historial, factores, precios, meses] = await Promise.all([
    cargarConfigCostos(),
    cargarCatalogoPlanchas(true),
    supabase.from("costos_historial").select(COLUMNAS_HISTORIAL).order("fecha", { ascending: false }).order("creado_en", { ascending: false }),
    supabase.from("factores_plancha").select("codigo_odoo, factor"),
    supabase.from("cambios_precio").select("producto_odoo_id, precio_nuevo, creado_en").order("creado_en").limit(5000),
    cargarMeses(),
  ]);
  if (historial.error) throw new Error(`No se pudo leer el historial de costos: ${historial.error.message}`);
  if (factores.error) throw new Error(`No se pudieron leer los factores: ${factores.error.message}`);
  if (precios.error) throw new Error(`No se pudo leer el historial de precios: ${precios.error.message}`);

  const porProducto = new Map<number, PuntoCosto[]>();
  for (const f of (historial.data ?? []) as unknown as FilaHistorial[]) {
    const lista = porProducto.get(f.producto_odoo_id) ?? [];
    lista.push(dePunto(f));
    porProducto.set(f.producto_odoo_id, lista);
  }
  const factorDe = new Map((factores.data ?? []).map((m) => [m.codigo_odoo, Number(m.factor)]));
  const tasaVigente = tasaOperativa(meses, mesDe(hoy()), config.mesesPromedio);

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
      const conKilos = puntos.find((x) => x.costoKgPen && x.costoKgPen > 0);
      const excepcion = factorDe.get(f.codigo) ?? null;
      const objetivo = factorObjetivo(config, g.material, excepcion);
      const segundo = ultimo ? segundoCosto(ultimo.costoUnitarioPen, tasaVigente) : null;
      const precio = p?.precio ?? null;
      return {
        productoId: p?.id ?? null,
        codigo: f.codigo,
        material: g.material,
        color: colorDe(g),
        espesorMm: g.espesorMm,
        medida: medidaDe(f),
        areaM2: Math.round(((f.anchoCm * f.largoCm) / 10_000) * 10_000) / 10_000,
        kgPorPlancha: conKilos ? Math.round((conKilos.costoUnitarioPen / conKilos.costoKgPen!) * 1000) / 1000 : null,
        titulo: `${colorDe(g)} · ${espesorTexto(g.espesorMm)} · ${medidaDe(f)}`,
        ultimoCosto: ultimo,
        costoPromedio: costoPromedio(puntos),
        segundoCosto: segundo,
        precio,
        margenActual: precio !== null && segundo ? margenActual(precio, segundo, config) : null,
        factorActual: precio !== null && segundo ? factorActual(precio, segundo, config) : null,
        factorObjetivo: objetivo.factor,
        origenFactor: objetivo.origen,
        factorPlancha: excepcion,
        sugerido: segundo ? precioSugerido(segundo, objetivo.factor, config) : null,
      };
    }),
  );

  const series: Series = { costos: {}, precios: {} };
  for (const [id, puntos] of porProducto) {
    series.costos[id] = [...puntos].reverse().map((x) => ({ fecha: x.fecha, costo: x.costoUnitarioPen }));
  }
  for (const c of precios.data ?? []) {
    (series.precios[c.producto_odoo_id] ??= []).push({ fecha: c.creado_en.slice(0, 10), precio: Number(c.precio_nuevo) });
  }

  return { config, filas, materiales: [...new Set(catalogo.map((g) => g.material))], meses, tasaVigente, series, errorOdoo };
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
      .select(
        "creado_en, precio_anterior, precio_nuevo, costo_base, segundo_costo, factor, margen_pct, quien:usuarios!cambios_precio_creado_por_fkey ( nombre )",
      )
      .eq("producto_odoo_id", productoId)
      .order("creado_en", { ascending: false })
      .limit(100),
  ]);
  if (costos.error) throw new Error(costos.error.message);
  if (precios.error) throw new Error(precios.error.message);
  const n = (v: number | null) => (v === null ? null : Number(v));
  return {
    costos: ((costos.data ?? []) as unknown as FilaHistorial[]).map(dePunto),
    precios: (precios.data ?? []).map((p) => ({
      fecha: p.creado_en,
      precioAnterior: n(p.precio_anterior),
      precioNuevo: Number(p.precio_nuevo),
      costoBase: n(p.costo_base),
      segundoCosto: n(p.segundo_costo),
      factor: n(p.factor),
      margenPct: n(p.margen_pct),
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
  segundoCosto: number | null;
  factor: number | null;
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
      segundo_costo: p.segundoCosto,
      factor: p.factor,
      margen_pct: p.margenPct,
    });
    if (error) console.error("[costos] historial de precio", error);
  }
  if (fallidos.length === lista.length) return { ok: false, error: fallidos.join(" · ") };
  return fallidos.length ? { ok: true, aviso: `No se cambiaron: ${fallidos.join(" · ")}` } : { ok: true };
}
