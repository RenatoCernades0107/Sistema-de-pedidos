/**
 * Un mensaje del "cliente" en el área de pruebas y lo que pasa después:
 * `POST { pruebaId, texto, adjuntos? }` → `{ cliente, agente, estado }`.
 *
 *   · Si la conversación la atiende un humano (`necesita_atencion`, `asesor`), el
 *     mensaje se guarda y el agente no responde (`agente: null`).
 *   · Si estaba resuelta, se reabre con el agente.
 *   · Si el agente no puede responder, calla: se guarda la nota "pasó a un asesor"
 *     (con su traza) y la conversación queda en `necesita_atencion`.
 *
 * Los adjuntos (fotos y PDF) ya están en el bucket `agente_adjuntos`: los subió el
 * navegador. Aquí llega su lista y se le pasan al modelo los más recientes.
 *
 * Sin streaming, como en WhatsApp. El mensaje del cliente y la respuesta se guardan
 * juntos al final; si el modelo falla no se guarda nada y "Reintentar" no duplica.
 */

import { z } from "zod";
import { ErrorLlm, type ParteLlm } from "@/lib/llm/inferhub";
import { clienteServidor } from "@/lib/supabase-servidor";
import type { Json } from "@/lib/supabase-tipos";
import { deAdjuntos, esquemaAdjuntos, rutaDeDiseno, rutasAReenviar } from "@/lib/cad/adjuntos";
import { AdjuntoNoDisponible, partesDeAdjuntos } from "@/lib/cad/adjuntos-servidor";
import { AGENTE_NO_CONFIGURADO, agenteConfigurado, perfilDelAgente } from "@/lib/agente-whatsapp/config";
import { cargarAjustesAgente, contextoDelServidor, notaDePrecios } from "@/lib/agente-whatsapp/contexto-servidor";
import { agenteResponde, leerEstado, siguienteEstado, type EstadoConversacion } from "@/lib/agente-whatsapp/estado";
import { responderMensaje } from "@/lib/agente-whatsapp/motor";
import { leerAnuncio, leerAdjuntos, leerRol, mensajeDeFila, tituloDePrueba } from "@/lib/agente-whatsapp/pruebas";
import { conEnlaces } from "@/lib/agente-whatsapp/pruebas-servidor";
import { errorJson, puertaAgente } from "@/lib/agente-whatsapp/rutas";
import { BUCKET_ADJUNTOS_CLIENTE, type AdjuntoCliente, type TurnoHistorial } from "@/lib/agente-whatsapp/tipos";

export const maxDuration = 120;

/** Cuántos adjuntos del cliente van enteros al modelo en cada turno; los anteriores, solo nombrados. */
const ADJUNTOS_ENTEROS = 4;

const esquemaCuerpo = z
  .object({
    pruebaId: z.uuid(),
    texto: z.string().trim().max(4000, "El mensaje es demasiado largo"),
    adjuntos: esquemaAdjuntos.optional().default([]),
  })
  .refine((c) => c.texto || c.adjuntos.length > 0, "Escribe un mensaje o adjunta un archivo");

const COLUMNAS = "id, rol, contenido, adjuntos, traza, derivado, autor_id, creado_en";

type FilaNueva = {
  prueba_id: string;
  rol: "cliente" | "agente";
  contenido: string;
  adjuntos: Json | null;
  traza: Json | null;
  derivado: boolean;
  creado_en: string;
};

export async function POST(request: Request) {
  const puerta = await puertaAgente();
  if ("respuesta" in puerta) return puerta.respuesta;

  let crudo: unknown;
  try {
    crudo = await request.json();
  } catch {
    return errorJson("No se pudo leer el mensaje.", 400);
  }
  const cuerpo = esquemaCuerpo.safeParse(crudo);
  if (!cuerpo.success) return errorJson(cuerpo.error.issues[0]?.message ?? "El mensaje no es válido.", 400);
  const { pruebaId, texto, adjuntos } = cuerpo.data;
  // Los adjuntos tienen que estar en la carpeta de esta conversación.
  if (adjuntos.some((a) => !rutaDeDiseno(a.ruta, pruebaId))) return errorJson("Un adjunto no es de esta conversación.", 400);

  const supabase = await clienteServidor();
  const [{ data: prueba }, { data: anteriores, error: errorHistorial }] = await Promise.all([
    supabase.from("agente_pruebas").select("id, titulo, anuncio, estado, canal").eq("id", pruebaId).maybeSingle(),
    supabase
      .from("agente_pruebas_mensajes")
      .select("rol, contenido, adjuntos")
      .eq("prueba_id", pruebaId)
      .order("creado_en", { ascending: true }),
  ]);
  if (!prueba) return errorJson("La prueba ya no existe.", 404);
  if (prueba.canal !== "prueba") return errorJson("Es una conversación real de WhatsApp: se atiende en Conversaciones.", 400);
  if (errorHistorial) return errorJson("No se pudo leer la conversación.", 500);

  const estadoAntes = leerEstado(prueba.estado);
  let estado: EstadoConversacion = siguienteEstado(estadoAntes, "mensaje_cliente");
  const ahora = Date.now();
  const filaCliente: FilaNueva = {
    prueba_id: pruebaId,
    rol: "cliente",
    contenido: texto,
    adjuntos: adjuntos.length ? (adjuntos as unknown as Json) : null,
    traza: null,
    derivado: false,
    creado_en: new Date(ahora).toISOString(),
  };
  const filas: FilaNueva[] = [filaCliente];
  let motivo: string | undefined;

  if (agenteResponde(estado)) {
    if (!agenteConfigurado()) return errorJson(AGENTE_NO_CONFIGURADO, 503);

    const historial: TurnoHistorial[] = [
      ...(anteriores ?? []).map((m): TurnoHistorial => {
        const rol = leerRol(m.rol);
        return {
          rol,
          contenido: m.contenido,
          adjuntos: rol === "agente" ? leerAdjuntos(m.adjuntos) : undefined,
          adjuntosCliente: rol === "cliente" ? deAdjuntos(m.adjuntos) : undefined,
        };
      }),
      { rol: "cliente", contenido: texto, adjuntosCliente: adjuntos },
    ];

    let respuesta;
    try {
      const partes = await partesDeLosRecientes(historial);
      const [ajustes, nota] = await Promise.all([cargarAjustesAgente(), notaDePrecios()]);
      respuesta = await responderMensaje({
        historial,
        anuncio: leerAnuncio(prueba.anuncio),
        ajustes,
        contexto: contextoDelServidor(),
        perfil: perfilDelAgente(),
        notaPrecios: nota,
        partesDe: (a) => partes.get(a.ruta),
        senal: request.signal,
      });
    } catch (e) {
      if (request.signal.aborted) return errorJson("Cancelado.", 499);
      if (e instanceof AdjuntoNoDisponible) return errorJson(e.message, 400);
      const mensaje = e instanceof ErrorLlm ? e.message : "El agente no pudo responder. Intenta de nuevo.";
      console.error("[agente-whatsapp] responder", e);
      return errorJson(mensaje, 502);
    }

    const textos = respuesta.mensajes.flatMap((m) => (m.tipo === "texto" ? [m.texto] : []));
    const enviados = respuesta.mensajes.flatMap((m) => (m.tipo === "archivo" ? [{ ...m.adjunto, texto: m.texto }] : []));
    // Con o sin respuesta se guarda la fila del agente: lleva la traza. Si derivó,
    // va vacía y la pantalla la muestra como la nota "pasó a un asesor".
    filas.push({
      prueba_id: pruebaId,
      rol: "agente",
      contenido: textos.join("\n\n"),
      adjuntos: enviados.length ? (enviados as unknown as Json) : null,
      traza: respuesta.traza as unknown as Json,
      derivado: respuesta.derivado,
      // Un milisegundo después: el orden de la conversación sale de esta columna.
      creado_en: new Date(ahora + 1).toISOString(),
    });
    if (respuesta.derivado) {
      estado = siguienteEstado(estado, "agente_deriva");
      motivo = respuesta.motivoDerivacion;
    }
  }

  const { data: guardados, error } = await supabase.from("agente_pruebas_mensajes").insert(filas).select(COLUMNAS);
  if (error || !guardados) return errorJson("No se pudo guardar la conversación.", 500);

  await supabase
    .from("agente_pruebas")
    .update({
      actualizado_en: new Date().toISOString(),
      estado,
      ...(estado === "necesita_atencion" && estadoAntes !== "necesita_atencion"
        ? { motivo_atencion: (motivo ?? "").slice(0, 300) || null, atencion_desde: new Date().toISOString() }
        : {}),
      ...(estado === "agente" ? { motivo_atencion: null, atencion_desde: null } : {}),
      // La primera vez, la prueba toma el nombre del primer mensaje.
      ...((anteriores ?? []).length === 0
        ? { titulo: tituloDePrueba(texto || adjuntos.map((a) => a.nombre).join(", ")) }
        : {}),
    })
    .eq("id", pruebaId);

  const [cliente, agente = null] = await conEnlaces(
    guardados.map(mensajeDeFila).sort((a, b) => a.creadoEn.localeCompare(b.creadoEn)),
  );
  return Response.json({ cliente, agente, estado });
}

/** Las partes (imagen o PDF) de los adjuntos más recientes del cliente, por ruta. */
async function partesDeLosRecientes(historial: TurnoHistorial[]): Promise<Map<string, ParteLlm[]>> {
  const porMensaje = historial.map((t) => t.adjuntosCliente ?? []);
  const enteras = rutasAReenviar(porMensaje, ADJUNTOS_ENTEROS);
  const elegidos: AdjuntoCliente[] = porMensaje.flat().filter((a) => enteras.has(a.ruta));
  const ultimos = new Set((historial.at(-1)?.adjuntosCliente ?? []).map((a) => a.ruta));
  const salida = new Map<string, ParteLlm[]>();
  await Promise.all(
    elegidos.map(async (a) => {
      // Los del mensaje que se está enviando tienen que existir; los anteriores, si faltan, se nombran.
      salida.set(a.ruta, await partesDeAdjuntos([a], ultimos.has(a.ruta), BUCKET_ADJUNTOS_CLIENTE));
    }),
  );
  return salida;
}
