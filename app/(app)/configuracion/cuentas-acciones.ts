"use server";

/**
 * Agregar y retirar las cuentas bancarias que salen en el PDF de la cotización.
 *
 * Cada cambio pide otra vez la contraseña de quien lo hace: una sesión abierta
 * en una PC del mostrador, o una cookie robada, no alcanza para cambiar a dónde
 * pagan los clientes. Solo después de comprobarla el servidor le presenta a la
 * base su clave (`LOGIN_SECRET`), sin la cual las funciones no escriben. El resto
 * de las reglas (24 horas de espera, avisos, sin ediciones) están en la base:
 * ver `supabase/migrations/20261210000100_cuentas_bancarias.sql`.
 */

import { headers } from "next/headers";
import { refresh } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { exigirAdmin, type Perfil } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase-servidor";
import { mensajeDeError } from "@/lib/errores";
import { ERROR_LOGIN_SIN_CLAVE, claveDeLogin } from "@/lib/login-secreto";
import { esquemaCuentaBancaria } from "@/lib/cuentas-bancarias";
import type { Database } from "@/lib/supabase-tipos";

type Resultado = { ok: true } | { ok: false; error: string };

const fallo = (error: string): Resultado => ({ ok: false, error });

const ERROR_PASSWORD = "La contraseña no es correcta.";
const ERROR_BLOQUEADO = "Demasiados intentos. Espera unos minutos e inténtalo otra vez.";

async function ipDelCliente(): Promise<string> {
  const cabeceras = await headers();
  const reenviada = cabeceras.get("x-forwarded-for")?.split(",")[0]?.trim();
  return reenviada || cabeceras.get("x-real-ip")?.trim() || "";
}

/**
 * Comprueba la contraseña de quien tiene la sesión y devuelve la clave del
 * servidor para la base, o el error que mostrar.
 *
 * Se autentica con un cliente aparte, sin cookies, y esa sesión de prueba se
 * cierra enseguida: la sesión de la persona no se toca. Los fallos cuentan para
 * el mismo bloqueo que el login, así que esto no sirve para adivinar contraseñas.
 */
async function confirmarIdentidad(perfil: Perfil, password: string): Promise<{ clave: string } | { error: string }> {
  if (!password) return { error: "Escribe tu contraseña para confirmar el cambio." };

  const clave = claveDeLogin();
  if (!clave) return { error: ERROR_LOGIN_SIN_CLAVE };

  const supabase = await clienteServidor();
  const ip = await ipDelCliente();

  const { data: bloqueado } = await supabase.rpc("login_bloqueado", {
    nombre_usuario: perfil.usuario,
    direccion_ip: ip,
    clave,
  });
  if (bloqueado) return { error: ERROR_BLOQUEADO };

  const fallar = async () => {
    await supabase.rpc("registrar_intento_fallido", { nombre_usuario: perfil.usuario, direccion_ip: ip, clave });
    return { error: ERROR_PASSWORD };
  };

  const { data: email } = await supabase.rpc("email_de_usuario", { nombre_usuario: perfil.usuario, clave });
  if (!email) return fallar();

  const aparte = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
  const { data, error } = await aparte.auth.signInWithPassword({ email, password });
  if (error || data.user?.id !== perfil.id) return fallar();
  await aparte.auth.signOut({ scope: "local" });

  await supabase.rpc("limpiar_intentos_login", { nombre_usuario: perfil.usuario, clave });
  return { clave };
}

const esquemaAgregar = z.object({
  cuenta: esquemaCuentaBancaria,
  password: z.string().max(200),
});

export async function agregarCuentaBancaria(entrada: unknown): Promise<Resultado> {
  const perfil = await exigirAdmin();
  const datos = esquemaAgregar.safeParse(entrada);
  if (!datos.success) return fallo(datos.error.issues[0]?.message ?? "Los datos no son válidos.");
  const { cuenta, password } = datos.data;

  const identidad = await confirmarIdentidad(perfil, password);
  if ("error" in identidad) return fallo(identidad.error);

  const supabase = await clienteServidor();
  const { error } = await supabase.rpc("agregar_cuenta_bancaria", {
    p_banco: cuenta.banco,
    p_tipo: cuenta.tipo,
    p_moneda: cuenta.moneda,
    p_numero: cuenta.numero,
    p_cci: cuenta.cci,
    clave: identidad.clave,
  });
  if (error) return fallo(mensajeDeError(error));

  refresh();
  return { ok: true };
}

const esquemaRetirar = z.object({
  id: z.uuid(),
  password: z.string().max(200),
});

export async function retirarCuentaBancaria(entrada: unknown): Promise<Resultado> {
  const perfil = await exigirAdmin();
  const datos = esquemaRetirar.safeParse(entrada);
  if (!datos.success) return fallo("Los datos no son válidos.");

  const identidad = await confirmarIdentidad(perfil, datos.data.password);
  if ("error" in identidad) return fallo(identidad.error);

  const supabase = await clienteServidor();
  const { error } = await supabase.rpc("retirar_cuenta_bancaria", { p_id: datos.data.id, clave: identidad.clave });
  if (error) return fallo(mensajeDeError(error));

  refresh();
  return { ok: true };
}
