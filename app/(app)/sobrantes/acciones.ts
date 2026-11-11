"use server";

/**
 * Lo que la pantalla de Sobrantes escribe. Los tres roles: el taller mide y
 * guarda los sobrantes, y la RLS de `sobrantes` lo permite a todos.
 */

import { refresh } from "next/cache";
import { exigirSesion } from "@/lib/sesion";
import { esquemaSobrante, esquemaUbicacionSobrante } from "@/lib/esquemas";
import { ErrorOdoo } from "@/lib/odoo/rpc";
import {
  llevarAOdoo,
  moverSobrante,
  registrarSobrante as registrar,
  sincronizarSobrantes as sincronizar,
  type ResumenSincronizacion,
} from "@/lib/sobrantes-servidor";

export type ResultadoSobrante =
  | { ok: true; codigo?: string; aviso?: string; resumen?: ResumenSincronizacion }
  | { ok: false; error: string };

const primerError = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? "Los datos no son válidos.";

export async function registrarSobrante(entrada: unknown): Promise<ResultadoSobrante> {
  await exigirSesion();
  const datos = esquemaSobrante.safeParse(entrada);
  if (!datos.success) return { ok: false, error: primerError(datos.error) };
  const r = await registrar(datos.data);
  refresh();
  return r;
}

export async function reintentarSobrante(codigo: unknown): Promise<ResultadoSobrante> {
  await exigirSesion();
  if (typeof codigo !== "string" || !codigo.trim()) return { ok: false, error: "Falta el código del sobrante." };
  const r = await llevarAOdoo(codigo.trim());
  refresh();
  return r;
}

export async function cambiarUbicacionSobrante(entrada: unknown): Promise<ResultadoSobrante> {
  await exigirSesion();
  const datos = esquemaUbicacionSobrante.safeParse(entrada);
  if (!datos.success) return { ok: false, error: primerError(datos.error) };
  const r = await moverSobrante(datos.data.codigo, datos.data.ubicacion);
  refresh();
  return r;
}

export async function sincronizarSobrantes(): Promise<ResultadoSobrante> {
  await exigirSesion();
  try {
    const resumen = await sincronizar();
    refresh();
    return { ok: true, resumen };
  } catch (e) {
    if (!(e instanceof ErrorOdoo)) console.error("[sobrantes] sincronizar", e);
    return { ok: false, error: e instanceof ErrorOdoo ? e.message : "Algo falló al sincronizar con Odoo." };
  }
}
