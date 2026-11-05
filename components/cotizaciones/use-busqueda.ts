"use client";

import { useEffect, useRef, useState } from "react";
import type { RespuestaBusqueda } from "@/lib/odoo/tipos";

/**
 * Buscar mientras se escribe, contra un route handler de `app/api/cotizaciones/buscar`.
 *
 * - Espera `demora` ms desde la última tecla antes de preguntar, y cancela la
 *   pregunta anterior si llega una nueva (`AbortController`): una respuesta vieja
 *   nunca pisa a una nueva.
 * - Mientras llega la respuesta, los resultados anteriores se quedan en pantalla:
 *   una lista que parpadea vacía a cada tecla cansa.
 * - Recuerda lo ya preguntado: borrar una letra vuelve al instante.
 * - `consultaRespondida` dice a qué consulta corresponden los resultados que hay;
 *   el formulario lo usa para no aceptar un Enter sobre resultados viejos.
 */
export function useBusqueda<T>(ruta: string, consulta: string, activo: boolean, demora = 150) {
  const [estado, setEstado] = useState<{
    consulta: string | null;
    respuesta: RespuestaBusqueda<T> | null;
    error: string | null;
  }>({ consulta: null, respuesta: null, error: null });
  const [cargando, setCargando] = useState(false);
  const memoria = useRef(new Map<string, RespuestaBusqueda<T>>());

  useEffect(() => {
    if (!activo) return;
    const q = consulta.trim();
    const ctrl = new AbortController();

    const enMemoria = memoria.current.get(q);
    const espera = enMemoria || !q ? 0 : demora;

    const temporizador = setTimeout(async () => {
      if (enMemoria) {
        setEstado({ consulta: q, respuesta: enMemoria, error: null });
        return;
      }
      setCargando(true);
      try {
        const res = await fetch(`${ruta}?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        const json = (await res.json()) as RespuestaBusqueda<T> & { error?: string };
        if (!res.ok) {
          setEstado({ consulta: q, respuesta: null, error: json.error ?? "No se pudo buscar." });
        } else {
          // Las sugerencias (consulta vacía) cambian con cada cotización: no se recuerdan.
          if (q) memoria.current.set(q, json);
          setEstado({ consulta: q, respuesta: json, error: null });
        }
      } catch {
        if (!ctrl.signal.aborted) {
          setEstado((previo) => ({ ...previo, consulta: q, error: "No se pudo buscar. Revisa la conexión." }));
        }
      } finally {
        if (!ctrl.signal.aborted) setCargando(false);
      }
    }, espera);

    return () => {
      clearTimeout(temporizador);
      ctrl.abort();
    };
  }, [ruta, consulta, activo, demora]);

  return {
    resultados: estado.respuesta?.resultados ?? [],
    origen: estado.respuesta?.origen ?? null,
    error: estado.error,
    cargando,
    consultaRespondida: estado.consulta,
    /** Olvida lo recordado: después de crear un cliente, por ejemplo. */
    olvidar: () => memoria.current.clear(),
  };
}

/** Una pregunta suelta, sin esperar ni recordar: la del Enter rápido. */
export async function buscarUnaVez<T>(url: string): Promise<RespuestaBusqueda<T> | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as RespuestaBusqueda<T>;
  } catch {
    return null;
  }
}
