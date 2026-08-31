"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./supabase-tipos";

/**
 * Cliente de Supabase para el navegador.
 *
 * La clave publicable viaja al cliente a propósito: lo que protege los datos es
 * la RLS de Postgres, no esconder la clave. Un operario con esta clave sigue sin
 * poder leer un monto.
 */
export function clienteNavegador() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
