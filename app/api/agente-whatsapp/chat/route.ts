/**
 * Un mensaje del "cliente" en el área de pruebas y la respuesta del agente:
 * `POST { pruebaId, texto }` → `{ cliente, agente }` (los dos mensajes guardados).
 *
 * Sin streaming, como en WhatsApp: el cliente recibe la respuesta entera. El
 * mensaje del cliente y la respuesta se guardan juntos al final; si el modelo
 * falla no se guarda nada y "Reintentar" no duplica el mensaje.
 */

import { z } from "zod";
import { ErrorLlm } from "@/lib/llm/inferhub";
import { clienteServidor } from "@/lib/supabase-servidor";
import type { Json } from "@/lib/supabase-tipos";
import { AGENTE_NO_CONFIGURADO, agenteConfigurado, perfilDelAgente } from "@/lib/agente-whatsapp/config";
import { cargarAjustesAgente, contextoDelServidor, notaDePrecios } from "@/lib/agente-whatsapp/contexto-servidor";
import { responderMensaje } from "@/lib/agente-whatsapp/motor";
import { leerAnuncio, leerAdjuntos, mensajeDeFila, tituloDePrueba } from "@/lib/agente-whatsapp/pruebas";
import { conEnlaces } from "@/lib/agente-whatsapp/pruebas-servidor";
import { errorJson, puertaAgente } from "@/lib/agente-whatsapp/rutas";
import type { TurnoHistorial } from "@/lib/agente-whatsapp/tipos";

export const maxDuration = 120;

const esquemaCuerpo = z.object({
  pruebaId: z.uuid(),
  texto: z.string().trim().min(1, "Escribe un mensaje").max(4000, "El mensaje es demasiado largo"),
});

export async function POST(request: Request) {
  const puerta = await puertaAgente();
  if ("respuesta" in puerta) return puerta.respuesta;
  if (!agenteConfigurado()) return errorJson(AGENTE_NO_CONFIGURADO, 503);

  let crudo: unknown;
  try {
    crudo = await request.json();
  } catch {
    return errorJson("No se pudo leer el mensaje.", 400);
  }
  const cuerpo = esquemaCuerpo.safeParse(crudo);
  if (!cuerpo.success) return errorJson(cuerpo.error.issues[0]?.message ?? "El mensaje no es válido.", 400);
  const { pruebaId, texto } = cuerpo.data;

  const supabase = await clienteServidor();
  const [{ data: prueba }, { data: anteriores, error: errorHistorial }] = await Promise.all([
    supabase.from("agente_pruebas").select("id, titulo, anuncio").eq("id", pruebaId).maybeSingle(),
    supabase
      .from("agente_pruebas_mensajes")
      .select("rol, contenido, adjuntos")
      .eq("prueba_id", pruebaId)
      .order("creado_en", { ascending: true }),
  ]);
  if (!prueba) return errorJson("La prueba ya no existe.", 404);
  if (errorHistorial) return errorJson("No se pudo leer la conversación.", 500);

  const historial: TurnoHistorial[] = [
    ...(anteriores ?? []).map(
      (m): TurnoHistorial => ({
        rol: m.rol === "agente" ? "agente" : "cliente",
        contenido: m.contenido,
        adjuntos: leerAdjuntos(m.adjuntos),
      }),
    ),
    { rol: "cliente", contenido: texto },
  ];

  let respuesta;
  try {
    const [ajustes, nota] = await Promise.all([cargarAjustesAgente(), notaDePrecios()]);
    respuesta = await responderMensaje({
      historial,
      anuncio: leerAnuncio(prueba.anuncio),
      ajustes,
      contexto: contextoDelServidor(),
      perfil: perfilDelAgente(),
      notaPrecios: nota,
      senal: request.signal,
    });
  } catch (e) {
    if (request.signal.aborted) return errorJson("Cancelado.", 499);
    const mensaje = e instanceof ErrorLlm ? e.message : "El agente no pudo responder. Intenta de nuevo.";
    console.error("[agente-whatsapp] responder", e);
    return errorJson(mensaje, 502);
  }

  const textos = respuesta.mensajes.flatMap((m) => (m.tipo === "texto" ? [m.texto] : []));
  const adjuntos = respuesta.mensajes.flatMap((m) => (m.tipo === "archivo" ? [{ ...m.adjunto, texto: m.texto }] : []));
  const ahora = Date.now();
  const { data: guardados, error } = await supabase
    .from("agente_pruebas_mensajes")
    .insert([
      { prueba_id: pruebaId, rol: "cliente", contenido: texto, creado_en: new Date(ahora).toISOString() },
      {
        prueba_id: pruebaId,
        rol: "agente",
        contenido: textos.join("\n\n"),
        adjuntos: adjuntos as unknown as Json,
        traza: respuesta.traza as unknown as Json,
        derivado: respuesta.derivado,
        // Un milisegundo después: el orden de la conversación sale de esta columna.
        creado_en: new Date(ahora + 1).toISOString(),
      },
    ])
    .select("id, rol, contenido, adjuntos, traza, derivado, creado_en");
  if (error || !guardados) return errorJson("El agente respondió, pero no se pudo guardar la conversación.", 500);

  await supabase
    .from("agente_pruebas")
    .update({
      actualizado_en: new Date().toISOString(),
      // La primera vez, la prueba toma el nombre del primer mensaje.
      ...((anteriores ?? []).length === 0 ? { titulo: tituloDePrueba(texto) } : {}),
    })
    .eq("id", pruebaId);

  const [cliente, agente] = await conEnlaces(
    guardados.map(mensajeDeFila).sort((a, b) => a.creadoEn.localeCompare(b.creadoEn)),
  );
  return Response.json({ cliente, agente });
}
