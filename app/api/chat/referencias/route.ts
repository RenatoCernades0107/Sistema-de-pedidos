/**
 * El buscador del menú @ del chat.
 *
 *   GET ?tipo=pedido&q=P2611&contexto=[{tipo,id,etiqueta}]&nivel={material,…}
 *
 * Lo pueden usar los tres roles: cada búsqueda va con la sesión de quien
 * pregunta y lo que no puede ver no sale (ver `lib/chat/referencias-servidor.ts`).
 * Responde JSON siempre —también sin sesión, con 401—, porque lo pide un `fetch`
 * mientras se teclea y un `redirect` al login le devolvería HTML.
 */

import type { NextRequest } from "next/server";
import { z } from "zod";
import { esquemaNivel, NIVEL_RAIZ } from "@/lib/chat/referencias";
import { buscarReferencias } from "@/lib/chat/referencias-servidor";
import { esquemaContexto } from "@/lib/chat/tipos";
import { perfilActual } from "@/lib/sesion";
import { error, json } from "./comun";

const esquemaEntrada = z.object({
  tipo: z.enum(["cliente", "pedido", "plancha", "diseno", "usuario"]),
  // Nadie busca con 200 caracteres.
  q: z.string().transform((q) => q.slice(0, 120).trim()),
  contexto: json(z.array(esquemaContexto).max(4), []),
  nivel: json(esquemaNivel, NIVEL_RAIZ),
});

export async function GET(request: NextRequest) {
  const perfil = await perfilActual();
  if (!perfil || perfil.debeCambiarPassword) return error("Tu sesión expiró. Recarga la página.", 401);

  const p = request.nextUrl.searchParams;
  const entrada = esquemaEntrada.safeParse({
    tipo: p.get("tipo"),
    q: p.get("q") ?? "",
    contexto: p.get("contexto") ?? undefined,
    nivel: p.get("nivel") ?? undefined,
  });
  if (!entrada.success) return error("Búsqueda inválida.", 400);

  try {
    return Response.json(await buscarReferencias(perfil, entrada.data));
  } catch (e) {
    console.error("[chat] referencias", e);
    return error("La búsqueda falló. Intenta de nuevo.", 500);
  }
}
