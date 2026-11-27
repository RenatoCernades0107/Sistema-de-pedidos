/**
 * Un archivo que llegó por WhatsApp (foto, PDF, nota de voz), para verlo en
 * /conversaciones. Vive en Kapso y se baja con su clave, que no sale del servidor.
 * Solo para quien atiende conversaciones: el mensaje se lee con su sesión (RLS).
 */

import { z } from "zod";
import { bienvenidaPendiente, perfilActual, perfilConConversaciones } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase-servidor";
import { leerAdjuntosWhatsapp } from "@/lib/agente-whatsapp/webhook";

/** Solo se pide a Kapso: nunca a una URL cualquiera guardada en un mensaje. */
const ORIGEN_KAPSO = /^https:\/\/([a-z0-9-]+\.)*kapso\.ai\//i;

export async function GET(_request: Request, ctx: RouteContext<"/api/whatsapp/media/[mensajeId]/[indice]">) {
  const perfil = await perfilConConversaciones();
  if (!perfil) {
    const actual = await perfilActual();
    return Response.json(
      { error: actual && !bienvenidaPendiente(actual) ? "Tu rol no atiende conversaciones." : "Tu sesión caducó." },
      { status: actual ? 403 : 401 },
    );
  }

  const { mensajeId, indice } = await ctx.params;
  const i = Number(indice);
  if (!z.uuid().safeParse(mensajeId).success || !Number.isInteger(i) || i < 0) {
    return Response.json({ error: "Archivo no válido." }, { status: 400 });
  }

  const supabase = await clienteServidor();
  const { data } = await supabase.from("agente_pruebas_mensajes").select("adjuntos").eq("id", mensajeId).maybeSingle();
  const adjunto = leerAdjuntosWhatsapp(data?.adjuntos)[i];
  if (!adjunto || !ORIGEN_KAPSO.test(adjunto.url)) return Response.json({ error: "No existe." }, { status: 404 });

  const respuesta = await fetch(adjunto.url, {
    headers: { "X-API-Key": process.env.KAPSO_API_KEY?.trim() ?? "" },
    cache: "no-store",
  });
  if (!respuesta.ok || !respuesta.body) return Response.json({ error: "Kapso no lo entregó." }, { status: 502 });
  return new Response(respuesta.body, {
    headers: {
      "Content-Type": adjunto.mime,
      "Content-Disposition": `inline; filename="${encodeURIComponent(adjunto.nombre)}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
