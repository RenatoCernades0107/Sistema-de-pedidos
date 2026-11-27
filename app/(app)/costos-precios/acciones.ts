"use server";

/**
 * Lo que la pantalla de costos y precios escribe: los márgenes (general, por
 * material y por plancha), las tarifas de mano de obra y los precios de venta
 * que se aplican en Odoo. Solo Administración; la base lo vuelve a exigir.
 */

import { refresh } from "next/cache";
import { z } from "zod";
import { esquemaConfigCostos } from "@/lib/costeo";
import * as costos from "@/lib/costos-servidor";
import { ROLES, type PermisosRol } from "@/lib/dominio";
import { exigirSesion } from "@/lib/sesion";

type Resultado = { ok: true; aviso?: string } | { ok: false; error: string };

async function puede(permiso: keyof PermisosRol): Promise<{ ok: false; error: string } | null> {
  const perfil = await exigirSesion();
  if (ROLES[perfil.rol][permiso] === true) return null;
  return { ok: false, error: permiso === "editarPrecios" ? "Solo Administración cambia los precios de venta." : "Tu rol no ve los costos." };
}

const primerError = (e: z.ZodError) => e.issues[0]?.message ?? "Los datos no son válidos.";

export async function guardarConfigCostos(entrada: unknown): Promise<Resultado> {
  const no = await puede("verCostos");
  if (no) return no;
  const datos = esquemaConfigCostos.safeParse(entrada);
  if (!datos.success) return { ok: false, error: primerError(datos.error) };
  const r = await costos.guardarConfigCostos(datos.data);
  refresh();
  return r;
}

const esquemaMargenPlancha = z.object({
  codigo: z.string().trim().min(1).max(40),
  margen: z.number({ error: "El margen es un porcentaje" }).min(0, "El margen no puede ser negativo").max(95, "Un margen de más de 95% no es razonable").nullable(),
});

export async function guardarMargenPlancha(entrada: unknown): Promise<Resultado> {
  const no = await puede("verCostos");
  if (no) return no;
  const datos = esquemaMargenPlancha.safeParse(entrada);
  if (!datos.success) return { ok: false, error: primerError(datos.error) };
  const r = await costos.guardarMargenPlancha(datos.data.codigo, datos.data.margen);
  refresh();
  return r;
}

const esquemaPrecios = z
  .array(
    z.object({
      productoId: z.number().int().positive(),
      codigo: z.string().trim().min(1).max(40),
      nombre: z.string().trim().min(1).max(200),
      precioAnterior: z.number().min(0).nullable(),
      precio: z.number().positive("El precio tiene que ser mayor que cero").max(1_000_000),
      costoBase: z.number().min(0).nullable(),
      margenPct: z.number().min(0).max(100).nullable(),
    }),
  )
  .min(1, "Elige al menos un precio")
  .max(500);

export async function aplicarPrecios(entrada: unknown): Promise<Resultado> {
  const no = (await puede("verCostos")) ?? (await puede("editarPrecios"));
  if (no) return no;
  const datos = esquemaPrecios.safeParse(entrada);
  if (!datos.success) return { ok: false, error: primerError(datos.error) };
  const r = await costos.aplicarPrecios(datos.data);
  refresh();
  return r;
}

export async function historialDePlancha(
  productoId: unknown,
): Promise<{ ok: true; historial: Awaited<ReturnType<typeof costos.historialDe>> } | { ok: false; error: string }> {
  const no = await puede("verCostos");
  if (no) return no;
  const id = z.number().int().positive().safeParse(productoId);
  if (!id.success) return { ok: false, error: "Falta la plancha." };
  try {
    return { ok: true, historial: await costos.historialDe(id.data) };
  } catch {
    return { ok: false, error: "No se pudo leer el historial." };
  }
}
