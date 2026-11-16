"use client";

/**
 * Las URLs firmadas de los archivos del chat (el bucket `chat` es privado).
 *
 * Una conversación abierta pinta decenas de miniaturas a la vez: pedirlas una por
 * una serían decenas de idas a Storage. Aquí cada burbuja pide la suya y las
 * pedidas en el mismo instante salen juntas en un solo `createSignedUrls`. Se
 * guardan por ruta hasta poco antes de vencer, así que volver a una conversación
 * o reabrir una foto no vuelve a pedir nada.
 */

import { useEffect, useState } from "react";
import { clienteNavegador } from "@/lib/supabase-cliente";
import { BUCKET_CHAT } from "@/lib/chat/tipos";

const VIGENCIA_S = 3600;
/** Se descarta 5 minutos antes de vencer: un video a medio ver no debe cortarse. */
const MARGEN_MS = 5 * 60_000;

const cache = new Map<string, { url: string; vence: number }>();
let pendientes = new Map<string, ((url: string | null) => void)[]>();
let programado = false;

function vigente(ruta: string): string | null {
  const c = cache.get(ruta);
  return c && c.vence > Date.now() ? c.url : null;
}

async function despachar() {
  programado = false;
  const lote = pendientes;
  pendientes = new Map();
  const rutas = [...lote.keys()];
  if (rutas.length === 0) return;

  const resolver = (ruta: string, url: string | null) => lote.get(ruta)?.forEach((r) => r(url));
  try {
    const { data, error } = await clienteNavegador().storage.from(BUCKET_CHAT).createSignedUrls(rutas, VIGENCIA_S);
    if (error || !data) throw error ?? new Error("Sin URLs");
    const vence = Date.now() + VIGENCIA_S * 1000 - MARGEN_MS;
    const porRuta = new Map(data.map((d) => [d.path, d.signedUrl]));
    for (const ruta of rutas) {
      const url = porRuta.get(ruta) ?? null;
      if (url) cache.set(ruta, { url, vence });
      resolver(ruta, url);
    }
  } catch {
    for (const ruta of rutas) resolver(ruta, null);
  }
}

/** La URL firmada de un archivo del chat, o `null` si no se pudo. */
export function urlFirmada(ruta: string): Promise<string | null> {
  const lista = vigente(ruta);
  if (lista) return Promise.resolve(lista);
  return new Promise((resolve) => {
    const espera = pendientes.get(ruta) ?? [];
    espera.push(resolve);
    pendientes.set(ruta, espera);
    if (!programado) {
      programado = true;
      // Un tick: lo que pidan las demás burbujas en este mismo render va en el lote.
      setTimeout(() => void despachar(), 0);
    }
  });
}

type EstadoUrl = { ruta: string; url: string | null; fallo: boolean };

/** La URL de una ruta para pintarla. `undefined` mientras llega, `null` si falló. */
export function useUrlFirmada(ruta: string | null): string | null | undefined {
  const [estado, setEstado] = useState<EstadoUrl | null>(() =>
    ruta ? { ruta, url: vigente(ruta), fallo: false } : null,
  );

  useEffect(() => {
    if (!ruta || vigente(ruta)) return;
    let vivo = true;
    void urlFirmada(ruta).then((url) => {
      if (vivo) setEstado({ ruta, url, fallo: url === null });
    });
    return () => {
      vivo = false;
    };
  }, [ruta]);

  if (!ruta) return null;
  const enCache = vigente(ruta);
  if (enCache) return enCache;
  if (estado?.ruta === ruta) return estado.fallo ? null : (estado.url ?? undefined);
  return undefined;
}
