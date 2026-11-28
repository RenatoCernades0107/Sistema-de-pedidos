"use server";

/**
 * Lo que la pantalla de compras escribe: la pre-compra, confirmarla (orden de
 * compra en Odoo), anularla, sus gastos y la liquidación del costo.
 *
 * Lo hace quien gestiona compras (Administración y Logística). Recibir la
 * mercadería es de Almacén (`app/(app)/almacen/acciones.ts`). Cada acción revisa
 * el permiso aquí, y la base lo vuelve a revisar con su RLS.
 */

import { refresh } from "next/cache";
import { z } from "zod";
import { esquemaCompra, esquemaCorreccionCompra } from "@/lib/compras";
import * as compras from "@/lib/compras-servidor";
import { ROLES } from "@/lib/dominio";
import { buscarClientes } from "@/lib/odoo/catalogos";
import { ErrorOdoo } from "@/lib/odoo/rpc";
import type { ClienteOdoo } from "@/lib/odoo/tipos";
import { exigirSesion } from "@/lib/sesion";

type Resultado = compras.ResultadoCompra;

const primerError = (e: z.ZodError) => e.issues[0]?.message ?? "Los datos no son válidos.";

async function puede(): Promise<Resultado | null> {
  const perfil = await exigirSesion();
  return ROLES[perfil.rol].gestionarCompras ? null : { ok: false, error: "Tu rol no gestiona compras." };
}

async function con<T>(esquema: z.ZodType<T>, entrada: unknown, hacer: (v: T) => Promise<Resultado>): Promise<Resultado> {
  const no = await puede();
  if (no) return no;
  const datos = esquema.safeParse(entrada);
  if (!datos.success) return { ok: false, error: primerError(datos.error) };
  const r = await hacer(datos.data);
  refresh();
  return r;
}

const id = z.uuid("Falta la compra.");

export async function guardarCompra(entrada: unknown) {
  return con(esquemaCompra, entrada, compras.guardarCompra);
}

export async function confirmarCompra(entrada: unknown) {
  return con(id, entrada, compras.confirmarCompra);
}

export async function reintentarCompra(entrada: unknown) {
  return con(id, entrada, async (v) => {
    const r = await compras.llevarCompraAOdoo(v);
    return r.ok ? { ok: true } : r;
  });
}

export async function corregirCompra(entrada: unknown) {
  return con(esquemaCorreccionCompra, entrada, compras.corregirCompra);
}

export async function anularCompra(entrada: unknown) {
  return con(id, entrada, compras.anularCompra);
}

const esquemaTraer = z.object({
  aplicar: z.boolean(),
  desde: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha no es válida")
    .nullable(),
});

/**
 * Las órdenes de compra de Odoo que la app no tiene. Con `aplicar: false` solo
 * muestra cuáles entrarían; con `true` las guarda.
 */
export async function traerComprasDeOdoo(entrada: unknown): Promise<compras.ResultadoImportacion> {
  const no = await puede();
  if (no) return no as { ok: false; error: string };
  const datos = esquemaTraer.safeParse(entrada);
  if (!datos.success) return { ok: false, error: primerError(datos.error) };
  const r = await compras.traerComprasDeOdoo(datos.data);
  // También tras solo revisar: se rellenan los números de orden de Odoo de las compras que no lo tenían.
  if (r.ok) refresh();
  return r;
}

/** Por qué una orden de Odoo (P01726) entra o no entra al traer de Odoo. */
export async function explicarOrdenDeOdoo(numero: unknown, desde: unknown): Promise<{ ok: true; veredicto: string } | { ok: false; error: string }> {
  const no = await puede();
  if (no) return no as { ok: false; error: string };
  const datos = z
    .object({ numero: z.string().trim().min(2, "Escribe el número de la orden, por ejemplo P01726").max(40), desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable() })
    .safeParse({ numero, desde: desde || null });
  if (!datos.success) return { ok: false, error: primerError(datos.error) };
  return compras.explicarOrdenDeOdoo(datos.data.numero, datos.data.desde);
}

/** Los proveedores (contactos de Odoo) para una compra. */
export async function buscarProveedores(q: unknown): Promise<{ ok: true; proveedores: ClienteOdoo[] } | { ok: false; error: string }> {
  const no = await puede();
  if (no) return no as { ok: false; error: string };
  if (typeof q !== "string" || q.trim().length < 2) return { ok: true, proveedores: [] };
  try {
    const r = await buscarClientes(q.trim().slice(0, 80));
    return { ok: true, proveedores: r.resultados.map((x) => x.item) };
  } catch (e) {
    return { ok: false, error: e instanceof ErrorOdoo ? e.message : "No se pudo buscar en Odoo." };
  }
}
