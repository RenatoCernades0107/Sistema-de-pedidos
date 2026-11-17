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

import { refresh } from "next/cache";
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
