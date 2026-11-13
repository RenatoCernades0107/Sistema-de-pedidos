/**
 * El transporte hacia el motor CAD (`docs/API_cad.md`): cabeceras, errores y
 * nada más. Lo usan los route handlers de `/api/cad`, las páginas de `/disenos`
 * y el chat de diseños.
 *
 * Solo para el servidor: `CAD_API_KEY` no sale de aquí y el navegador nunca
 * habla con el motor — pasa por `/api/cad/*`, que primero comprueba la sesión.
 *
 * A diferencia de `lib/agente-cotizaciones.ts`, esto lanza en vez de devolver un
 * `Resultado`: un 422 del motor trae una lista de errores por campo que el
 * formulario necesita entera, y un `{ ok: false, error: string }` la perdería.
 */

import type {
  OpcionesDxf,
  OpcionesDxfPlanchas,
  ParametrosCad,
  PlanchaAcomodadaCad,
  PlantillaCad,
  ResultadoGeneracion,
} from "./tipos";

export interface ErrorCampoCad {
  campo: string;
  mensaje: string;
}

export class ErrorMotorCad extends Error {
  /** El `codigo` del motor (`parametros_invalidos`, `geometria`) o uno de aquí. */
  codigo: string;
  /** El estado HTTP del motor; 503 si no se llegó a hablar con él. */
  estado: number;
  errores?: ErrorCampoCad[];

  constructor(mensaje: string, codigo: string, estado: number, errores?: ErrorCampoCad[]) {
    super(mensaje);
    this.name = "ErrorMotorCad";
    this.codigo = codigo;
    this.estado = estado;
    if (errores?.length) this.errores = errores;
  }
}

/** Lo que se dice cuando el motor no manda un mensaje propio. */
const POR_ESTADO: Record<number, { codigo: string; mensaje: string }> = {
  401: {
    codigo: "no_autorizado",
    mensaje: "El motor CAD rechazó la clave de la aplicación. Avisa a soporte.",
  },
  404: { codigo: "plantilla_desconocida", mensaje: "Esa plantilla no existe en el motor CAD." },
  422: { codigo: "parametros_invalidos", mensaje: "Hay parámetros que no son válidos." },
  500: { codigo: "geometria", mensaje: "El motor CAD no pudo construir la geometría." },
};

const GENERICO = { codigo: "motor", mensaje: "El motor CAD falló. Intenta de nuevo." };

export const motorConfigurado = () => Boolean(process.env.CAD_API_BASE_URL);

/** La base puede venir con `/` al final y todas las rutas empiezan con `/`. */
function url(path: string): string {
  const base = (process.env.CAD_API_BASE_URL ?? "").replace(/\/+$/, "");
  return `${base}${path}`;
}

function cabeceras(): Record<string, string> {
  const clave = process.env.CAD_API_KEY;
  return {
    "Content-Type": "application/json",
    // En local el motor arranca sin clave y no exige la cabecera.
    ...(clave ? { "X-API-Key": clave } : {}),
  };
}

const esObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** `[{ campo, mensaje }]` del motor, descartando lo que no tenga esa forma. */
function erroresDeCampo(v: unknown): ErrorCampoCad[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((e) =>
    esObjeto(e) && typeof e.campo === "string" && typeof e.mensaje === "string"
      ? [{ campo: e.campo, mensaje: e.mensaje }]
      : [],
  );
}

/**
 * FastAPI usa `detail` para tres cosas: el objeto `{ codigo, mensaje, errores }`
 * que escribe el motor, un string suelto (el 404 o el 401) y la lista de errores
 * de esquema que genera pydantic cuando el cuerpo ni siquiera tiene la forma
 * `{ plantilla, parametros }`. Las tres terminan en el mismo error.
 */
async function errorDe(res: Response): Promise<ErrorMotorCad> {
  const base = POR_ESTADO[res.status] ?? GENERICO;
  let detail: unknown;
  try {
    detail = ((await res.json()) as { detail?: unknown }).detail;
  } catch {
    return new ErrorMotorCad(base.mensaje, base.codigo, res.status);
  }

  if (esObjeto(detail)) {
    return new ErrorMotorCad(
      typeof detail.mensaje === "string" && detail.mensaje ? detail.mensaje : base.mensaje,
      typeof detail.codigo === "string" && detail.codigo ? detail.codigo : base.codigo,
      res.status,
      erroresDeCampo(detail.errores),
    );
  }

  if (Array.isArray(detail)) {
    const errores = detail.flatMap((e) => {
      if (!esObjeto(e) || typeof e.msg !== "string") return [];
      const loc = Array.isArray(e.loc) ? e.loc : [];
      return [{ campo: String(loc[loc.length - 1] ?? ""), mensaje: e.msg }];
    });
    return new ErrorMotorCad(base.mensaje, base.codigo, res.status, errores);
  }

  // El string de un 404 o un 401 ("Not Found") es para el log, no para la
  // persona; el de un 422 o un 500 sí lo escribió el motor para que se lea.
  const legible = typeof detail === "string" && detail && res.status !== 401 && res.status !== 404;
  return new ErrorMotorCad(legible ? (detail as string) : base.mensaje, base.codigo, res.status);
}

async function peticion(path: string, init?: RequestInit): Promise<Response> {
  if (!motorConfigurado()) {
    throw new ErrorMotorCad(
      "El motor CAD no está configurado: falta CAD_API_BASE_URL.",
      "no_configurado",
      503,
    );
  }

  let res: Response;
  try {
    res = await fetch(url(path), { ...init, headers: cabeceras(), cache: "no-store" });
  } catch {
    throw new ErrorMotorCad("No se pudo conectar con el motor CAD.", "sin_conexion", 503);
  }

  if (!res.ok) throw await errorDe(res);
  return res;
}

async function json<T>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    throw new ErrorMotorCad("El motor CAD devolvió una respuesta ilegible.", "respuesta", 502);
  }
}

const post = (cuerpo: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(cuerpo) });

export async function listarPlantillas(): Promise<PlantillaCad[]> {
  return json<PlantillaCad[]>(await peticion("/plantillas"));
}

/** `null` si el motor no conoce ese código. */
export async function obtenerPlantilla(codigo: string): Promise<PlantillaCad | null> {
  try {
    return await json<PlantillaCad>(await peticion(`/plantillas/${encodeURIComponent(codigo)}`));
  } catch (e) {
    if (e instanceof ErrorMotorCad && e.estado === 404) return null;
    throw e;
  }
}

/** Los parámetros que falten toman su valor por defecto; vuelven ya normalizados. */
export async function generarDiseno(
  plantilla: string,
  parametros: ParametrosCad,
): Promise<ResultadoGeneracion> {
  return json<ResultadoGeneracion>(await peticion("/generar", post({ plantilla, parametros })));
}

/** El despiece acostado, en mm, listo para la cortadora. */
export async function exportarDxf(
  plantilla: string,
  parametros: ParametrosCad,
  opciones?: OpcionesDxf,
): Promise<ArrayBuffer> {
  const res = await peticion(
    "/dxf",
    post({ plantilla, parametros, ...(opciones ? { opciones } : {}) }),
  );
  return res.arrayBuffer();
}

/** El conjunto armado, para abrirlo en otro CAD. */
export async function exportarStep(
  plantilla: string,
  parametros: ParametrosCad,
): Promise<ArrayBuffer> {
  const res = await peticion("/step", post({ plantilla, parametros }));
  return res.arrayBuffer();
}

/**
 * El DXF de producción: las piezas en las planchas que dijo el acomodo, con el
 * contorno de cada plancha. Un 422 `acomodo_invalido` trae los `errores`.
 */
export async function exportarDxfPlanchas(
  plantilla: string,
  parametros: ParametrosCad,
  planchas: PlanchaAcomodadaCad[],
  opciones?: OpcionesDxfPlanchas,
): Promise<ArrayBuffer> {
  const res = await peticion(
    "/dxf/planchas",
    post({ plantilla, parametros, planchas, ...(opciones ? { opciones } : {}) }),
  );
  return res.arrayBuffer();
}
