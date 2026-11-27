/**
 * La clave que el servidor de Next le presenta a la base para que el webhook de
 * WhatsApp (que llega sin sesión) pueda leer y escribir lo del agente: las
 * funciones `wa_*` (migración 20261222000100) no hacen nada sin ella. Tiene que
 * coincidir con la fila `agente_whatsapp` de `secretos_app`.
 *
 * Es un secreto de servidor, como LOGIN_SECRET: nada de `NEXT_PUBLIC_`.
 */

/** El valor que `supabase/seed.sql` pone en local. En producción la fila lleva otro. */
export const CLAVE_AGENTE_DESARROLLO = "plexi-agente-dev-secreto";

export function claveDelAgente(): string | null {
  const clave = process.env.AGENTE_WA_SECRETO?.trim();
  if (clave) return clave;
  if (process.env.NODE_ENV !== "production") return CLAVE_AGENTE_DESARROLLO;
  return null;
}

export const AGENTE_SIN_SECRETO =
  "Falta AGENTE_WA_SECRETO: el webhook de WhatsApp no puede leer ni guardar nada.";
