/**
 * Lo que se lee para los enlaces públicos: la cotización por su token (para el
 * PDF) y el pedido por el suyo (para el seguimiento). Sin sesión: las dos RPC
 * están abiertas a `anon` y devuelven solo lo que se le enseña al cliente.
 */

import { cache } from "react";
import { clienteServidor } from "./supabase-servidor";
import { deFila, type Fila } from "./cotizaciones-servidor";
import { leerSeguimiento, type Seguimiento } from "./seguimiento";
import type { Cotizacion } from "./cotizaciones";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** La cotización del enlace, o `null` si el token no es de ninguna. */
export async function cotizacionPorToken(token: string): Promise<Cotizacion | null> {
  // Un token mal formado haría fallar el cast a uuid de Postgres: es un 404.
  if (!UUID.test(token)) return null;
  const supabase = await clienteServidor();
  const { data, error } = await supabase.rpc("cotizacion_publica", { p_token: token });
  if (error) throw new Error(`No se pudo leer la cotización: ${error.message}`);
  if (!data || typeof data !== "object") return null;
  return deFila(data as unknown as Fila);
}

/** El pedido del enlace, o `null` si el token no es de ninguno. Una vez por petición. */
export const seguimientoPorToken = cache(async (token: string): Promise<Seguimiento | null> => {
  if (!UUID.test(token)) return null;
  const supabase = await clienteServidor();
  const { data, error } = await supabase.rpc("seguimiento_pedido", { p_token: token });
  if (error) throw new Error(`No se pudo leer el pedido: ${error.message}`);
  return leerSeguimiento(data);
});

/**
 * El token de seguimiento de un pedido, para quien lo comparte. `null` si el rol
 * no coordina con clientes (la RPC no se lo da) o si falla: el botón no sale.
 */
export async function tokenSeguimiento(codigo: string): Promise<string | null> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase.rpc("token_seguimiento", { p_codigo: codigo });
  if (error) {
    console.error("[seguimiento] token", error.message);
    return null;
  }
  return data ?? null;
}
