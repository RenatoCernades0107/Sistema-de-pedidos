"use server";

/**
 * Lo que hace quien atiende en /conversaciones (Administración o Ventas):
 * responder como asesor, devolver la conversación al agente o cerrarla.
 *
 * El estado lo decide `siguienteEstado` (lib/agente-whatsapp/estado.ts) y se
 * escribe con la sesión de quien atiende: la RLS (`atiende_conversaciones()`) manda.
 */

import { refresh } from "next/cache";
import { z } from "zod";
import { exigirConversaciones } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase-servidor";
import { mensajeDeError } from "@/lib/errores";
import { leerEstado, siguienteEstado, type EventoConversacion } from "@/lib/agente-whatsapp/estado";
import type { MensajePrueba, PruebaResumen } from "@/lib/agente-whatsapp/pruebas";
import { cargarConversacion, cargarMensajesDePrueba } from "@/lib/agente-whatsapp/pruebas-servidor";
import { clienteWhatsApp } from "@/lib/agente-whatsapp/canal";

type Resultado<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const fallo = (error: string) => ({ ok: false as const, error });

const id = z.uuid("La conversación no es válida");

/** Aplica un evento a la conversación y guarda quién lo hizo. */
async function cambiarEstado(conversacionId: string, evento: EventoConversacion, usuarioId: string): Promise<Resultado> {
  const supabase = await clienteServidor();
  const { data: actual } = await supabase.from("agente_pruebas").select("estado").eq("id", conversacionId).maybeSingle();
  if (!actual) return fallo("La conversación ya no existe.");
  const estado = siguienteEstado(leerEstado(actual.estado), evento);
  const { error } = await supabase
    .from("agente_pruebas")
    .update({
      estado,
      atendida_por: usuarioId,
      actualizado_en: new Date().toISOString(),
      // Ya no espera a nadie: deja de contar el tiempo de espera.
      ...(estado !== "necesita_atencion" ? { motivo_atencion: null, atencion_desde: null } : {}),
    })
    .eq("id", conversacionId);
  if (error) return fallo(mensajeDeError(error));
  return { ok: true };
}

const esquemaRespuesta = z.object({
  id,
  texto: z.string().trim().min(1, "Escribe la respuesta").max(4000, "La respuesta es demasiado larga"),
});

/** Lo que dice WhatsApp cuando no deja escribir, en palabras de la pantalla. */
function errorDeWhatsapp(e: unknown): string {
  const texto = e instanceof Error ? e.message : String(e);
  // 131047: pasaron más de 24 h desde el último mensaje del cliente.
  if (/131047|re-?engagement|24 ?h/i.test(texto)) {
    return "Pasaron más de 24 horas desde el último mensaje del cliente: WhatsApp solo deja escribirle con una plantilla aprobada.";
  }
  return `WhatsApp no aceptó el mensaje: ${texto.slice(0, 200)}`;
}

/**
 * Responde como asesor. En una conversación de WhatsApp, el mensaje sale de
 * verdad al cliente (por Kapso) antes de guardarse. La conversación queda "con un
 * asesor": el agente no vuelve a responder hasta que alguien la devuelva.
 */
export async function responderComoAsesor(entrada: unknown): Promise<Resultado<{ mensaje: MensajePrueba }>> {
  const perfil = await exigirConversaciones();
  const datos = esquemaRespuesta.safeParse(entrada);
  if (!datos.success) return fallo(datos.error.issues[0]?.message ?? "Los datos no son válidos.");

  const supabase = await clienteServidor();
  const { data: conversacion } = await supabase
    .from("agente_pruebas")
    .select("canal, telefono, phone_number_id")
    .eq("id", datos.data.id)
    .maybeSingle();
  if (!conversacion) return fallo("La conversación ya no existe.");

  let wamid: string | null = null;
  if (conversacion.canal === "whatsapp") {
    const whatsapp = clienteWhatsApp();
    if (!whatsapp) return fallo("Falta la clave de Kapso (KAPSO_API_KEY): no se puede escribir por WhatsApp.");
    if (!conversacion.telefono || !conversacion.phone_number_id) return fallo("La conversación no tiene número.");
    try {
      const enviado = await whatsapp.messages.sendText({
        phoneNumberId: conversacion.phone_number_id,
        to: conversacion.telefono,
        body: datos.data.texto,
      });
      wamid = enviado.messages?.[0]?.id ?? null;
    } catch (e) {
      return fallo(errorDeWhatsapp(e));
    }
  }

  const { data, error } = await supabase
    .from("agente_pruebas_mensajes")
    .insert({
      prueba_id: datos.data.id,
      rol: "asesor",
      contenido: datos.data.texto,
      adjuntos: null,
      traza: null,
      derivado: false,
      wamid,
    })
    .select("id, rol, contenido, adjuntos, traza, derivado, autor_id, creado_en")
    .single();
  if (error || !data) return fallo(mensajeDeError(error));

  const r = await cambiarEstado(datos.data.id, "asesor_responde", perfil.id);
  if (!r.ok) return r;
  refresh();
  return {
    ok: true,
    mensaje: {
      id: data.id,
      rol: "asesor",
      contenido: data.contenido,
      adjuntos: [],
      adjuntosCliente: [],
      traza: [],
      derivado: false,
      autorId: data.autor_id,
      autorNombre: perfil.nombre,
      creadoEn: data.creado_en,
    },
  };
}

/** El agente vuelve a responder en esa conversación. */
export async function devolverAlAgente(conversacionId: unknown): Promise<Resultado> {
  const perfil = await exigirConversaciones();
  const r = id.safeParse(conversacionId);
  if (!r.success) return fallo("La conversación no es válida.");
  const hecho = await cambiarEstado(r.data, "devolver_al_agente", perfil.id);
  if (hecho.ok) refresh();
  return hecho;
}

/** Cierra la conversación. Si el cliente vuelve a escribir, la retoma el agente. */
export async function marcarResuelta(conversacionId: unknown): Promise<Resultado> {
  const perfil = await exigirConversaciones();
  const r = id.safeParse(conversacionId);
  if (!r.success) return fallo("La conversación no es válida.");
  const hecho = await cambiarEstado(r.data, "resolver", perfil.id);
  if (hecho.ok) refresh();
  return hecho;
}

/** Una conversación con sus mensajes, para abrirla. */
export async function leerConversacion(
  conversacionId: unknown,
): Promise<Resultado<{ conversacion: PruebaResumen; mensajes: MensajePrueba[] }>> {
  await exigirConversaciones();
  const r = id.safeParse(conversacionId);
  if (!r.success) return fallo("La conversación no es válida.");
  try {
    const [conversacion, mensajes] = await Promise.all([cargarConversacion(r.data), cargarMensajesDePrueba(r.data)]);
    if (!conversacion) return fallo("La conversación ya no existe.");
    return { ok: true, conversacion, mensajes };
  } catch (e) {
    return fallo(e instanceof Error ? e.message : "No se pudo abrir la conversación.");
  }
}
