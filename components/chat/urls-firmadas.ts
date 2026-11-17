"use client";

/**
 * Las URLs firmadas de los archivos del chat (el bucket `chat` es privado), y
 * de los adjuntos del chat de diseños (`cad_adjuntos`, también privado).
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

/** La clave de la caché: el mismo nombre puede existir en dos buckets. */
const clave = (bucket: string, ruta: string) => `${bucket}\u0000${ruta}`;

const cache = new Map<string, { url: string; vence: number }>();
/** Lo que se pidió en este tick, por bucket y ruta. */
let pendientes = new Map<string, Map<string, ((url: string | null) => void)[]>>();
let programado = false;

function vigente(bucket: string, ruta: string): string | null {
  const c = cache.get(clave(bucket, ruta));
  return c && c.vence > Date.now() ? c.url : null;
}

async function despacharBucket(bucket: string, lote: Map<string, ((url: string | null) => void)[]>) {
  const rutas = [...lote.keys()];
  if (rutas.length === 0) return;

  const resolver = (ruta: string, url: string | null) => lote.get(ruta)?.forEach((r) => r(url));
  try {
    const { data, error } = await clienteNavegador().storage.from(bucket).createSignedUrls(rutas, VIGENCIA_S);
    if (error || !data) throw error ?? new Error("Sin URLs");
    const vence = Date.now() + VIGENCIA_S * 1000 - MARGEN_MS;
    const porRuta = new Map(data.map((d) => [d.path, d.signedUrl]));
    for (const ruta of rutas) {
      const url = porRuta.get(ruta) ?? null;
      if (url) cache.set(clave(bucket, ruta), { url, vence });
      resolver(ruta, url);
    }
  } catch {
    for (const ruta of rutas) resolver(ruta, null);
  }
}

function despachar() {
  programado = false;
  const lotes = pendientes;
  pendientes = new Map();
  for (const [bucket, lote] of lotes) void despacharBucket(bucket, lote);
}

/** La URL firmada de un archivo, o `null` si no se pudo. Por defecto, del bucket del chat. */
export function urlFirmada(ruta: string, bucket: string = BUCKET_CHAT): Promise<string | null> {
  const lista = vigente(bucket, ruta);
  if (lista) return Promise.resolve(lista);
  return new Promise((resolve) => {
    const lote = pendientes.get(bucket) ?? new Map<string, ((url: string | null) => void)[]>();
    const espera = lote.get(ruta) ?? [];
    espera.push(resolve);
    lote.set(ruta, espera);
    pendientes.set(bucket, lote);
    if (!programado) {
      programado = true;
      // Un tick: lo que pidan las demás burbujas en este mismo render va en el lote.
      setTimeout(despachar, 0);
    }
  });
}

type EstadoUrl = { clave: string; url: string | null; fallo: boolean };

/** La URL de una ruta para pintarla. `undefined` mientras llega, `null` si falló. */
export function useUrlFirmada(ruta: string | null, bucket: string = BUCKET_CHAT): string | null | undefined {
  const [estado, setEstado] = useState<EstadoUrl | null>(() =>
    ruta ? { clave: clave(bucket, ruta), url: vigente(bucket, ruta), fallo: false } : null,
  );

  useEffect(() => {
    if (!ruta || vigente(bucket, ruta)) return;
    let vivo = true;
    void urlFirmada(ruta, bucket).then((url) => {
      if (vivo) setEstado({ clave: clave(bucket, ruta), url, fallo: url === null });
    });
    return () => {
      vivo = false;
    };
  }, [ruta, bucket]);

  if (!ruta) return null;
  const enCache = vigente(bucket, ruta);
  if (enCache) return enCache;
  if (estado?.clave === clave(bucket, ruta)) return estado.fallo ? null : (estado.url ?? undefined);
  return undefined;
}
