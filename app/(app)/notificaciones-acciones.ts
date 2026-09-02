"use server";

/**
 * Las escrituras de los avisos: suscribir un navegador, darlo de baja, enlazar a
 * un trabajador con su cuenta, y empujar la cola.
 *
 * Van aparte de `acciones.ts` porque no tocan `pedidos`: ninguna pasa por el
 * trigger de escritura por rol ni deja fila de auditoría. Lo que sí comparten son
 * las tres reglas de allí — sesión de quien pide, Zod otra vez en el servidor, y
 * el permiso comprobado aquí y no al pintar el botón.
 *
 * Quien firma y manda el push no está aquí: eso es la Edge Function
 * `enviar-push`, porque necesita la clave privada VAPID y la de servicio, y la
 * app web no guarda secretos de servidor.
 */

import { refresh } from "next/cache";
import { clienteServidor } from "@/lib/supabase-servidor";
import { exigirAdmin, exigirSesion } from "@/lib/sesion";
import { mensajeDeError } from "@/lib/errores";
import {
  esquemaBajaSuscripcion,
  esquemaEnlaceTrabajador,
  esquemaSuscripcion,
} from "@/lib/esquemas";
import type { Resultado } from "./acciones";

const fallo = (error: string): Resultado => ({ ok: false, error });

/* ── Suscripción del navegador ──────────────────────────────────────────────── */

/**
 * Guarda (o reasigna) la suscripción de este navegador.
 *
 * Es un upsert por `endpoint`, no un insert. El endpoint identifica una
 * instalación de navegador, no a una persona: si dos operarios usan la misma PC
 * del taller, el segundo que active los avisos recibe el mismo endpoint que el
 * primero. Con el upsert la fila cambia de dueño; con un insert habría dos filas
 * y los pedidos del primero sonarían en el turno del segundo.
 *
 * La RLS (`suscripciones_propias`) obliga a que `usuario_id` sea `auth.uid()`, así
 * que no hace falta comprobar aquí que no se esté suscribiendo a nombre de otro:
 * el `with check` de la política lo rechaza en la base.
 */
export async function guardarSuscripcion(entrada: unknown): Promise<Resultado> {
  const perfil = await exigirSesion();

  const datos = esquemaSuscripcion.safeParse(entrada);
  if (!datos.success) {
    return fallo(datos.error.issues[0]?.message ?? "La suscripción no es válida.");
  }

  const supabase = await clienteServidor();
  const { error } = await supabase.from("suscripciones_push").upsert(
    {
      usuario_id: perfil.id,
      endpoint: datos.data.endpoint,
      p256dh: datos.data.p256dh,
      auth: datos.data.auth,
      navegador: datos.data.navegador,
      usada_en: null,
    },
    { onConflict: "endpoint" },
  );

  if (error) return fallo(mensajeDeError(error));
  return { ok: true };
}

/** Baja de este navegador. Solo puede borrar la suya: lo impone la RLS. */
export async function borrarSuscripcion(entrada: unknown): Promise<Resultado> {
  await exigirSesion();

  const datos = esquemaBajaSuscripcion.safeParse(entrada);
  if (!datos.success) return fallo("La suscripción no es válida.");

  const supabase = await clienteServidor();
  const { error } = await supabase
    .from("suscripciones_push")
    .delete()
    .eq("endpoint", datos.data.endpoint);

  if (error) return fallo(mensajeDeError(error));
  return { ok: true };
}

/* ── Empujar la cola ────────────────────────────────────────────────────────── */

/**
 * Le dice a la Edge Function que hay algo que mandar.
 *
 * No devuelve nada ni lanza: se llama desde `after()`, cuando la respuesta ya
 * salió, y un aviso que no sale no puede convertirse en un error en la pantalla
 * de quien acaba de guardar un pedido. Si esto falla, el cron del minuto
 * (`despachar_push()`) recoge la fila igual — que es justamente para lo que está.
 */
export async function despacharNotificaciones(): Promise<void> {
  try {
    const supabase = await clienteServidor();
    const { error } = await supabase.functions.invoke("enviar-push", { body: {} });
    if (error) console.error("enviar-push:", error.message);
  } catch (e) {
    console.error("enviar-push no respondió:", e);
  }
}

/* ── Enlace trabajador ↔ cuenta ─────────────────────────────────────────────── */

/**
 * Enlaza a un trabajador con la cuenta de la app de esa persona, o lo desenlaza
 * (`usuarioId: null`).
 *
 * Desenlazar no es un borrado ni un error: un operario sin cuenta es el caso que
 * la tabla `trabajadores` existe para permitir. Simplemente deja de recibir
 * avisos.
 *
 * La columna es UNIQUE, así que enlazar una cuenta que ya es de otro trabajador
 * devuelve 23505; `mensajeDeError` lo traduce.
 */
export async function enlazarTrabajador(entrada: unknown): Promise<Resultado> {
  await exigirAdmin();

  const datos = esquemaEnlaceTrabajador.safeParse(entrada);
  if (!datos.success) return fallo("Los datos del enlace no son válidos.");

  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from("trabajadores")
    .update({ usuario_id: datos.data.usuarioId })
    .eq("id", datos.data.trabajadorId)
    .select("id");

  if (error) return fallo(mensajeDeError(error));
  if (!data || data.length === 0) {
    return fallo("Ese trabajador ya no existe. Recarga la página.");
  }

  refresh();
  return { ok: true };
}
