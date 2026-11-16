"use client";

import { useEffect, useRef, useState } from "react";
import type { NivelReferencia, RespuestaReferencias } from "@/lib/chat/referencias";
import type { ContextoReferencia, TipoReferencia } from "@/lib/chat/tipos";

export const RUTA_REFERENCIAS = "/api/chat/referencias";

export interface PeticionReferencias {
  tipo: TipoReferencia;
  consulta: string;
  contexto: ContextoReferencia[];
  nivel: NivelReferencia;
}

/** La URL de una búsqueda. Sin `q` es la misma lista del nivel. */
export function urlReferencias({ tipo, consulta, contexto, nivel }: PeticionReferencias, conConsulta = true) {
  const p = new URLSearchParams({ tipo });
  if (conConsulta && consulta.trim()) p.set("q", consulta.trim().slice(0, 120));
  if (contexto.length) p.set("contexto", JSON.stringify(contexto));
  if (nivel.migas.length || Object.keys(nivel).length > 1) p.set("nivel", JSON.stringify(nivel));
  return `${RUTA_REFERENCIAS}?${p}`;
}

/**
 * Las opciones del menú @ mientras se escribe. Como `useBusqueda` de
 * cotizaciones: espera 150 ms desde la última tecla, cancela la pregunta vieja
 * si llega otra (una respuesta tardía nunca pisa a la nueva) y recuerda lo ya
 * preguntado en este campo, para que borrar una letra vuelva al instante.
 *
 * Mientras llega la respuesta se quedan los resultados de la misma lista (mismo
 * tipo, nivel y contexto): con otra lista se mostraría algo que no es.
 */
export function useOpcionesReferencia(peticion: PeticionReferencias | null, demora = 150) {
  const url = peticion ? urlReferencias(peticion) : null;
  const lista = peticion ? urlReferencias(peticion, false) : null;
  const [estado, setEstado] = useState<{
    url: string | null;
    lista: string | null;
    respuesta: RespuestaReferencias | null;
    error: string | null;
  }>({ url: null, lista: null, respuesta: null, error: null });
  const memoria = useRef(new Map<string, RespuestaReferencias>());

  useEffect(() => {
    if (!url) return;
    const ctrl = new AbortController();
    const enMemoria = memoria.current.get(url);

    const temporizador = setTimeout(
      async () => {
        if (enMemoria) {
          setEstado({ url, lista, respuesta: enMemoria, error: null });
          return;
        }
        try {
          const res = await fetch(url, { signal: ctrl.signal });
          const json = (await res.json()) as RespuestaReferencias & { error?: string };
          if (!res.ok) {
            setEstado({ url, lista, respuesta: null, error: json.error ?? "No se pudo buscar." });
          } else {
            memoria.current.set(url, json);
            setEstado({ url, lista, respuesta: json, error: null });
          }
        } catch {
          if (!ctrl.signal.aborted) {
            setEstado({ url, lista, respuesta: null, error: "No se pudo buscar. Revisa la conexión." });
          }
        }
      },
      enMemoria ? 0 : demora,
    );

    return () => {
      clearTimeout(temporizador);
      ctrl.abort();
    };
  }, [url, lista, demora]);

  const vigente = url !== null && estado.lista === lista;
  return {
    respuesta: vigente ? estado.respuesta : null,
    error: vigente && estado.url === url ? estado.error : null,
    cargando: url !== null && estado.url !== url,
  };
}
