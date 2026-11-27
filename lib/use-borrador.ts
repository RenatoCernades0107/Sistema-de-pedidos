"use client";

import { useEffect, useRef, useState } from "react";
import { eliminarBorrador, guardarBorrador } from "@/app/(app)/borradores/acciones";
import type { DatosBorrador, ResumenBorrador, TipoBorrador } from "@/lib/borradores";
import { useAvisoSalida } from "@/lib/use-aviso-salida";

/** Cuánto se espera después de la última tecla para guardar. */
const ESPERA_MS = 1500;

export type EstadoBorrador = "sin-guardar" | "guardando" | "guardado" | "error";

/**
 * Guarda solo el formulario como borrador mientras se llena.
 *
 * - Un rato después de cada cambio (y si `conContenido`), lo manda al servidor.
 * - El primer guardado deja `?borrador=<id>` en la URL: recargar retoma ese.
 * - Al salir por la app (el componente se desmonta) guarda lo pendiente ya.
 * - Mientras hay algo sin guardar, cerrar la pestaña pide confirmación.
 *
 * `activo = false` (ya se creó/registró) lo apaga: no se guarda nada más.
 */
export function useBorrador({
  tipo,
  idInicial,
  cotizacionId = null,
  datos,
  resumen,
  conContenido,
  activo,
}: {
  tipo: TipoBorrador;
  idInicial: string | null;
  cotizacionId?: string | null;
  datos: DatosBorrador;
  resumen: ResumenBorrador;
  conContenido: boolean;
  activo: boolean;
}) {
  const [estado, setEstado] = useState<EstadoBorrador>(idInicial ? "guardado" : "sin-guardar");
  const id = useRef<string | null>(idInicial);
  const json = JSON.stringify(datos);
  /** Lo último que quedó guardado (o con lo que se abrió el borrador). */
  const [guardadoJson, setGuardadoJson] = useState<string | null>(idInicial ? json : null);
  /** Lo mismo, para leerlo dentro de un guardado en curso. */
  const guardado = useRef(guardadoJson);
  /** Lo que falta guardar: lo pide el desmontaje si el temporizador no llegó. */
  const pendiente = useRef<(() => Promise<void>) | null>(null);
  const enVuelo = useRef<Promise<void> | null>(null);
  /** Ya se creó/registró o se descartó: nada más se guarda. */
  const apagado = useRef(false);

  const hayCambios = activo && conContenido && json !== guardadoJson;

  useEffect(() => {
    if (!hayCambios) {
      pendiente.current = null;
      return;
    }
    const enviar = async () => {
      pendiente.current = null;
      // De a uno: si hay otro en vuelo, este espera y sale con el id que dejó.
      if (enVuelo.current) await enVuelo.current;
      if (apagado.current || guardado.current === json) return;
      const tarea = (async () => {
        setEstado("guardando");
        try {
          const r = await guardarBorrador({ id: id.current, tipo, cotizacionId, datos, resumen });
          if (!r.ok) return setEstado("error");
          const nuevo = id.current !== r.id;
          id.current = r.id;
          guardado.current = json;
          setGuardadoJson(json);
          setEstado("guardado");
          if (nuevo) {
            const url = new URL(window.location.href);
            url.searchParams.set("borrador", r.id);
            window.history.replaceState(window.history.state, "", url);
          }
        } catch {
          setEstado("error");
        }
      })();
      enVuelo.current = tarea;
      await tarea;
      if (enVuelo.current === tarea) enVuelo.current = null;
    };
    pendiente.current = enviar;
    const t = setTimeout(() => void enviar(), ESPERA_MS);
    return () => clearTimeout(t);
    // `json` resume `datos`; `resumen` sale de lo mismo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [json, hayCambios]);

  // Al salir por la app: lo que quedó pendiente se guarda ya.
  useEffect(
    () => () => {
      void pendiente.current?.();
    },
    [],
  );

  useAvisoSalida(hayCambios || estado === "guardando");

  /**
   * Al crear el pedido o la cotización: deja de guardar, espera el guardado que
   * esté en vuelo (si no, podría volver a crearlo) y borra el borrador.
   */
  const terminar = async () => {
    apagado.current = true;
    pendiente.current = null;
    if (enVuelo.current) await enVuelo.current.catch(() => {});
    if (id.current) await eliminarBorrador(id.current).catch(() => {});
  };

  /** Guarda ya lo pendiente (botón "Guardar borrador"). `true` si lo de pantalla quedó guardado. */
  const guardarAhora = async (): Promise<boolean> => {
    if (apagado.current) return false;
    await pendiente.current?.();
    if (enVuelo.current) await enVuelo.current.catch(() => {});
    return guardado.current === json;
  };

  return {
    terminar,
    guardarAhora,
    estado: hayCambios && estado !== "guardando" ? ("sin-guardar" as const) : estado,
    /** El id del borrador, si ya se guardó alguna vez. */
    id: () => id.current,
  };
}
