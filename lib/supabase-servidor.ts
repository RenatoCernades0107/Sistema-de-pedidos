import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "./supabase-tipos";

/**
 * Cliente de Supabase para Server Components, Server Actions y Route Handlers.
 *
 * Se crea uno por petición y nunca se comparte: la sesión vive en las cookies de
 * quien pidió la página, y reutilizar el cliente serviría la sesión de una
 * persona a otra.
 */
export async function clienteServidor() {
  const galleta = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => galleta.getAll(),
        setAll: (nuevas) => {
          try {
            nuevas.forEach(({ name, value, options }) => galleta.set(name, value, options));
          } catch {
            // Un Server Component no puede escribir cookies. No es un problema:
            // el proxy ya refrescó la sesión antes de llegar hasta aquí.
          }
        },
      },
    },
  );
}
