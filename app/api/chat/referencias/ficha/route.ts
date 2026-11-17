/**
 * La tarjeta de una ficha de cliente o de plancha del chat.
 *
 *   GET ?tipo=cliente&id=1234&etiqueta=Juan%20Pérez
 *
 * Se lee al tocar la ficha, con la sesión de quien mira: el mensaje guarda una
 * foto sin teléfono (la leen todos), y aquí sale el teléfono solo si su rol lo
 * ve, junto con los pedidos recientes o los formatos y sobrantes de la plancha.
 */

import type { NextRequest } from "next/server";
import { z } from "zod";
import { fichaDeReferencia } from "@/lib/chat/referencias-servidor";
import { bienvenidaPendiente, perfilActual } from "@/lib/sesion";
import { error } from "../comun";

const esquemaEntrada = z.object({
  tipo: z.enum(["cliente", "plancha"]),
  id: z.string().trim().min(1).max(120),
  etiqueta: z.string().trim().max(160).default(""),
});

export async function GET(request: NextRequest) {
  const perfil = await perfilActual();
  if (!perfil || bienvenidaPendiente(perfil)) return error("Tu sesión expiró. Recarga la página.", 401);

  const p = request.nextUrl.searchParams;
  const entrada = esquemaEntrada.safeParse({
    tipo: p.get("tipo"),
    id: p.get("id"),
    etiqueta: p.get("etiqueta") ?? undefined,
  });
  if (!entrada.success) return error("Ficha inválida.", 400);

  try {
    const { tipo, id, etiqueta } = entrada.data;
    const ficha = await fichaDeReferencia(perfil, tipo, id, etiqueta || id);
    return ficha ? Response.json(ficha) : error("Ya no existe.", 404);
  } catch (e) {
    console.error("[chat] ficha de referencia", e);
    return error("No se pudo cargar. Intenta de nuevo.", 500);
  }
}
