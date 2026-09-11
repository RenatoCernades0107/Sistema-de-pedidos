/**
 * Los PDFs de una cotización: el de la cotización en sí y la hoja de corte.
 *
 * Es un route handler y no una Server Action porque previsualizar un PDF
 * necesita una URL —un `<iframe>` no recibe bytes— y porque así descargar es un
 * `<a download>` a secas, sin pasar los bytes por el estado de React.
 *
 * No recibe el `order_id` de Odoo ni el `X-User-Id`: el chat es el único
 * permiso que sabe comprobar la Quote Agent API, y el id de la persona sale de
 * la sesión del servidor (`exigirAgenteCotizacion`). La `APP_API_KEY` se queda
 * de este lado.
 */

import type { NextRequest } from "next/server";
import { exigirAgenteCotizacion } from "@/lib/sesion";
import { agentDocumento } from "@/lib/agente-cotizaciones";

/**
 * Lo que sabe servir. Los dos primeros son los PDFs que *salen* de la
 * cotización; `adjunto:<id>` es un archivo que *entró* — el plano o la lista
 * que mandó el colaborador — y por eso lleva el id del archivo pegado al
 * segmento: el chat solo, como en los otros dos, no bastaría para elegir cuál.
 */
const RUTA_POR_DOCUMENTO: Record<string, (chatId: string) => string> = {
  cotizacion: (chatId) => `/chats/${encodeURIComponent(chatId)}/quotation-pdf`,
  "hoja-corte": (chatId) => `/chats/${encodeURIComponent(chatId)}/cut-sheet`,
};

const PREFIJO_ADJUNTO = "adjunto:";

function rutaEnLaApi(documento: string, chatId: string): string | null {
  if (documento.startsWith(PREFIJO_ADJUNTO)) {
    const id = documento.slice(PREFIJO_ADJUNTO.length);
    if (!id) return null;
    return `/chats/${encodeURIComponent(chatId)}/attachments/${encodeURIComponent(id)}`;
  }
  return RUTA_POR_DOCUMENTO[documento]?.(chatId) ?? null;
}

export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/cotizaciones/[chatId]/[documento]">,
) {
  const perfil = await exigirAgenteCotizacion();
  const { chatId, documento } = await ctx.params;

  const ruta = rutaEnLaApi(decodeURIComponent(documento), chatId);
  if (!ruta) return new Response("No existe ese documento.", { status: 404 });

  const r = await agentDocumento(perfil.id, ruta);
  // El agente responde 409 cuando el chat todavía no creó la cotización o
  // cuando no hubo corte, y 404 cuando el id de adjunto no es de este chat: la
  // app no debería llegar a ninguno de los dos (solo enlaza lo que existe),
  // pero una URL pegada a mano sí.
  if (!r.ok) return new Response(r.error, { status: 409 });

  // `inline` para que el visor del navegador lo muestre; `attachment` solo
  // cuando se pidió la descarga explícitamente.
  const disposicion = request.nextUrl.searchParams.has("descargar") ? "attachment" : "inline";

  return new Response(r.data.contenido, {
    headers: {
      "Content-Type": r.data.tipoMime,
      "Content-Length": String(r.data.contenido.byteLength),
      "Content-Disposition": `${disposicion}; filename="${nombreAscii(r.data.nombre)}"; filename*=UTF-8''${encodeURIComponent(r.data.nombre)}`,
      // Lleva datos de un cliente: que no se quede en ninguna caché de paso.
      "Cache-Control": "private, no-store",
    },
  });
}

/**
 * El `filename` sin comillas ni acentos, para los navegadores que no leen el
 * `filename*`. Los nombres que manda la API ya son ASCII, pero el número de
 * cotización lo pone Odoo y no vale la pena fiarse.
 */
function nombreAscii(nombre: string): string {
  return nombre.replace(/[^\w.\-]/g, "_") || "documento.pdf";
}
