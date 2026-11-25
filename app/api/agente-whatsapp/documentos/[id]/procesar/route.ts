/**
 * Procesa (o reindexa) un archivo de la base de conocimiento del agente:
 * `POST` → `{ fragmentos, modelo, aviso }` o `{ error }`.
 *
 * Va aparte de las Server Actions porque un catálogo de cientos de páginas
 * tarda: leer el PDF, transcribirlo si es escaneado, y pedir los vectores.
 */

import { z } from "zod";
import { procesarDocumento } from "@/lib/agente-whatsapp/conocimiento-servidor";
import { errorJson, puertaAgente } from "@/lib/agente-whatsapp/rutas";

export const maxDuration = 300;

export async function POST(_request: Request, ctx: RouteContext<"/api/agente-whatsapp/documentos/[id]/procesar">) {
  const puerta = await puertaAgente();
  if ("respuesta" in puerta) return puerta.respuesta;

  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return errorJson("El documento no es válido.", 400);

  const r = await procesarDocumento(id);
  if (!r.ok) return errorJson(r.error, 422);
  return Response.json({ fragmentos: r.fragmentos, modelo: r.modelo, aviso: r.aviso });
}
