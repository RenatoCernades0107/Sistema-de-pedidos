"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ERROR_LOGIN_SIN_CLAVE, claveDeLogin } from "@/lib/login-secreto";
import { rutaInternaSegura } from "@/lib/ruta-segura";
import { clienteServidor } from "@/lib/supabase-servidor";

const ERROR_CREDENCIALES = "Usuario o contraseña incorrectos.";
const ERROR_BLOQUEADO = "Demasiados intentos. Espera unos minutos e inténtalo otra vez.";

/**
 * La IP de quien pide el login, para el bloqueo por dirección. Detrás del proxy del
 * hosting llega en `x-forwarded-for` (la primera es la del cliente). Vacía si no se
 * sabe: entonces solo cuenta el límite por usuario.
 */
async function ipDelCliente(): Promise<string> {
  const cabeceras = await headers();
  const reenviada = cabeceras.get("x-forwarded-for")?.split(",")[0]?.trim();
  return reenviada || cabeceras.get("x-real-ip")?.trim() || "";
}

export interface EstadoLogin {
  error?: string;
  usuario?: string;
}

/**
 * Entrar al sistema con usuario y contraseña. El rol no se elige: sale del
 * perfil ligado a la cuenta.
 *
 * Supabase Auth solo autentica por correo, así que el usuario se traduce a su
 * correo con `email_de_usuario` antes de autenticar. Esa función exige la clave del
 * servidor (`LOGIN_SECRET`): el correo puede ser el real de la persona y no se le
 * entrega a nadie que solo conozca su usuario.
 *
 * Los errores no distinguen entre usuario inexistente y contraseña equivocada:
 * decir "ese usuario no existe" le regala a cualquiera la lista de cuentas.
 */
export async function iniciarSesion(
  _previo: EstadoLogin,
  datos: FormData,
): Promise<EstadoLogin> {
  const usuario = String(datos.get("usuario") ?? "").trim();
  const password = String(datos.get("password") ?? "");
  const siguiente = String(datos.get("siguiente") ?? "");

  if (!usuario || !password) {
    return { error: "Escribe tu usuario y tu contraseña.", usuario };
  }

  const clave = claveDeLogin();
  if (!clave) return { error: ERROR_LOGIN_SIN_CLAVE, usuario };

  const supabase = await clienteServidor();
  const ip = await ipDelCliente();

  // Mientras hay bloqueo no se anotan más fallos, así que se levanta a los 15 minutos
  // del último y nadie lo alarga por seguir probando.
  const { data: bloqueado } = await supabase.rpc("login_bloqueado", {
    nombre_usuario: usuario,
    direccion_ip: ip,
    clave,
  });
  if (bloqueado) return { error: ERROR_BLOQUEADO, usuario };

  const fallar = async (): Promise<EstadoLogin> => {
    await supabase.rpc("registrar_intento_fallido", {
      nombre_usuario: usuario,
      direccion_ip: ip,
      clave,
    });
    return { error: ERROR_CREDENCIALES, usuario };
  };

  const { data: email } = await supabase.rpc("email_de_usuario", {
    nombre_usuario: usuario,
    clave,
  });

  // Usuario inexistente y contraseña equivocada cuentan y responden igual.
  if (!email) return fallar();

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) return fallar();

  await supabase.rpc("limpiar_intentos_login", { nombre_usuario: usuario, clave });

  const { data: { user } } = await supabase.auth.getUser();
  const { data: perfil } = await supabase
    .from("usuarios")
    .select("activo")
    .eq("id", user!.id)
    .maybeSingle();

  // Una cuenta desactivada puede autenticarse pero no ve nada: mejor decirlo
  // aquí que dejarla dando vueltas contra una app vacía.
  if (!perfil?.activo) {
    await supabase.auth.signOut();
    return { error: "Tu cuenta está desactivada. Habla con Administración.", usuario };
  }

  revalidatePath("/", "layout");
  redirect(rutaInternaSegura(siguiente));
}

export async function cerrarSesion() {
  const supabase = await clienteServidor();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
