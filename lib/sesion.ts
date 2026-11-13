import { cache } from "react";
import { redirect } from "next/navigation";
import { ROLES, RUTA_PEDIDOS, type Rol } from "./dominio";
import { clienteServidor } from "./supabase-servidor";

export interface Perfil {
  id: string;
  nombre: string;
  /** Lo que la persona escribe para entrar. El correo es interno. */
  usuario: string;
  rol: Rol;
  /** Sigue usando la contraseña con la que le crearon la cuenta. */
  debeCambiarPassword: boolean;
}

/** Lo único que puede ver quien todavía no ha cambiado su contraseña. */
export const RUTA_CAMBIO_PASSWORD = "/cambiar-contrasena";

/**
 * Quién está pidiendo esta página. Devuelve `null` si no hay sesión o si la
 * cuenta está desactivada.
 *
 * Va envuelto en `cache` para que el layout, la página y sus guardas compartan
 * una sola consulta por render.
 */
export const perfilActual = cache(async (): Promise<Perfil | null> => {
  const supabase = await clienteServidor();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data } = await supabase
    .from("usuarios")
    .select("id, nombre, usuario, rol, activo, debe_cambiar_password")
    .eq("id", user.id)
    .maybeSingle();

  if (!data?.activo) return null;

  return {
    id: data.id,
    nombre: data.nombre,
    usuario: data.usuario,
    rol: data.rol,
    debeCambiarPassword: data.debe_cambiar_password,
  };
});

/**
 * Sesión válida y contraseña ya cambiada. Es la puerta por la que pasan el layout
 * de `(app)`, la raíz y las tres guardas de abajo, así que basta con comprobarlo
 * aquí para que no haya vista que se salte el cambio.
 *
 * El proxy no lo mira: leer el perfil en cada petición sería una consulta a
 * Supabase por archivo servido, y lo que hay que impedir es que se *renderice*
 * una vista, no que se resuelva una ruta.
 *
 * La propia pantalla de cambio no llama a esto —usa `perfilActual`— o se
 * redirigiría a sí misma sin fin.
 */
export async function exigirSesion(): Promise<Perfil> {
  const perfil = await perfilActual();
  if (!perfil) redirect("/login");
  if (perfil.debeCambiarPassword) redirect(RUTA_CAMBIO_PASSWORD);
  return perfil;
}

export async function exigirCrearPedido(): Promise<Perfil> {
  const perfil = await exigirSesion();
  if (!ROLES[perfil.rol].crearPedido) {
    redirect(RUTA_PEDIDOS);
  }
  return perfil;
}

/**
 * Pantallas que no son una vista de pedidos y solo abre Administración, como el
 * enlace de trabajadores con sus cuentas.
 *
 * No pasa por `ROLES[...].alcances` a propósito: `Alcance` es la lista de
 * filtros sobre pedidos de `/pedidos`, y una pantalla que no filtra pedidos no
 * pinta nada ahí.
 */
export async function exigirAdmin(): Promise<Perfil> {
  const perfil = await exigirSesion();
  if (perfil.rol !== "administracion") {
    redirect(RUTA_PEDIDOS);
  }
  return perfil;
}

export async function exigirAgenteCotizacion(): Promise<Perfil> {
  const perfil = await exigirSesion();
  if (!ROLES[perfil.rol].usarAgenteCotizacion) {
    redirect(RUTA_PEDIDOS);
  }
  return perfil;
}

/** La lista, el registro y el detalle de las cotizaciones del sistema. */
export async function exigirCotizaciones(): Promise<Perfil> {
  const perfil = await exigirSesion();
  if (!ROLES[perfil.rol].gestionarCotizaciones) {
    redirect(RUTA_PEDIDOS);
  }
  return perfil;
}

/**
 * Lo mismo para un route handler que responde JSON: ahí un `redirect` devolvería
 * el HTML del login a un `fetch` que espera resultados. `null` si no puede.
 */
export async function perfilConCotizaciones(): Promise<Perfil | null> {
  const perfil = await perfilActual();
  if (!perfil || perfil.debeCambiarPassword) return null;
  return ROLES[perfil.rol].gestionarCotizaciones ? perfil : null;
}

/** La herramienta de diseños (`/disenos`): el chat, el render y las descargas del motor CAD. */
export async function exigirCad(): Promise<Perfil> {
  const perfil = await exigirSesion();
  if (!ROLES[perfil.rol].usarCad) {
    redirect(RUTA_PEDIDOS);
  }
  return perfil;
}

/** Lo mismo para los route handlers de `/api/cad` y del chat de diseños. `null` si no puede. */
export async function perfilConCad(): Promise<Perfil | null> {
  const perfil = await perfilActual();
  if (!perfil || perfil.debeCambiarPassword) return null;
  return ROLES[perfil.rol].usarCad ? perfil : null;
}

/**
 * El dashboard de `/metricas`. Va por su permiso y no por `exigirAdmin()` porque la
 * entrada del menú sale de ese mismo permiso: así la puerta y el enlace no pueden
 * dejar de coincidir.
 */
export async function exigirMetricas(): Promise<Perfil> {
  const perfil = await exigirSesion();
  if (!ROLES[perfil.rol].verMetricas) {
    redirect(RUTA_PEDIDOS);
  }
  return perfil;
}
