"use client";

import { useEffect, useRef } from "react";
import { guardarMiniaturaDiseno } from "@/app/(app)/disenos/miniaturas-acciones";
import { useDiseno } from "./diseno-contexto";

/** Lo que se espera a que el diseño se quede quieto antes de fotografiarlo. */
const ESPERA_MS = 2500;

/**
 * Saca la foto PNG de cada versión que se guarda (formulario, chat, material) y
 * la guarda con ella, para la lista de diseños. No pinta nada.
 *
 * Fotografía el modelo que ya está en pantalla (`resultado`), sin otra llamada
 * al motor, una vez que terminó de guardarse. La acción descarta la foto si
 * entretanto se guardó otra versión o si la vigente ya tenía una.
 */
export function MiniaturaDiseno({ vigenteConFoto }: { vigenteConFoto: boolean }) {
  const { disenoId, resultado, tinte, esperarGuardado } = useDiseno();
  // Al abrir un diseño se regenera su versión vigente: si ya tenía foto, no hace falta otra.
  const saltar = useRef(vigenteConFoto);

  useEffect(() => {
    if (!resultado) return;
    if (saltar.current) {
      saltar.current = false;
      return;
    }
    let vivo = true;
    const espera = setTimeout(async () => {
      try {
        await esperarGuardado();
        if (!vivo) return;
        const { renderizarMiniatura } = await import("@/lib/cad/miniatura");
        const png = await renderizarMiniatura(resultado.glb_base64, tinte);
        if (!vivo) return;
        const form = new FormData();
        form.set("disenoId", disenoId);
        form.set("plantilla", resultado.plantilla);
        form.set("parametros", JSON.stringify(resultado.parametros));
        form.set("archivo", png, "miniatura.png");
        await guardarMiniaturaDiseno(form);
      } catch (e) {
        // Una foto que falta no estorba: la próxima versión la intenta otra vez.
        console.error("[disenos] miniatura", e);
      }
    }, ESPERA_MS);
    return () => {
      vivo = false;
      clearTimeout(espera);
    };
  }, [disenoId, resultado, tinte, esperarGuardado]);

  return null;
}
