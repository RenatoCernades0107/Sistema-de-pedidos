/**
 * Consulta de RUC en openruc.com (datos de SUNAT). Solo se llama desde el
 * servidor: el navegador pregunta a `/api/clientes/ruc/{ruc}`.
 */

export interface RespuestaRuc {
  ruc: string;
  razon_social: string;
  estado: string;
  condicion: string;
  direccion: string;
  ubigeo: string;
  source: string;
  as_of: string;
}

export class ErrorRuc extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const URL_BASE = "https://openruc.com/api/ruc";
const TIEMPO_MAXIMO_MS = 8000;

const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Pregunta por el RUC. Lanza `ErrorRuc` con un mensaje apto para mostrar. */
export async function consultarRuc(ruc: string): Promise<RespuestaRuc> {
  let r: Response;
  try {
    r = await fetch(`${URL_BASE}/${encodeURIComponent(ruc)}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
    });
  } catch {
    throw new ErrorRuc("No se pudo consultar el RUC ahora. Completa los datos a mano.", 502);
  }
  if (r.status === 404) throw new ErrorRuc("No se encontró ese RUC en SUNAT.", 404);
  if (!r.ok) throw new ErrorRuc("El servicio de consulta de RUC no respondió. Completa los datos a mano.", 502);

  const j = (await r.json().catch(() => null)) as Record<string, unknown> | null;
  const razon = texto(j?.razon_social);
  if (!j || !razon) throw new ErrorRuc("La consulta de RUC devolvió una respuesta inesperada.", 502);
  return {
    ruc: texto(j.ruc) || ruc,
    razon_social: razon,
    estado: texto(j.estado),
    condicion: texto(j.condicion),
    direccion: texto(j.direccion),
    ubigeo: texto(j.ubigeo),
    source: texto(j.source),
    as_of: texto(j.as_of),
  };
}

/** `true` si SUNAT lo da por activo y habido; si no, conviene avisar. */
export const rucEnRegla = (r: Pick<RespuestaRuc, "estado" | "condicion">) =>
  r.estado.toUpperCase() === "ACTIVO" && r.condicion.toUpperCase() === "HABIDO";
