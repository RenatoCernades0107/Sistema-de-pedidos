"use client";

/**
 * La lista de conversaciones de quien tiene la sesión (`resumen_conversaciones()`),
 * compartida por toda la app.
 *
 * La leen dos sitios a la vez —el globo de "Chat" en el menú y la lista de
 * `/chat`— y no tiene sentido que cada uno abra su canal de Realtime y repita la
 * consulta. Es un almacén único: el primer componente que lo usa lo enciende
 * (lee, se suscribe a los mensajes nuevos y a la vuelta de la pestaña) y el
 * último que se va lo apaga.
 *
 * Realtime avisa de cada mensaje que la RLS deja ver; no se aplica el cambio a
 * mano sino que se relee el resumen con un pequeño retraso: así una ráfaga de
 * mensajes es una sola consulta, y los contadores salen siempre de la base.
 */

import { useSyncExternalStore } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { clienteNavegador } from "@/lib/supabase-cliente";
import { aResumen, type FilaResumen, type ResumenConversacion } from "@/lib/chat/tipos";

const RETRASO_MS = 600;
/** Sin canal en vivo, cada cuánto se relee mientras la pestaña se ve. */
const RELECTURA_MS = 30_000;

interface EstadoResumen {
  conversaciones: ResumenConversacion[];
  /** Todavía no llegó la primera lectura. */
  cargando: boolean;
  error: boolean;
}

let estado: EstadoResumen = { conversaciones: [], cargando: true, error: false };
const oyentes = new Set<() => void>();
let apagar: (() => void) | null = null;
let temporizador: ReturnType<typeof setTimeout> | null = null;
let enCurso: Promise<void> | null = null;
let otraVez = false;

function emitir(nuevo: Partial<EstadoResumen>) {
  estado = { ...estado, ...nuevo };
  oyentes.forEach((o) => o());
}

async function leer() {
  // Si ya hay una lectura en vuelo, se encadena otra al terminar: la que va
  // podría haber salido antes del cambio que pidió esta.
  if (enCurso) {
    otraVez = true;
    return enCurso;
  }
  enCurso = (async () => {
    const { data, error } = await clienteNavegador().rpc("resumen_conversaciones");
    if (error) emitir({ cargando: false, error: true });
    else emitir({ conversaciones: (data as FilaResumen[]).map(aResumen), cargando: false, error: false });
  })().finally(() => {
    enCurso = null;
    if (otraVez) {
      otraVez = false;
      void leer();
    }
  });
  return enCurso;
}

/** Vuelve a leer la lista. Sin espera: para después de una acción propia (leer, crear un canal). */
export function recargarResumen() {
  if (temporizador) clearTimeout(temporizador);
  temporizador = null;
  return leer();
}

/** Vuelve a leer con un pequeño retraso, juntando avisos seguidos. */
export function recargarResumenPronto() {
  if (temporizador) clearTimeout(temporizador);
  temporizador = setTimeout(() => {
    temporizador = null;
    void leer();
  }, RETRASO_MS);
}

function encender(): () => void {
  const supabase = clienteNavegador();
  let enVivo = false;
  void leer();

  const canal: RealtimeChannel = supabase
    .channel("chat-resumen")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "mensajes" }, () => recargarResumenPronto())
    .subscribe((s) => {
      enVivo = s === "SUBSCRIBED";
    });

  const alVolver = () => {
    if (document.visibilityState === "visible") recargarResumenPronto();
  };
  document.addEventListener("visibilitychange", alVolver);

  const intervalo = setInterval(() => {
    if (!enVivo && document.visibilityState === "visible") void leer();
  }, RELECTURA_MS);

  return () => {
    document.removeEventListener("visibilitychange", alVolver);
    clearInterval(intervalo);
    if (temporizador) clearTimeout(temporizador);
    temporizador = null;
    void supabase.removeChannel(canal);
  };
}

function suscribir(oyente: () => void) {
  oyentes.add(oyente);
  apagar ??= encender();
  return () => {
    oyentes.delete(oyente);
    if (oyentes.size === 0 && apagar) {
      apagar();
      apagar = null;
    }
  };
}

const INICIAL: EstadoResumen = { conversaciones: [], cargando: true, error: false };

export function useResumen(): EstadoResumen {
  return useSyncExternalStore(
    suscribir,
    () => estado,
    () => INICIAL,
  );
}
