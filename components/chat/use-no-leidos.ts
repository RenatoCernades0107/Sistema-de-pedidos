"use client";

import { useResumen } from "./use-resumen";

/**
 * El globo de "Chat" en el menú: cuántos mensajes sin leer hay en todas las
 * conversaciones y si alguno menciona a quien mira. Sale del mismo resumen que
 * la lista de `/chat` (un solo canal de Realtime para los dos).
 */
export function useNoLeidos(): { total: number; menciones: number } {
  const { conversaciones } = useResumen();
  let total = 0;
  let menciones = 0;
  for (const c of conversaciones) {
    total += c.sinLeer;
    menciones += c.mencionesSinLeer;
  }
  return { total, menciones };
}
