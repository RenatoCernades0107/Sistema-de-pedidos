/**
 * Lo que `app/api/disenos/chat` le manda al navegador mientras el asistente
 * contesta, y cómo se lee.
 *
 * Es SSE (`data: {json}\n\n`), pero por `fetch` y no por `EventSource`: hace
 * falta un POST con cuerpo y poder cortarlo con "detener". Sin dependencias de
 * servidor ni de React: los tipos los comparte el route handler.
 */

import type { ParametrosCad } from "@/lib/cad/tipos";

export type EventoChat =
  /** Un trozo más del texto de la respuesta. */
  | { tipo: "texto"; delta: string }
  /** El asistente empezó o terminó de usar una herramienta. */
  | { tipo: "herramienta"; nombre: string; estado: "inicio" }
  | { tipo: "herramienta"; nombre: string; estado: "fin"; ok: boolean; resumen?: string }
  /** `generar_diseno` salió bien y ya está guardado: el visor tiene que mostrarlo. */
  | { tipo: "diseno"; plantilla: string; parametros: ParametrosCad }
  | { tipo: "error"; mensaje: string }
  | { tipo: "fin" };

const TIPOS: ReadonlySet<string> = new Set(["texto", "herramienta", "diseno", "error", "fin"]);

/** Un evento, como va por el cable. */
export const serializarEvento = (evento: EventoChat): string => `data: ${JSON.stringify(evento)}\n\n`;

function deLinea(linea: string): EventoChat | null {
  if (!linea.startsWith("data:")) return null;
  try {
    const leido: unknown = JSON.parse(linea.slice(5));
    if (leido && typeof leido === "object" && TIPOS.has((leido as { tipo?: string }).tipo ?? "")) {
      return leido as EventoChat;
    }
  } catch {
    // Una línea que no se entiende se salta: mejor perder un trozo que el turno.
  }
  return null;
}

/**
 * Los eventos de la respuesta, uno por uno. La red corta por donde quiere —a
 * media línea, a medio carácter—, así que se decodifica en modo `stream` y solo
 * se entregan líneas completas.
 */
export async function* leerEventos(cuerpo: ReadableStream<Uint8Array>): AsyncGenerator<EventoChat> {
  const lector = cuerpo.getReader();
  const decodificador = new TextDecoder();
  let pendiente = "";

  try {
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      pendiente += decodificador.decode(value, { stream: true });

      let salto: number;
      while ((salto = pendiente.indexOf("\n")) !== -1) {
        const evento = deLinea(pendiente.slice(0, salto).replace(/\r$/, ""));
        pendiente = pendiente.slice(salto + 1);
        if (evento) yield evento;
      }
    }
    const evento = deLinea((pendiente + decodificador.decode()).replace(/\r$/, ""));
    if (evento) yield evento;
  } finally {
    await lector.cancel().catch(() => {});
  }
}
