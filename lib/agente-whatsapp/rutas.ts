import { bienvenidaPendiente, perfilActual, perfilConAgenteWhatsapp, type Perfil } from "@/lib/sesion";

export const errorJson = (mensaje: string, status: number) => Response.json({ error: mensaje }, { status });

/** La puerta de los route handlers del agente: el perfil, o la respuesta 401/403 que toca. */
export async function puertaAgente(): Promise<{ perfil: Perfil } | { respuesta: Response }> {
  const perfil = await perfilConAgenteWhatsapp();
  if (perfil) return { perfil };
  const actual = await perfilActual();
  return {
    respuesta:
      actual && !bienvenidaPendiente(actual)
        ? errorJson("Tu rol no puede usar el agente de WhatsApp.", 403)
        : errorJson("Tu sesión caducó. Recarga la página.", 401),
  };
}
