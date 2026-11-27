/**
 * Quién atiende una conversación del agente de WhatsApp (`agente_pruebas.estado`)
 * y cómo cambia. Sin dependencias: lo usan la ruta del chat, las acciones de
 * /conversaciones y las pantallas.
 *
 *   agente ──(el agente no puede responder)──▶ necesita_atencion
 *   necesita_atencion / agente ──(responde un asesor)──▶ asesor
 *   cualquiera ──(devolver al agente)──▶ agente
 *   cualquiera ──(marcar resuelta)──▶ resuelta
 *   resuelta ──(el cliente vuelve a escribir)──▶ agente
 *
 * Mientras está en `necesita_atencion` o `asesor`, el agente no responde: los
 * mensajes del cliente se guardan y esperan al humano.
 */

export const ESTADOS_CONVERSACION = {
  necesita_atencion: "Necesita atención",
  agente: "Con el agente",
  asesor: "Con un asesor",
  resuelta: "Resuelta",
} as const;

export type EstadoConversacion = keyof typeof ESTADOS_CONVERSACION;

export const esEstadoConversacion = (v: unknown): v is EstadoConversacion =>
  typeof v === "string" && v in ESTADOS_CONVERSACION;

export type EventoConversacion =
  | "mensaje_cliente"
  | "agente_deriva"
  | "asesor_responde"
  | "devolver_al_agente"
  | "resolver";

export function siguienteEstado(estado: EstadoConversacion, evento: EventoConversacion): EstadoConversacion {
  switch (evento) {
    case "mensaje_cliente":
      // Una conversación cerrada se reabre con el agente; las demás siguen con quien estaban.
      return estado === "resuelta" ? "agente" : estado;
    case "agente_deriva":
      return "necesita_atencion";
    case "asesor_responde":
      return "asesor";
    case "devolver_al_agente":
      return "agente";
    case "resolver":
      return "resuelta";
  }
}

/** Si el agente contesta en ese estado. */
export const agenteResponde = (estado: EstadoConversacion) => estado === "agente";

/** El estado guardado, o `agente` si no se entiende. */
export const leerEstado = (v: unknown): EstadoConversacion => (esEstadoConversacion(v) ? v : "agente");
