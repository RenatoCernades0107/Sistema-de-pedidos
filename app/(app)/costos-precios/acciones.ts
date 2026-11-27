"use server";

/**
 * Lo que la pantalla de costos y precios escribe. Solo Administración; la base
 * lo vuelve a exigir.
 *
 *   - Costear una compra: sus gastos y la liquidación (el 1er costo).
 *   - Los gastos de operar de cada mes y su base (el 2do costo).
 *   - Los factores (general, por material y por plancha) y las tarifas.
 *   - Los precios de venta que se aplican en Odoo.
 */

import { refresh } from "next/cache";
import { z } from "zod";
import { esquemaGastos } from "@/lib/compras";
import * as compras from "@/lib/compras-servidor";
import { CONCEPTOS_OPERATIVOS, esquemaConfigCostos } from "@/lib/costeo";
import * as costos from "@/lib/costos-servidor";
import { ROLES, type PermisosRol } from "@/lib/dominio";
import { exigirSesion } from "@/lib/sesion";

type Resultado = { ok: true; aviso?: string; codigo?: string } | { ok: false; error: string };

async function puede(permiso: keyof PermisosRol = "verCostos"): Promise<{ ok: false; error: string } | null> {
  const perfil = await exigirSesion();
  if (ROLES[perfil.rol][permiso] === true) return null;
  return { ok: false, error: permiso === "editarPrecios" ? "Solo Administración cambia los precios de venta." : "Tu rol no ve los costos." };
}

const primerError = (e: z.ZodError) => e.issues[0]?.message ?? "Los datos no son válidos.";

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
const mes = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "El mes no es válido");

/* ── Costear una compra (1er costo) ────────────────────────────────────────── */

export async function guardarGastos(entrada: unknown) {
  return con(esquemaGastos, entrada, compras.guardarGastos);
}

export async function liquidarCompra(entrada: unknown) {
  return con(id, entrada, compras.liquidarCompra);
}

export async function reabrirLiquidacion(entrada: unknown) {
  return con(id, entrada, compras.reabrirLiquidacion);
}

/* ── Gastos de operar (2do costo) ──────────────────────────────────────────── */

const esquemaGastosMes = z.object({
  mes,
  gastos: z
    .array(
      z.object({
        concepto: z.enum(CONCEPTOS_OPERATIVOS),
        descripcion: z
          .string()
          .trim()
          .max(120, "La descripción es muy larga")
          .transform((v) => v || null)
          .nullable(),
        monto: z.number({ error: "El monto es un número" }).min(0, "El monto no puede ser negativo").max(100_000_000),
      }),
    )
    .max(100),
});

export async function guardarGastosDelMes(entrada: unknown) {
  return con(esquemaGastosMes, entrada, (v) => costos.guardarGastosDelMes(v.mes, v.gastos));
}

export async function calcularBaseDelMes(entrada: unknown) {
  return con(mes, entrada, costos.calcularBaseDelMes);
}

const esquemaBase = z.object({
  mes,
  valor: z.number().min(0, "La base no puede ser negativa").max(10_000_000_000).nullable(),
  nota: z
    .string()
    .trim()
    .max(300)
    .transform((v) => v || null)
    .nullable(),
});

export async function guardarBaseManual(entrada: unknown) {
  return con(esquemaBase, entrada, (v) => costos.guardarBaseManual(v.mes, v.valor, v.nota));
}

/* ── Factores y precios ────────────────────────────────────────────────────── */

export async function guardarConfigCostos(entrada: unknown) {
  return con(esquemaConfigCostos, entrada, costos.guardarConfigCostos);
}

const esquemaFactorPlancha = z.object({
  codigo: z.string().trim().min(1).max(40),
  factor: z
    .number({ error: "El factor es un número" })
    .min(1, "El factor no puede ser menor que 1: venderías bajo el costo")
    .max(10, "Un factor de más de 10 no es razonable")
    .nullable(),
});

export async function guardarFactorPlancha(entrada: unknown) {
  return con(esquemaFactorPlancha, entrada, (v) => costos.guardarFactorPlancha(v.codigo, v.factor));
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
      segundoCosto: z.number().min(0).nullable(),
      factor: z.number().min(0).max(100).nullable(),
      margenPct: z.number().min(-1000).max(100).nullable(),
    }),
  )
  .min(1, "Elige al menos un precio")
  .max(500);

export async function aplicarPrecios(entrada: unknown): Promise<Resultado> {
  const no = (await puede()) ?? (await puede("editarPrecios"));
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
  const no = await puede();
  if (no) return no;
  const p = z.number().int().positive().safeParse(productoId);
  if (!p.success) return { ok: false, error: "Falta la plancha." };
  try {
    return { ok: true, historial: await costos.historialDe(p.data) };
  } catch {
    return { ok: false, error: "No se pudo leer el historial." };
  }
}
