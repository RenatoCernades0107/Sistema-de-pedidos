/**
 * Los faltantes del lado del servidor: elegir el almacén de despacho por el
 * stock, calcular qué le falta a un pedido (y avisar), y leerlos para las
 * pantallas.
 *
 * Al registrar el pedido se mira el stock **libre** (lo que no está reservado):
 * el pedido todavía no reservó nada. Al revisar después (llegó una
 * transferencia, alguien pulsó "Revisar de nuevo") el pedido ya reservó lo suyo
 * en Odoo y el libre ya no lo cuenta: se mira lo que **hay**, que es lo que
 * importa para saber si el material llegó.
 */

import { cache } from "react";
import type { Almacen } from "./almacenes";
import { cargarAlmacenes, odooDeAlmacen } from "./almacenes-servidor";
import { cargarCatalogoPlanchas } from "./cortes-servidor";
import { mensajeDeError } from "./errores";
import {
  elegirDespacho,
  faltantesDe,
  necesidadesDeLineas,
  productosDeLineas,
  type EstadoFaltante,
  type Faltante,
  type FaltanteGuardado,
  type LineaConMaterial,
  type MotivoFaltante,
  type StockLibre,
} from "./faltantes";
import { stockPorAlmacen, type UbicacionDeAlmacen } from "./odoo/almacenes";
import { ErrorOdoo, ODOO_NO_CONFIGURADO, odooConfigurado } from "./odoo/rpc";
import { leerLineasDePedido } from "./pedido-odoo-servidor";
import { clienteServidor } from "./supabase-servidor";

const mensajeOdoo = (e: unknown, contexto: string) => {
  if (e instanceof ErrorOdoo) return e.message;
  console.error(`[faltantes] ${contexto}`, e);
  return "Algo falló al hablar con Odoo.";
};

/** Los códigos de Odoo que llevan stock en la app: las planchas del catálogo y los accesorios. */
export const codigosAlmacenables = cache(async (): Promise<Set<string>> => {
  const supabase = await clienteServidor();
  const [catalogo, { data: accesorios, error }] = await Promise.all([
    cargarCatalogoPlanchas(),
    supabase.from("accesorios").select("codigo_odoo"),
  ]);
  if (error) throw new Error(`No se pudieron leer los accesorios: ${error.message}`);
  return new Set([...catalogo.flatMap((g) => g.formatos.map((f) => f.codigo)), ...(accesorios ?? []).map((a) => a.codigo_odoo)]);
});

/** Los productos de unas líneas que llevan stock (por su código). */
async function almacenablesDe(lineas: LineaConMaterial[]): Promise<Set<number>> {
  const codigos = await codigosAlmacenables();
  return new Set(lineas.filter((l) => l.codigo && codigos.has(l.codigo)).map((l) => l.productoId));
}

/** Las ubicaciones en Odoo de los almacenes activos (los que fallan se saltan). */
async function ubicaciones(almacenes: Almacen[]): Promise<UbicacionDeAlmacen[]> {
  const salida: UbicacionDeAlmacen[] = [];
  for (const a of almacenes.filter((x) => x.activo)) {
    try {
      salida.push({ almacenId: a.id, ubicacionId: (await odooDeAlmacen(a)).ubicacionId });
    } catch (e) {
      console.warn(`[faltantes] ${a.nombre} no está en Odoo:`, e instanceof Error ? e.message : e);
    }
  }
  return salida;
}

/** El stock de unos productos por almacén: el libre, o lo que hay. */
async function stockDe(productoIds: number[], almacenes: Almacen[], libre: boolean): Promise<StockLibre> {
  const leido = await stockPorAlmacen(productoIds, await ubicaciones(almacenes), { libre });
  return new Map([...leido].map(([id, s]) => [id, s.porAlmacen]));
}

/**
 * El almacén de despacho que dice el stock. `null` si Odoo no responde (quien
 * llama usa la regla de siempre).
 */
export async function despachoPorStock(lineas: LineaConMaterial[]): Promise<Almacen | null> {
  if (!odooConfigurado()) return null;
  try {
    const almacenes = await cargarAlmacenes();
    const stock = await stockDe(productosDeLineas(lineas), almacenes, true);
    const elegido = elegirDespacho(lineas, stock, almacenes, await almacenablesDe(lineas));
    return elegido ? (almacenes.find((a) => a.id === elegido.id) ?? null) : null;
  } catch (e) {
    mensajeOdoo(e, "despacho por stock");
    return null;
  }
}

/** Lo que le faltaría a unas líneas despachando de un almacén. Para mostrar, no se guarda. */
export async function faltantesPrevistos(
  lineas: LineaConMaterial[],
  despachoId: string,
): Promise<{ ok: true; faltantes: Faltante[] } | { ok: false; error: string }> {
  if (!odooConfigurado()) return { ok: false, error: ODOO_NO_CONFIGURADO };
  try {
    const almacenes = await cargarAlmacenes();
    const necesidades = necesidadesDeLineas(lineas, despachoId, almacenes, await almacenablesDe(lineas));
    if (necesidades.length === 0) return { ok: true, faltantes: [] };
    const stock = await stockDe([...new Set(necesidades.map((n) => n.productoId))], almacenes, true);
    return { ok: true, faltantes: faltantesDe(necesidades, stock, almacenes) };
  } catch (e) {
    return { ok: false, error: mensajeOdoo(e, "previstos") };
  }
}

/* ── Los faltantes de un pedido ────────────────────────────────────────────── */

const COLUMNAS =
  "id, pedido_id, producto_odoo_id, codigo, nombre, cantidad, almacen_id, motivo, origen_sugerido_id, estado, transferencia_id, creado_en, pedidos(codigo), transferencias_stock(codigo)";

interface Fila {
  id: string;
  pedido_id: string;
  producto_odoo_id: number;
  codigo: string | null;
  nombre: string;
  cantidad: number;
  almacen_id: string;
  motivo: string;
  origen_sugerido_id: string | null;
  estado: string;
  transferencia_id: string | null;
  creado_en: string;
  pedidos: { codigo: string } | null;
  transferencias_stock: { codigo: string } | null;
}

const deFila = (f: Fila): FaltanteGuardado => ({
  id: f.id,
  pedidoId: f.pedido_id,
  pedidoCodigo: f.pedidos?.codigo ?? "",
  productoId: f.producto_odoo_id,
  codigo: f.codigo,
  nombre: f.nombre,
  cantidad: Number(f.cantidad),
  almacenId: f.almacen_id,
  motivo: f.motivo as MotivoFaltante,
  origenSugeridoId: f.origen_sugerido_id,
  estado: f.estado as EstadoFaltante,
  transferenciaId: f.transferencia_id,
  transferenciaCodigo: f.transferencias_stock?.codigo ?? null,
  creadoEn: f.creado_en,
});

/** Los que esperan que alguien mueva algo (o que ya está en camino), de todos los pedidos. */
export async function cargarFaltantes(): Promise<FaltanteGuardado[]> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from("faltantes_stock")
    .select(COLUMNAS)
    .in("estado", ["pendiente", "en_camino"])
    .order("creado_en");
  if (error) throw new Error(`No se pudieron leer los faltantes: ${error.message}`);
  return ((data ?? []) as unknown as Fila[]).map(deFila);
}

/** Los de un pedido que siguen abiertos. */
export async function faltantesDePedido(pedidoId: string): Promise<FaltanteGuardado[]> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from("faltantes_stock")
    .select(COLUMNAS)
    .eq("pedido_id", pedidoId)
    .in("estado", ["pendiente", "en_camino"])
    .order("creado_en");
  if (error) throw new Error(`No se pudieron leer los faltantes del pedido: ${error.message}`);
  return ((data ?? []) as unknown as Fila[]).map(deFila);
}

export type ResultadoRevision = { ok: true; abiertos: number; nuevos: number } | { ok: false; error: string };

/** Estados de un pedido que ya no necesitan material. */
const SIN_MATERIAL = new Set(["listo", "en_transito", "entregado", "anulado"]);

/**
 * Calcula lo que le falta a un pedido y lo deja escrito: agrega lo nuevo,
 * actualiza lo que sigue faltando y da por resuelto lo que ya alcanza. Con
 * `avisar`, si hay faltantes nuevos encola el aviso para Logística y
 * Administración. Solo lo hace quien gestiona el stock o quien registra el
 * pedido (lo comprueba el RLS al escribir).
 */
export async function revisarFaltantesDePedido(
  pedidoId: string,
  opciones: { libre: boolean; avisar: boolean },
): Promise<ResultadoRevision> {
  const supabase = await clienteServidor();
  const { data: pedido, error: alLeer } = await supabase
    .from("pedidos")
    .select("id, codigo, estado, cotizaciones(almacen_despacho_id)")
    .eq("id", pedidoId)
    .maybeSingle();
  if (alLeer) return { ok: false, error: mensajeDeError(alLeer) };
  if (!pedido) return { ok: false, error: "Ese pedido no existe." };

  const { data: abiertos, error: alLeerAbiertos } = await supabase
    .from("faltantes_stock")
    .select("id, producto_odoo_id, almacen_id, estado")
    .eq("pedido_id", pedidoId)
    .in("estado", ["pendiente", "en_camino"]);
  if (alLeerAbiertos) return { ok: false, error: mensajeDeError(alLeerAbiertos) };

  // Un pedido terminado (o anulado) ya no espera material.
  if (SIN_MATERIAL.has(pedido.estado)) {
    if (abiertos?.length) {
      await supabase
        .from("faltantes_stock")
        .update({ estado: "resuelto", resuelto_en: new Date().toISOString() })
        .in("id", abiertos.map((f) => f.id));
    }
    return { ok: true, abiertos: 0, nuevos: 0 };
  }

  const cotizacion = Array.isArray(pedido.cotizaciones) ? pedido.cotizaciones[0] : pedido.cotizaciones;
  if (!cotizacion) return { ok: true, abiertos: 0, nuevos: 0 }; // un pedido de antes de Odoo
  if (!odooConfigurado()) return { ok: false, error: ODOO_NO_CONFIGURADO };

  let faltantes: Faltante[];
  try {
    const almacenes = await cargarAlmacenes();
    const despachoId =
      cotizacion.almacen_despacho_id ?? almacenes.find((a) => a.tipo === "tienda" && a.activo)?.id ?? null;
    if (!despachoId) return { ok: false, error: "No hay almacén de despacho." };
    const lineas = await leerLineasDePedido(pedido.codigo);
    const necesidades = necesidadesDeLineas(lineas, despachoId, almacenes, await almacenablesDe(lineas));
    const stock = necesidades.length
      ? await stockDe([...new Set(necesidades.map((n) => n.productoId))], almacenes, opciones.libre)
      : new Map();
    faltantes = faltantesDe(necesidades, stock, almacenes);
  } catch (e) {
    return { ok: false, error: mensajeOdoo(e, "revisar") };
  }

  const clave = (productoId: number, almacenId: string) => `${productoId}|${almacenId}`;
  const previos = new Map((abiertos ?? []).map((f) => [clave(f.producto_odoo_id, f.almacen_id), f]));
  const siguen = new Set<string>();
  let nuevos = 0;

  for (const f of faltantes) {
    const k = clave(f.productoId, f.almacenId);
    siguen.add(k);
    const previo = previos.get(k);
    const valores = { cantidad: f.falta, origen_sugerido_id: f.origenSugeridoId, nombre: f.nombre, codigo: f.codigo };
    const { error } = previo
      ? await supabase.from("faltantes_stock").update(valores).eq("id", previo.id)
      : await supabase.from("faltantes_stock").insert({
          ...valores,
          pedido_id: pedidoId,
          producto_odoo_id: f.productoId,
          almacen_id: f.almacenId,
          motivo: f.motivo,
        });
    if (error) return { ok: false, error: mensajeDeError(error) };
    if (!previo) nuevos++;
  }

  const resueltos = (abiertos ?? []).filter((f) => !siguen.has(clave(f.producto_odoo_id, f.almacen_id))).map((f) => f.id);
  if (resueltos.length) {
    const { error } = await supabase
      .from("faltantes_stock")
      .update({ estado: "resuelto", resuelto_en: new Date().toISOString() })
      .in("id", resueltos);
    if (error) return { ok: false, error: mensajeDeError(error) };
  }

  if (opciones.avisar && nuevos > 0) {
    const { error } = await supabase.rpc("avisar_faltantes", { p_pedido: pedidoId });
    if (error) console.warn("[faltantes] no se encoló el aviso:", error.message);
  }
  return { ok: true, abiertos: faltantes.length, nuevos };
}

/** Ya no hace falta mover nada (lo resolvieron de otra forma). */
export async function descartarFaltante(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from("faltantes_stock")
    .update({ estado: "descartado", resuelto_en: new Date().toISOString() })
    .eq("id", id)
    .eq("estado", "pendiente")
    .select("id");
  if (error) return { ok: false, error: mensajeDeError(error) };
  if (!data?.length) return { ok: false, error: "Ese aviso ya no está pendiente." };
  return { ok: true };
}
