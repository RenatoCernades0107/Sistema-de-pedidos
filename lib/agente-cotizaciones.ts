/**
 * El transporte hacia la Quote Agent API (`docs/API_agent.md`): headers, códigos
 * de error y nada más.
 *
 * Está aquí y no dentro de `cotizaciones/acciones.ts` porque tiene dos
 * llamadores de distinta naturaleza: las Server Actions del chat y el route
 * handler que sirve los PDFs. Un archivo `"use server"` no puede hacer de
 * biblioteca —cada export suyo es un endpoint público—, así que la alternativa
 * era duplicar los headers y el mapa de errores en los dos sitios, que es
 * justamente como se separan.
 *
 * `APP_API_KEY` y `X-User-Id` nunca salen del servidor: quien llame a esto tiene
 * que haber autenticado ya a la persona y pasar su id, nunca un valor que mande
 * el navegador — la propia API documenta que confía en ese header a ciegas
 * (IDOR si se expusiera).
 */

export type Resultado<T> = { ok: true; data: T } | { ok: false; error: string };

export const fallo = <T,>(error: string): Resultado<T> => ({ ok: false, error });

/** Mapea los códigos de `docs/API_agent.md` § Códigos de error a español. */
const MENSAJE_POR_ESTADO: Record<number, string> = {
  400: "Falta un dato de sesión. Recarga la página.",
  401: "La API de cotizaciones no está bien configurada. Avisa a soporte.",
  404: "Este chat ya no existe.",
  409: "El bosquejo ya no está disponible. Pide la cotización de nuevo en el chat.",
  422: "El mensaje no es válido.",
};

export function mensajeDeEstado(status: number): string {
  return MENSAJE_POR_ESTADO[status] ?? "No se pudo comunicar con el agente. Intenta de nuevo.";
}

/**
 * Estados en los que la API escribe un `detail` en español pensado para que lo
 * lea la persona: por qué se rechazó un archivo, o qué falta para poder crear la
 * cotización. Ahí su texto gana al genérico de la tabla — "El mensaje no es
 * válido" no le dice a nadie que su plano pesa 5 MB. En el resto no: un `404`
 * responde "Chat not found", que es para el log, no para el colaborador.
 */
const ESTADOS_CON_DETALLE_UTIL = new Set([409, 422]);

async function motivo(res: Response): Promise<string> {
  const generico = mensajeDeEstado(res.status);
  if (!ESTADOS_CON_DETALLE_UTIL.has(res.status)) return generico;
  try {
    const body = (await res.json()) as { detail?: unknown };
    // FastAPI usa `detail` para dos cosas: el string que escribimos nosotros y
    // la lista de errores de esquema que genera solo. Solo el primero se muestra.
    return typeof body.detail === "string" && body.detail ? body.detail : generico;
  } catch {
    return generico;
  }
}

/**
 * La base puede venir con `/` al final (así está en el `.env` de producción) y
 * todas las rutas empiezan con `/`: sin esto la URL sale con `//` en medio.
 */
function url(path: string): string {
  const base = (process.env.AGENT_API_BASE_URL ?? "").replace(/\/+$/, "");
  return `${base}${path}`;
}

function headers(userId: string, extra?: HeadersInit): HeadersInit {
  return {
    "Content-Type": "application/json",
    "X-API-Key": process.env.APP_API_KEY ?? "",
    "X-User-Id": userId,
    ...extra,
  };
}

/** Llama a la Quote Agent API con los headers que exige, y decodifica el JSON. */
export async function agentFetch<T>(
  userId: string,
  path: string,
  init?: RequestInit,
): Promise<Resultado<T>> {
  let res: Response;
  try {
    res = await fetch(url(path), {
      ...init,
      headers: headers(userId, init?.headers),
      cache: "no-store",
    });
  } catch {
    return fallo("No se pudo conectar con el agente de cotizaciones.");
  }

  if (!res.ok) return fallo(await motivo(res));
  if (res.status === 204) return { ok: true, data: undefined as T };

  const json = (await res.json()) as T;
  return { ok: true, data: json };
}

export interface Documento {
  nombre: string;
  tipoMime: string;
  /**
   * Respaldado por un `ArrayBuffer` y no por el `Buffer` de Node, que está sobre
   * `ArrayBufferLike`: un `Response` solo acepta el primero, y esto evita tener
   * que castearlo en cada sitio que lo sirva.
   */
  contenido: Uint8Array<ArrayBuffer>;
}

/**
 * Un PDF de la API. Viene en base64 dentro de un JSON, no como
 * `application/pdf` a secas: API Gateway REST solo pasa binarios si se le
 * declara `binaryMediaTypes`, y eso afectaría a *todas* las rutas de la API
 * (ver `docs/API_agent.md`). Aquí se deshace ese envoltorio y lo que sale son
 * los bytes del PDF.
 */
export async function agentDocumento(userId: string, path: string): Promise<Resultado<Documento>> {
  const r = await agentFetch<Record<string, unknown>>(userId, path);
  if (!r.ok) return r;

  const base64 = r.data.content_base64;
  if (typeof base64 !== "string") return fallo("El agente no devolvió el archivo.");

  const bytes = Buffer.from(base64, "base64");
  const contenido = new Uint8Array(bytes.byteLength);
  contenido.set(bytes);

  return {
    ok: true,
    data: {
      nombre: typeof r.data.filename === "string" ? r.data.filename : "documento.pdf",
      tipoMime: typeof r.data.content_type === "string" ? r.data.content_type : "application/pdf",
      contenido,
    },
  };
}
