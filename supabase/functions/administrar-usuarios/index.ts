/**
 * Altas, bajas y correos de las cuentas del sistema, para la vista `/usuarios`
 * (solo Administración).
 *
 * Vive aquí y no en Next por lo mismo que `enviar-push`: crear una cuenta, cambiar
 * la contraseña o el correo de otra persona exige la clave de servicio, y esa no
 * puede entrar al entorno de la app web, que hoy no guarda ninguna.
 *
 * `verify_jwt` queda en true, y además se comprueba aquí que quien llama es
 * Administración activa: un JWT válido de un operario no basta. La contraseña
 * temporal se devuelve una sola vez en la respuesta; no se guarda ni se registra.
 *
 * Responde 200 con `{ ok: false, error }` para los errores de negocio (usuario
 * repetido, intentar desactivarse a uno mismo…) y deja 401/403 para quien no puede
 * llamar, de modo que la app distinga "esto no se puede" de "no estás autorizado".
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const CLAVE_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const CLAVE_SERVICIO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SUPABASE_URL, CLAVE_SERVICIO, { auth: { persistSession: false } });

/** Mismo formato que el CHECK `usuarios_usuario_formato` de la base. */
const FORMATO_USUARIO = /^[a-z0-9][a-z0-9._-]{2,29}$/;
const FORMATO_CORREO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ROLES = ["administracion", "logistica", "operaciones", "ventas"];
/** Dominio del correo interno de una cuenta que todavía no registró el suyo. */
const DOMINIO_INTERNO = "plexiacril.test";

/** Sin 0/O, 1/l/I: la contraseña se dicta por WhatsApp o de viva voz. */
const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

function contrasenaTemporal(largo = 12): string {
  const limite = 256 - (256 % ALFABETO.length); // sin sesgo de módulo
  let salida = "";
  while (salida.length < largo) {
    for (const b of crypto.getRandomValues(new Uint8Array(largo * 2))) {
      if (b < limite && salida.length < largo) salida += ALFABETO[b % ALFABETO.length];
    }
  }
  return salida;
}

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "content-type": "application/json" },
  });

const fallo = (error: string) => json({ ok: false, error });

type Cuerpo = {
  accion?: string;
  id?: string;
  usuario?: string;
  nombre?: string;
  rol?: string;
  correo?: string | null;
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido." }, 405);

  // ── Quién llama ──
  const quien = createClient(SUPABASE_URL, CLAVE_ANON, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });
  const { data: { user } } = await quien.auth.getUser();
  if (!user) return json({ ok: false, error: "Sin sesión." }, 401);

  const { data: esAdmin } = await quien.rpc("es_admin");
  if (!esAdmin) return json({ ok: false, error: "Solo Administración." }, 403);

  const c = (await req.json().catch(() => ({}))) as Cuerpo;

  switch (c.accion) {
    case "crear":
      return await crear(c);
    case "fijar_correo":
      return await fijarCorreo(c);
    case "desactivar":
      return await desactivar(c, user.id);
    case "reactivar":
      return await reactivar(c);
    case "restablecer_password":
      return await restablecerPassword(c, user.id);
    case "eliminar":
      return await eliminar(c, user.id);
    default:
      return fallo("Acción desconocida.");
  }
});

async function existe(id: string | undefined) {
  if (!id) return null;
  const { data } = await admin
    .from("usuarios")
    .select("id, rol, activo")
    .eq("id", id)
    .maybeSingle();
  return data;
}

async function crear(c: Cuerpo) {
  const usuario = (c.usuario ?? "").trim().toLowerCase();
  const nombre = (c.nombre ?? "").trim();
  const correo = (c.correo ?? "").trim().toLowerCase();

  if (!FORMATO_USUARIO.test(usuario)) {
    return fallo("El usuario debe tener de 3 a 30 letras minúsculas, números, punto, guion o guion bajo.");
  }
  if (nombre.length < 2 || nombre.length > 80) return fallo("Escribe el nombre (de 2 a 80 caracteres).");
  if (!c.rol || !ROLES.includes(c.rol)) return fallo("Elige un rol.");
  if (correo && (correo.length > 200 || !FORMATO_CORREO.test(correo))) return fallo("Ese correo no es válido.");

  const { data: repetido } = await admin.from("usuarios").select("id").eq("usuario", usuario).maybeSingle();
  if (repetido) return fallo("Ese usuario ya existe.");

  const password = contrasenaTemporal();
  const { data, error } = await admin.auth.admin.createUser({
    email: correo || `${usuario}@${DOMINIO_INTERNO}`,
    password,
    email_confirm: true,
    user_metadata: { nombre, usuario },
    // El rol va en app_metadata, que solo escribe quien tiene la clave de servicio: el
    // trigger del perfil ignora el de user_metadata, que controla quien se registra.
    app_metadata: { rol: c.rol },
  });

  if (error || !data.user) {
    if (error?.code === "email_exists") return fallo("Ese correo ya está en uso por otra cuenta.");
    console.error("[administrar-usuarios] crear:", error?.code ?? error?.message);
    return fallo("No se pudo crear la cuenta.");
  }

  // El perfil lo creó el trigger de auth.users; si trae un correo real, es también el
  // de recuperación (el trigger de sincronización solo corre al *cambiar* el correo).
  if (correo) {
    const { error: e } = await admin
      .from("usuarios")
      .update({ email_recuperacion: correo })
      .eq("id", data.user.id);
    if (e) console.error("[administrar-usuarios] correo del perfil:", e.message);
  }

  return json({ ok: true, id: data.user.id, password });
}

async function fijarCorreo(c: Cuerpo) {
  const correo = (c.correo ?? "").trim().toLowerCase();
  if (!correo || correo.length > 200 || !FORMATO_CORREO.test(correo)) return fallo("Ese correo no es válido.");
  if (!(await existe(c.id))) return fallo("No existe esa cuenta.");

  // `email_confirm`: lo registra Administración, que responde por él; no hay enlace.
  // El trigger `sincronizar_email_de_usuario` lo copia a `usuarios`.
  const { error } = await admin.auth.admin.updateUserById(c.id!, { email: correo, email_confirm: true });

  if (error) {
    if (error.code === "email_exists") return fallo("Ese correo ya está en uso por otra cuenta.");
    console.error("[administrar-usuarios] fijar_correo:", error.code ?? error.message);
    return fallo("No se pudo guardar el correo.");
  }
  return json({ ok: true });
}

async function desactivar(c: Cuerpo, quienLlama: string) {
  const objetivo = await existe(c.id);
  if (!objetivo) return fallo("No existe esa cuenta.");
  if (objetivo.id === quienLlama) return fallo("No puedes desactivar tu propia cuenta.");

  if (objetivo.rol === "administracion" && objetivo.activo) {
    const { count } = await admin
      .from("usuarios")
      .select("id", { count: "exact", head: true })
      .eq("rol", "administracion")
      .eq("activo", true)
      .neq("id", objetivo.id);
    if (!count) return fallo("Es la única cuenta de Administración activa: el sistema no puede quedarse sin ella.");
  }

  const { error } = await admin.from("usuarios").update({ activo: false }).eq("id", objetivo.id);
  if (error) {
    console.error("[administrar-usuarios] desactivar:", error.message);
    return fallo("No se pudo desactivar la cuenta.");
  }
  await admin.rpc("cerrar_sesiones_de", { p_usuario_id: objetivo.id });
  return json({ ok: true });
}

async function reactivar(c: Cuerpo) {
  if (!(await existe(c.id))) return fallo("No existe esa cuenta.");
  const { error } = await admin.from("usuarios").update({ activo: true }).eq("id", c.id!);
  if (error) {
    console.error("[administrar-usuarios] reactivar:", error.message);
    return fallo("No se pudo reactivar la cuenta.");
  }
  return json({ ok: true });
}

/**
 * Borra la cuenta de verdad. Solo si está desactivada y no tiene pedidos. Las demás
 * tablas que apuntan a la cuenta (pagos, historial…) no tienen `on delete`, así que si
 * quedan filas la base rechaza el borrado y se responde con un motivo legible.
 */
async function eliminar(c: Cuerpo, quienLlama: string) {
  const objetivo = await existe(c.id);
  if (!objetivo) return fallo("No existe esa cuenta.");
  if (objetivo.id === quienLlama) return fallo("No puedes eliminar tu propia cuenta.");
  if (objetivo.activo) return fallo("Desactiva la cuenta antes de eliminarla.");

  const { count, error: errorConteo } = await admin
    .from("pedidos")
    .select("id", { count: "exact", head: true })
    .eq("creado_por", objetivo.id);
  if (errorConteo) {
    console.error("[administrar-usuarios] eliminar (pedidos):", errorConteo.message);
    return fallo("No se pudo comprobar si la cuenta tiene pedidos.");
  }
  if (count) return fallo("Tiene pedidos: no se puede eliminar. Déjala desactivada para conservar el historial.");

  const { error } = await admin.auth.admin.deleteUser(objetivo.id);
  if (error) {
    console.error("[administrar-usuarios] eliminar:", error.code ?? error.message);
    if (/foreign key|23503|violates/i.test(`${error.code ?? ""} ${error.message}`)) {
      return fallo("Tiene registros asociados (pagos, historial…): no se puede eliminar. Déjala desactivada.");
    }
    return fallo("No se pudo eliminar la cuenta.");
  }
  return json({ ok: true });
}

async function restablecerPassword(c: Cuerpo, quienLlama: string) {
  const objetivo = await existe(c.id);
  if (!objetivo) return fallo("No existe esa cuenta.");
  if (objetivo.id === quienLlama) return fallo("Tu propia contraseña se cambia desde el menú de usuario.");
  if (!objetivo.activo) return fallo("La cuenta está desactivada. Reactívala primero.");

  const password = contrasenaTemporal();
  const { error } = await admin.auth.admin.updateUserById(objetivo.id, { password });
  if (error) {
    console.error("[administrar-usuarios] restablecer:", error.code ?? error.message);
    return fallo("No se pudo restablecer la contraseña.");
  }

  // Marca de "contraseña inicial": la obliga a cambiarla al entrar.
  const { error: e } = await admin
    .from("usuarios")
    .update({ debe_cambiar_password: true })
    .eq("id", objetivo.id);
  if (e) console.error("[administrar-usuarios] marca de cambio:", e.message);

  await admin.rpc("cerrar_sesiones_de", { p_usuario_id: objetivo.id });
  return json({ ok: true, password });
}
