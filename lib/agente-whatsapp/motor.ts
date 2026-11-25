/**
 * El agente de ventas: recibe la conversación y devuelve qué contestar.
 *
 * Es un bucle de herramientas sobre `transmitirChat` (como el chat de diseños,
 * pero sin streaming: por WhatsApp el cliente recibe el mensaje entero). No sabe
 * de canal ni de base: lo que consulta pasa por `ContextoHerramientas`, y lo que
 * devuelve son mensajes de texto y archivos en el orden en que se envían.
 */

import {
  transmitirChat,
  type BloqueRazonamiento,
  type EventoLlm,
  type LlamadaLlm,
  type MensajeLlm,
  type PeticionChat,
  type PerfilLlm,
} from "@/lib/llm/inferhub";
import type { AjustesAgente } from "./ajustes";
import { ejecutarHerramienta, HERRAMIENTAS_AGENTE, type ContextoHerramientas } from "./herramientas";
import { promptDelSistema } from "./sistema";
import type { Anuncio, MensajeAgente, PasoTraza, RespuestaAgente, TurnoHistorial } from "./tipos";

/** Cuántas veces puede pedir herramientas antes de tener que contestar. */
export const MAX_VUELTAS = 6;

/** Cuántos turnos de la conversación se le pasan: los de antes ya no cambian la respuesta. */
export const MAX_TURNOS_HISTORIAL = 30;

const RESPUESTA_DE_RESCATE =
  "Disculpa, se me complicó responder eso ahora. Te paso con un asesor para que te ayude 🙌";

/** La conversación en el formato del modelo. Los archivos que se enviaron se dicen en texto. */
export function mensajesDeHistorial(historial: TurnoHistorial[]): MensajeLlm[] {
  return historial.slice(-MAX_TURNOS_HISTORIAL).flatMap((t): MensajeLlm[] => {
    if (t.rol === "cliente") return t.contenido.trim() ? [{ rol: "usuario", contenido: t.contenido }] : [];
    const enviados = t.adjuntos?.length ? `\n[Enviaste: ${t.adjuntos.map((a) => a.nombre).join(", ")}]` : "";
    const contenido = `${t.contenido}${enviados}`.trim();
    return contenido ? [{ rol: "asistente", contenido }] : [];
  });
}

export interface EntradaMotor {
  historial: TurnoHistorial[];
  anuncio?: Anuncio | null;
  ajustes: AjustesAgente;
  contexto: ContextoHerramientas;
  perfil: PerfilLlm;
  notaPrecios?: string;
  senal?: AbortSignal;
  /** Para las pruebas: por defecto, el modelo de verdad. */
  transmitir?: (p: PeticionChat) => AsyncIterable<EventoLlm>;
}

/** Lo que dijo el modelo en una vuelta. */
async function unaVuelta(
  transmitir: (p: PeticionChat) => AsyncIterable<EventoLlm>,
  peticion: PeticionChat,
): Promise<{ texto: string; llamadas: LlamadaLlm[]; bloques: BloqueRazonamiento[]; razonamiento: string }> {
  let texto = "";
  let razonamiento = "";
  let bloques: BloqueRazonamiento[] = [];
  const llamadas: LlamadaLlm[] = [];
  for await (const e of transmitir(peticion)) {
    if (e.tipo === "texto") texto += e.delta;
    else if (e.tipo === "razonamiento") razonamiento += e.delta;
    else if (e.tipo === "bloques_razonamiento") bloques = e.bloques;
    else if (e.tipo === "llamada_herramienta") {
      llamadas.push({
        id: e.id,
        nombre: e.nombre,
        argumentos: e.argumentosInvalidos ? { _invalido: e.argumentosInvalidos } : e.argumentos,
      });
    }
  }
  return { texto: texto.trim(), llamadas, bloques, razonamiento };
}

/**
 * La respuesta del agente al último mensaje del cliente (el último del
 * historial). Lanza `ErrorLlm` si el modelo no responde: quien llama decide si
 * mostrar el error (pruebas) o derivar (WhatsApp).
 */
export async function responderMensaje(entrada: EntradaMotor): Promise<RespuestaAgente> {
  const transmitir = entrada.transmitir ?? transmitirChat;
  const sistema = promptDelSistema({
    ajustes: entrada.ajustes,
    anuncio: entrada.anuncio,
    notaPrecios: entrada.notaPrecios,
  });
  const mensajes = mensajesDeHistorial(entrada.historial);
  const traza: PasoTraza[] = [];
  const archivos: MensajeAgente[] = [];
  let derivacion: { motivo: string } | null = null;

  for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
    const { texto, llamadas, bloques, razonamiento } = await unaVuelta(transmitir, {
      sistema,
      mensajes,
      herramientas: HERRAMIENTAS_AGENTE,
      senal: entrada.senal,
      perfil: entrada.perfil,
    });

    if (llamadas.length === 0) {
      const mensajesTexto: MensajeAgente[] = texto ? [{ tipo: "texto", texto }] : [];
      if (mensajesTexto.length === 0 && archivos.length === 0) {
        mensajesTexto.push({ tipo: "texto", texto: derivacion ? entrada.ajustes.mensajeDerivacion : RESPUESTA_DE_RESCATE });
      }
      return {
        mensajes: [...mensajesTexto, ...archivos],
        traza,
        derivado: derivacion !== null,
        motivoDerivacion: derivacion?.motivo,
      };
    }

    mensajes.push({
      rol: "asistente",
      contenido: texto,
      llamadas,
      ...(bloques.length ? { razonamiento: { texto: razonamiento, bloques } } : {}),
    });
    for (const llamada of llamadas) {
      const r = await ejecutarHerramienta(llamada.nombre, llamada.argumentos, entrada.contexto, {
        mensajeDerivacion: entrada.ajustes.mensajeDerivacion,
      });
      traza.push(r.paso);
      if (r.adjunto && !archivos.some((a) => a.tipo === "archivo" && a.adjunto.documentoId === r.adjunto!.adjunto.documentoId)) {
        archivos.push({ tipo: "archivo", adjunto: r.adjunto.adjunto, texto: r.adjunto.texto });
      }
      if (r.derivar) derivacion = r.derivar;
      mensajes.push({ rol: "herramienta", idLlamada: llamada.id, contenido: r.contenido });
    }
  }

  // Se pasó de vueltas sin contestar: mejor un asesor que un silencio.
  traza.push({ herramienta: "motor", argumentos: {}, resumen: `Sin respuesta tras ${MAX_VUELTAS} vueltas`, error: true });
  return {
    mensajes: [{ tipo: "texto", texto: entrada.ajustes.mensajeDerivacion }, ...archivos],
    traza,
    derivado: true,
    motivoDerivacion: derivacion?.motivo ?? "el agente no llegó a una respuesta",
  };
}
