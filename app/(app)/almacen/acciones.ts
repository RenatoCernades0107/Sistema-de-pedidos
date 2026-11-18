"use server";

/**
 * Lo que la pantalla del almacén escribe.
 *
 * Ingresar stock, crear productos y almacenes, registrar sobrantes a mano: quien
 * gestiona el stock (Administración y Logística). Cambiar precios: solo
 * Administración. El taller ve el almacén pero no lo cambia; sus sobrantes los
 * anota al pasar un pedido a Listo, desde el pedido.
 *
 * Cada acción revisa el permiso aquí, y la base lo vuelve a revisar con su RLS.
 */

import { after } from "next/server";
import { refresh } from "next/cache";
import { z as zod } from "zod";
import type { z } from "zod";
import { guardarAlmacen as guardar } from "@/lib/almacenes-servidor";
import { ROLES, type PermisosRol } from "@/lib/dominio";
import { esquemaSobrante, esquemaUbicacionSobrante } from "@/lib/esquemas";
import {
  esquemaAccesorioExistente,
  esquemaAlmacen,
  esquemaCategoria,
  esquemaIngreso,
  esquemaNuevoProducto,
  esquemaPrecio,
  esquemaPrecioSobrante,
  esquemaTransferencia,
} from "@/lib/inventario";
import * as faltantes from "@/lib/faltantes-servidor";
import { esquemaBaja, esquemaCierre, esquemaGuardarConteo, esquemaNuevoConteo } from "@/lib/casos";
import * as casos from "@/lib/casos-servidor";
import * as conteos from "@/lib/conteos-servidor";
import { cargarKardex, type ResultadoKardex } from "@/lib/kardex-servidor";
import { productosDeLotes } from "@/lib/odoo/sobrantes";
import { clienteServidor } from "@/lib/supabase-servidor";
import { despacharNotificaciones } from "../notificaciones-acciones";
import * as transferencias from "@/lib/transferencias-servidor";
import { buscarClientes } from "@/lib/odoo/catalogos";
import { ErrorOdoo } from "@/lib/odoo/rpc";
import type { ClienteOdoo } from "@/lib/odoo/tipos";
import { exigirSesion } from "@/lib/sesion";
import {
  llevarAOdoo,
  moverSobrante,
  registrarSobrante as registrar,
  sincronizarSobrantes as sincronizar,
  type ResumenSincronizacion,
} from "@/lib/sobrantes-servidor";
import * as stock from "@/lib/stock-servidor";

const esquemaKardex = zod.object({
  productoId: zod.number().int().positive().nullable(),
  sobrante: zod.string().trim().min(1).nullable(),
  almacenId: zod.uuid().nullable(),
  dias: zod.number().int().min(1).max(3650),
});

export type ResultadoAlmacen =
  | { ok: true; codigo?: string; aviso?: string; resumen?: ResumenSincronizacion }
  | { ok: false; error: string };

const primerError = (e: z.ZodError) => e.issues[0]?.message ?? "Los datos no son válidos.";

/** El permiso, o por qué no. */
async function puede(permiso: keyof PermisosRol): Promise<ResultadoAlmacen | null> {
  const perfil = await exigirSesion();
  if (ROLES[perfil.rol][permiso] === true) return null;
  return {
    ok: false,
    error:
      permiso === "editarPrecios"
        ? "Solo Administración cambia los precios de venta."
        : permiso === "cerrarCasos"
          ? "Solo Administración cierra los casos de stock."
          : "Tu rol puede ver el almacén, pero no cambiarlo.",
  };
}

/** Valida, revisa el permiso, hace y refresca la pantalla. */
async function con<T>(
  permiso: keyof PermisosRol,
  esquema: z.ZodType<T>,
  entrada: unknown,
  hacer: (v: T) => Promise<ResultadoAlmacen>,
): Promise<ResultadoAlmacen> {
  const no = await puede(permiso);
  if (no) return no;
  const datos = esquema.safeParse(entrada);
  if (!datos.success) return { ok: false, error: primerError(datos.error) };
  const r = await hacer(datos.data);
  refresh();
  return r;
}

/* ── Stock ─────────────────────────────────────────────────────────────────── */

export async function registrarIngreso(entrada: unknown) {
  return con("gestionarStock", esquemaIngreso, entrada, stock.registrarIngreso);
}

export async function reintentarIngreso(id: unknown): Promise<ResultadoAlmacen> {
  const no = await puede("gestionarStock");
  if (no) return no;
  if (typeof id !== "string" || !id) return { ok: false, error: "Falta el ingreso." };
  const r = await stock.llevarIngresoAOdoo(id);
  refresh();
  return r;
}

/** Los proveedores (contactos de Odoo) para una compra. */
export async function buscarProveedores(q: unknown): Promise<{ ok: true; proveedores: ClienteOdoo[] } | { ok: false; error: string }> {
  const no = await puede("gestionarStock");
  if (no) return no as { ok: false; error: string };
  if (typeof q !== "string" || q.trim().length < 2) return { ok: true, proveedores: [] };
  try {
    const r = await buscarClientes(q.trim().slice(0, 80));
    return { ok: true, proveedores: r.resultados.map((x) => x.item) };
  } catch (e) {
    return { ok: false, error: e instanceof ErrorOdoo ? e.message : "No se pudo buscar en Odoo." };
  }
}

/* ── Productos y precios ───────────────────────────────────────────────────── */

export async function crearProducto(entrada: unknown): Promise<ResultadoAlmacen> {
  const perfil = await exigirSesion();
  return con("gestionarStock", esquemaNuevoProducto, entrada, (v) =>
    stock.crearProducto(v, ROLES[perfil.rol].editarPrecios),
  );
}

export async function agregarAccesorioExistente(entrada: unknown) {
  return con("gestionarStock", esquemaAccesorioExistente, entrada, (v) =>
    stock.agregarAccesorioExistente(v.codigo, v.categoriaId),
  );
}

export async function cambiarPrecio(entrada: unknown) {
  return con("editarPrecios", esquemaPrecio, entrada, (v) => stock.cambiarPrecioProducto(v.productoId, v.precio));
}

export async function fijarPrecioSobrante(entrada: unknown) {
  return con("editarPrecios", esquemaPrecioSobrante, entrada, (v) => stock.fijarPrecioSobrante(v.codigo, v.precio));
}

export async function guardarCategoria(entrada: unknown) {
  return con("gestionarStock", esquemaCategoria, entrada, stock.guardarCategoria);
}

export async function cambiarCategoriaDeAccesorio(id: unknown, categoriaId: unknown): Promise<ResultadoAlmacen> {
  const no = await puede("gestionarStock");
  if (no) return no;
  if (typeof id !== "string" || typeof categoriaId !== "string") return { ok: false, error: "Faltan datos." };
  const r = await stock.cambiarAccesorio(id, { categoriaId });
  refresh();
  return r;
}

/* ── Almacenes ─────────────────────────────────────────────────────────────── */

export async function guardarAlmacen(entrada: unknown) {
  return con("gestionarStock", esquemaAlmacen, entrada, guardar);
}

/* ── Sobrantes ─────────────────────────────────────────────────────────────── */

export async function registrarSobrante(entrada: unknown) {
  return con("gestionarStock", esquemaSobrante, entrada, registrar);
}

export async function reintentarSobrante(codigo: unknown): Promise<ResultadoAlmacen> {
  const no = await puede("gestionarStock");
  if (no) return no;
  if (typeof codigo !== "string" || !codigo.trim()) return { ok: false, error: "Falta el código del sobrante." };
  const r = await llevarAOdoo(codigo.trim());
  refresh();
  return r;
}

export async function cambiarUbicacionSobrante(entrada: unknown) {
  return con("gestionarStock", esquemaUbicacionSobrante, entrada, (v) => moverSobrante(v.codigo, v.ubicacion));
}

export async function sincronizarSobrantes(): Promise<ResultadoAlmacen> {
  const no = await puede("gestionarStock");
  if (no) return no;
  try {
    const resumen = await sincronizar();
    refresh();
    return { ok: true, resumen };
  } catch (e) {
    if (!(e instanceof ErrorOdoo)) console.error("[almacen] sincronizar", e);
    return { ok: false, error: e instanceof ErrorOdoo ? e.message : "Algo falló al sincronizar con Odoo." };
  }
}

/* ── Transferencias y avisos de "mover stock" ──────────────────────────────── */

export async function crearTransferencia(entrada: unknown) {
  return con("gestionarStock", esquemaTransferencia, entrada, transferencias.crearTransferencia);
}

/** Recibe una transferencia en camino. Lo hace también el taller: es quien recibe lo que le llega. */
export async function recibirTransferencia(id: unknown): Promise<ResultadoAlmacen> {
  const perfil = await exigirSesion();
  if (!ROLES[perfil.rol].verAlmacen) return { ok: false, error: "Tu rol no recibe transferencias." };
  if (typeof id !== "string") return { ok: false, error: "Esa transferencia no existe." };
  const r = await transferencias.recibirTransferencia(id, ROLES[perfil.rol].gestionarStock);
  refresh();
  return r;
}

export async function reintentarTransferencia(id: unknown): Promise<ResultadoAlmacen> {
  const no = await puede("gestionarStock");
  if (no) return no;
  if (typeof id !== "string") return { ok: false, error: "Esa transferencia no existe." };
  const r = await transferencias.llevarAOdoo(id);
  refresh();
  return r;
}

export async function anularTransferencia(id: unknown): Promise<ResultadoAlmacen> {
  const no = await puede("gestionarStock");
  if (no) return no;
  if (typeof id !== "string") return { ok: false, error: "Esa transferencia no existe." };
  const r = await transferencias.anularTransferencia(id);
  refresh();
  return r;
}

export async function descartarFaltante(id: unknown): Promise<ResultadoAlmacen> {
  const no = await puede("gestionarStock");
  if (no) return no;
  if (typeof id !== "string") return { ok: false, error: "Ese aviso no existe." };
  const r = await faltantes.descartarFaltante(id);
  refresh();
  return r;
}

/** Vuelve a mirar qué les falta a los pedidos con avisos abiertos (o a uno). */
export async function revisarFaltantes(pedidoId?: unknown): Promise<ResultadoAlmacen> {
  const no = await puede("gestionarStock");
  if (no) return no;
  const pedidos =
    typeof pedidoId === "string" ? [pedidoId] : [...new Set((await faltantes.cargarFaltantes()).map((f) => f.pedidoId))];
  const problemas: string[] = [];
  for (const p of pedidos) {
    const r = await faltantes.revisarFaltantesDePedido(p, { libre: false, avisar: false });
    if (!r.ok) problemas.push(r.error);
  }
  refresh();
  return problemas.length ? { ok: false, error: problemas[0] } : { ok: true };
}

/* ── Bajas, casos y conteos ────────────────────────────────────────────────── */

/** Reporta una baja: queda pendiente hasta que Administración la cierra. */
export async function reportarBaja(entrada: unknown) {
  return con("gestionarStock", esquemaBaja, entrada, async (v) => {
    const r = await casos.reportarBaja(v);
    if (r.ok) after(despacharNotificaciones);
    return r;
  });
}

/**
 * Administración reporta y cierra a la vez (lo vio ella misma): igual queda el
 * caso, con su razón.
 */
export async function reportarYAplicarBaja(entrada: unknown, razon: unknown): Promise<ResultadoAlmacen> {
  const no = await puede("cerrarCasos");
  if (no) return no;
  const datos = esquemaBaja.safeParse(entrada);
  if (!datos.success) return { ok: false, error: primerError(datos.error) };
  if (typeof razon !== "string" || razon.trim().length < 5) return { ok: false, error: "Escribe la razón (al menos 5 letras)." };
  const r = await casos.reportarBaja(datos.data);
  if (!r.ok) return r;
  const supabase = await clienteServidor();
  const { data } = await supabase.from("casos_stock").select("id").eq("codigo", r.codigo!).single();
  const cierre = await casos.cerrarCaso({ id: data!.id, decision: "aplicar", razon: razon.trim() });
  refresh();
  return cierre.ok ? { ok: true, codigo: r.codigo } : { ok: true, codigo: r.codigo, aviso: `Quedó reportada, pero no se aplicó: ${cierre.error}` };
}

export async function cerrarCaso(entrada: unknown) {
  return con("cerrarCasos", esquemaCierre, entrada, casos.cerrarCaso);
}

export async function crearConteo(entrada: unknown) {
  return con("gestionarStock", esquemaNuevoConteo, entrada, conteos.crearConteo);
}

export async function guardarConteo(entrada: unknown) {
  return con("gestionarStock", esquemaGuardarConteo, entrada, conteos.guardarConteo);
}

export async function agregarAlConteo(id: unknown, productoId: unknown): Promise<ResultadoAlmacen> {
  const no = await puede("gestionarStock");
  if (no) return no;
  if (typeof id !== "string" || typeof productoId !== "number") return { ok: false, error: "Ese producto no se puede agregar." };
  const r = await conteos.agregarAlConteo(id, productoId);
  refresh();
  return r;
}

/** Guarda lo último contado y lo envía a revisión. */
export async function enviarConteo(entrada: unknown) {
  return con("gestionarStock", esquemaGuardarConteo, entrada, async (v) => {
    const guardado = await conteos.guardarConteo(v);
    if (!guardado.ok) return guardado;
    const r = await conteos.enviarConteo(v.id);
    if (r.ok && r.diferencias) after(despacharNotificaciones);
    return r.ok
      ? {
          ok: true as const,
          codigo: r.codigo,
          aviso:
            `${r.diferencias} ${r.diferencias === 1 ? "diferencia" : "diferencias"}, ${r.coinciden} ${r.coinciden === 1 ? "coincide" : "coinciden"}` +
            (r.sinContar ? ` y ${r.sinContar} sin contar` : ""),
        }
      : r;
  });
}

export async function anularConteo(id: unknown): Promise<ResultadoAlmacen> {
  const no = await puede("gestionarStock");
  if (no) return no;
  if (typeof id !== "string") return { ok: false, error: "Ese conteo no existe." };
  const r = await conteos.anularConteo(id);
  refresh();
  return r;
}

/** El kárdex de un producto (o del lote de un sobrante). Lo ven los tres roles. */
export async function leerKardex(entrada: unknown): Promise<ResultadoKardex> {
  const perfil = await exigirSesion();
  if (!ROLES[perfil.rol].verAlmacen) return { ok: false, error: "Tu rol no ve el almacén." };
  const datos = esquemaKardex.safeParse(entrada);
  if (!datos.success) return { ok: false, error: primerError(datos.error) };
  const v = datos.data;
  let sobrante: { loteId: number; almacenId: string; vigente: boolean } | null = null;
  let productoId = v.productoId;
  if (v.sobrante) {
    const supabase = await clienteServidor();
    const { data: s } = await supabase.from("sobrantes").select("odoo_lot_id, almacen_id, estado").eq("codigo", v.sobrante).maybeSingle();
    if (!s?.odoo_lot_id) return { ok: false, error: "Ese sobrante no tiene lote en Odoo." };
    const producto = (await productosDeLotes([s.odoo_lot_id])).get(s.odoo_lot_id);
    if (!producto) return { ok: false, error: "El lote de ese sobrante ya no está en Odoo." };
    productoId = producto;
    sobrante = { loteId: s.odoo_lot_id, almacenId: s.almacen_id, vigente: s.estado === "disponible" || s.estado === "reservado" };
  }
  if (!productoId) return { ok: false, error: "Elige un producto." };
  return cargarKardex({ productoId, almacenId: v.almacenId, dias: v.dias, sobrante });
}
