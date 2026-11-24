"use server";

/**
 * Las pruebas de cálculo de `/configuracion`: correr una y aprobar su
 * resultado. Solo Administración.
 *
 * Aprobar vuelve a correr la prueba aquí y guarda ese resultado: no el que
 * mande el navegador.
 */

import { refresh } from "next/cache";
import { exigirAdmin } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase-servidor";
import { mensajeDeError } from "@/lib/errores";
import { cargarPruebasGuardadas, ejecutarPrueba } from "@/lib/pruebas-calculo/ejecutar-servidor";
import { CLAVE_PRUEBAS_CALCULO, esquemaCaso, type Ejecucion, type PruebaAprobada } from "@/lib/pruebas-calculo/prueba";
import type { Json } from "@/lib/supabase-tipos";

const CASO_INVALIDO = "El caso de prueba no es válido.";

export async function ejecutarPruebaCalculo(caso: unknown): Promise<Ejecucion> {
  await exigirAdmin();
  const datos = esquemaCaso.safeParse(caso);
  if (!datos.success) return { ok: false, error: CASO_INVALIDO };
  return ejecutarPrueba(datos.data);
}

export async function aprobarPruebaCalculo(caso: unknown): Promise<Ejecucion> {
  const perfil = await exigirAdmin();
  const datos = esquemaCaso.safeParse(caso);
  if (!datos.success) return { ok: false, error: CASO_INVALIDO };

  const ejecucion = await ejecutarPrueba(datos.data);
  if (!ejecucion.ok) return ejecucion;

  const aprobada: PruebaAprobada = {
    caso: datos.data,
    resultado: ejecucion.resultado,
    aprobadoEn: new Date().toISOString(),
    aprobadoPor: perfil.nombre,
  };
  const guardadas = { ...(await cargarPruebasGuardadas()), [datos.data.tipo]: aprobada };
  const supabase = await clienteServidor();
  const { error } = await supabase
    .from("configuracion")
    .upsert({ clave: CLAVE_PRUEBAS_CALCULO, valor: guardadas as unknown as Json }, { onConflict: "clave" });
  if (error) return { ok: false, error: mensajeDeError(error) };

  refresh();
  return ejecucion;
}
