"use client";

import { useEffect } from "react";

/**
 * Mientras `activo`, cerrar la pestaña, recargar o salir a otra web pide
 * confirmación: un pedido a medio cargar se pierde entero si no.
 *
 * Solo cubre la salida del navegador (`beforeunload`): la navegación interna de
 * Next no pasa por ahí, y para esa están los "Cancelar" a la vista.
 */
export function useAvisoSalida(activo: boolean) {
  useEffect(() => {
    if (!activo) return;
    const avisar = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Los navegadores que aún lo piden muestran su propio texto, no este.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [activo]);
}
