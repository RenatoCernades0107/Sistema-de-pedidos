"use server";

/**
 * Las escrituras de la vista `/usuarios`. Solo Administración, y se comprueba aquí
 * y otra vez dentro de la Edge Function: el botón que no se pinta no es un permiso.
 *
 * Crear una cuenta, cambiar su contraseña o su correo, y desactivarla exigen la
 * clave de servicio, que no está en la app web: lo hace `administrar-usuarios`.
 * Lo único que se resuelve aquí es mandar el correo de recuperación, que no
 * necesita ningún secreto.
 */

import { createClient } from "@supabase/supabase-js";
import { refresh } from "next/cache";
import { clienteServidor } from "@/lib/supabase-servidor";
import { exigirAdmin } from "@/lib/sesion";
import { urlBase } from "@/lib/url-base";
import { esquemaFijarCorreo, esquemaIdUsuario, esquemaNuevoUsuario } from "@/lib/esquemas";

export type ResultadoUsuario =
  | { ok: true; id?: string; /** Contraseña temporal: se muestra una sola vez. */ password?: string }
  | { ok: false; error: string };

const fallo = (error: string): ResultadoUsuario => ({ ok: false, error });

async function invocar(cuerpo: Record<string, unknown>): Promise<ResultadoUsuario> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase.functions.invoke("administrar-usuarios", { body: cuerpo });

  if (error) {
    console.error("[usuarios]", error.message);
    return fallo("No se pudo completar la operación. Inténtalo otra vez.");
  }

  const r = data as ResultadoUsuario | null;
  if (!r) return fallo("La operación no respondió. Inténtalo otra vez.");
  if (r.ok) refresh();
  return r;
}

export async function crearUsuario(entrada: unknown): Promise<ResultadoUsuario> {
  await exigirAdmin();

  const datos = esquemaNuevoUsuario.safeParse(entrada);
  if (!datos.success) return fallo(datos.error.issues[0]?.message ?? "Los datos no son válidos.");

  return invocar({ accion: "crear", ...datos.data, correo: datos.data.correo || null });
}

export async function fijarCorreoDe(entrada: unknown): Promise<ResultadoUsuario> {
  await exigirAdmin();

  const datos = esquemaFijarCorreo.safeParse(entrada);
  if (!datos.success) return fallo(datos.error.issues[0]?.message ?? "Los datos no son válidos.");

  return invocar({ accion: "fijar_correo", ...datos.data });
}

async function conId(accion: string, entrada: unknown) {
  await exigirAdmin();
  const datos = esquemaIdUsuario.safeParse(entrada);
  if (!datos.success) return fallo("La cuenta no es válida.");
  return invocar({ accion, id: datos.data.id });
}

export async function desactivarUsuario(entrada: unknown): Promise<ResultadoUsuario> {
  return conId("desactivar", entrada);
}

export async function reactivarUsuario(entrada: unknown): Promise<ResultadoUsuario> {
  return conId("reactivar", entrada);
}

export async function eliminarUsuario(entrada: unknown): Promise<ResultadoUsuario> {
  return conId("eliminar", entrada);
}

export async function restablecerContrasenaDe(entrada: unknown): Promise<ResultadoUsuario> {
  return conId("restablecer_password", entrada);
}

/**
 * Manda a la cuenta el enlace para elegir contraseña nueva, al correo que tiene
 * registrado. Sin clave de servicio: `resetPasswordForEmail` es el mismo camino que
 * el "olvidé mi contraseña" del login, con la diferencia de que aquí quien lo pide
 * es Administración y lee el correo de la fila (la RLS se lo permite).
 *
 * Se hace con un cliente sin sesión ni cookies: con el de la app, la sesión de
 * Administración cargaría con el código de verificación de un enlace ajeno.
 */
export async function enviarCorreoDeRecuperacion(entrada: unknown): Promise<ResultadoUsuario> {
  await exigirAdmin();

  const datos = esquemaIdUsuario.safeParse(entrada);
  if (!datos.success) return fallo("La cuenta no es válida.");

  const supabase = await clienteServidor();
  const { data: cuenta } = await supabase
    .from("usuarios")
    .select("email, email_recuperacion, activo")
    .eq("id", datos.data.id)
    .maybeSingle();

  if (!cuenta) return fallo("No existe esa cuenta.");
  if (!cuenta.activo) return fallo("La cuenta está desactivada.");
  if (!cuenta.email_recuperacion) {
    return fallo("Esa cuenta no tiene correo de recuperación. Regístralo primero.");
  }

  const anonimo = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );

  const { error } = await anonimo.auth.resetPasswordForEmail(cuenta.email, {
    redirectTo: `${await urlBase()}/auth/confirmar`,
  });

  if (error) {
    if (error.code === "over_email_send_rate_limit") {
      return fallo("Se pidieron demasiados correos. Espera unos minutos e inténtalo otra vez.");
    }
    console.error("[usuarios] recuperación:", error.code ?? error.message);
    return fallo("No se pudo enviar el correo. Inténtalo otra vez.");
  }

  return { ok: true };
}
