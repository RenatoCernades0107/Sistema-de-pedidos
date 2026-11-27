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
  type ParteLlm,
  type PeticionChat,
  type PerfilLlm,
} from "@/lib/llm/inferhub";
import type { AjustesAgente } from "./ajustes";
import { ejecutarHerramienta, HERRAMIENTAS_AGENTE, type ContextoHerramientas } from "./herramientas";
import { promptDelSistema } from "./sistema";
import type { AdjuntoCliente, Anuncio, MensajeAgente, PasoTraza, RespuestaAgente, TurnoHistorial } from "./tipos";

/** Cuántas veces puede pedir herramientas antes de tener que contestar. */
export const MAX_VUELTAS = 6;

/** Cuántos turnos de la conversación se le pasan: los de antes ya no cambian la respuesta. */
export const MAX_TURNOS_HISTORIAL = 30;

/** Lo que antecede a un mensaje de un asesor humano en el historial del modelo. */
export const PREFIJO_ASESOR = "[Asesor humano]: ";

/**
 * La conversación en el formato del modelo.
 *   · Cliente → usuario, con sus adjuntos: los que `partesDe` trae enteros (los
 *     más recientes) van como imagen o PDF; los demás, solo nombrados.
 *   · Agente  → asistente; los archivos que envió se dicen en texto.
 *   · Asesor  → asistente, marcado con `PREFIJO_ASESOR` para que el modelo sepa
 *     que lo escribió una persona del equipo.
 */
export function mensajesDeHistorial(
  historial: TurnoHistorial[],
  partesDe: (adjunto: AdjuntoCliente) => ParteLlm[] | undefined = () => undefined,
): MensajeLlm[] {
  return historial.slice(-MAX_TURNOS_HISTORIAL).flatMap((t): MensajeLlm[] => {
    if (t.rol === "cliente") {
      const adjuntos = t.adjuntosCliente ?? [];
      if (adjuntos.length === 0) return t.contenido.trim() ? [{ rol: "usuario", contenido: t.contenido }] : [];
      const partes: ParteLlm[] = t.contenido.trim() ? [{ tipo: "texto", texto: t.contenido }] : [];
      for (const a of adjuntos) {
        partes.push(...(partesDe(a) ?? [{ tipo: "texto" as const, texto: `[Adjuntó: ${a.nombre}]` }]));
      }
      return [{ rol: "usuario", contenido: partes }];
    }
    if (t.rol === "asesor") {
      return t.contenido.trim() ? [{ rol: "asistente", contenido: `${PREFIJO_ASESOR}${t.contenido}` }] : [];
    }
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
  /** Las partes (imagen o PDF) de los adjuntos del cliente que van enteros al modelo. */
  partesDe?: (adjunto: AdjuntoCliente) => ParteLlm[] | undefined;
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
  const mensajes = mensajesDeHistorial(entrada.historial, entrada.partesDe);
  const traza: PasoTraza[] = [];
  const archivos: MensajeAgente[] = [];

  for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
    const { texto, llamadas, bloques, razonamiento } = await unaVuelta(transmitir, {
      sistema,
      mensajes,
      herramientas: HERRAMIENTAS_AGENTE,
      senal: entrada.senal,
      perfil: entrada.perfil,
    });

    if (llamadas.length === 0) {
      // No dijo nada: mejor que lo vea una persona. (Si hubiera derivado, ya salió abajo.)
      if (!texto && archivos.length === 0) {
        return { mensajes: [], traza, derivado: true, motivoDerivacion: "el agente no respondió nada" };
      }
      return {
        mensajes: [...(texto ? [{ tipo: "texto" as const, texto }] : []), ...archivos],
        traza,
        derivado: false,
      };
    }

    mensajes.push({
      rol: "asistente",
      contenido: texto,
      llamadas,
      ...(bloques.length ? { razonamiento: { texto: razonamiento, bloques } } : {}),
    });
    let derivacion: { motivo: string } | null = null;
    for (const llamada of llamadas) {
      const r = await ejecutarHerramienta(llamada.nombre, llamada.argumentos, entrada.contexto);
      traza.push(r.paso);
      if (r.adjunto && !archivos.some((a) => a.tipo === "archivo" && a.adjunto.documentoId === r.adjunto!.adjunto.documentoId)) {
        archivos.push({ tipo: "archivo", adjunto: r.adjunto.adjunto, texto: r.adjunto.texto });
      }
      if (r.derivar) derivacion ??= r.derivar;
      mensajes.push({ rol: "herramienta", idLlamada: llamada.id, contenido: r.contenido });
    }
    // Si derivó, no hace falta otra vuelta: lo que escribiera después no se enviaría.
    if (derivacion) return { mensajes: [], traza, derivado: true, motivoDerivacion: derivacion.motivo };
  }

  // Se pasó de vueltas sin contestar: mejor un asesor que una respuesta a medias.
  traza.push({ herramienta: "motor", argumentos: {}, resumen: `Sin respuesta tras ${MAX_VUELTAS} vueltas`, error: true });
  return { mensajes: [], traza, derivado: true, motivoDerivacion: "el agente no llegó a una respuesta" };
}
