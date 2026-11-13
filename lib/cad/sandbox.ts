/**
 * El transporte hacia el sandbox de diseño libre (`cad/sandbox/`, contrato en
 * `docs/API_cad.md`, «Diseño libre»). Mismo estilo que `lib/cad/motor.ts`:
 * cabeceras, errores y nada más.
 *
 * Solo para el servidor: `CAD_SANDBOX_API_KEY` no sale de aquí.
 *
 * El diseño libre está apagado salvo que `CAD_DISENO_LIBRE=1` y el sandbox esté
 * configurado (`CAD_SANDBOX_BASE_URL`): ver `disenoLibreActivo`.
 */

import type { ErrorCodigoLibre, ResultadoLibre } from "./tipos";

export class ErrorSandboxCad extends Error {
  /** `codigo_invalido` (el código del LLM falló), `no_configurado`, `sin_conexion`… */
  codigo: string;
  estado: number;
  /** Solo con `codigo_invalido`: el detalle para que el modelo corrija su código. */
  errorCodigo?: ErrorCodigoLibre;

  constructor(
    mensaje: string,
    codigo: string,
    estado: number,
    errorCodigo?: ErrorCodigoLibre,
  ) {
    super(mensaje);
    this.name = "ErrorSandboxCad";
    this.codigo = codigo;
    this.estado = estado;
    if (errorCodigo) this.errorCodigo = errorCodigo;
  }
}

export const sandboxConfigurado = () =>
  Boolean(process.env.CAD_SANDBOX_BASE_URL?.trim());

/** El interruptor del diseño libre: bandera explícita y sandbox configurado. */
export const disenoLibreActivo = () =>
  process.env.CAD_DISENO_LIBRE === "1" && sandboxConfigurado();

function url(path: string): string {
  const base = (process.env.CAD_SANDBOX_BASE_URL ?? "")
    .trim()
    .replace(/\/+$/, "");
  return `${base}${path}`;
}

function cabeceras(): Record<string, string> {
  const clave = process.env.CAD_SANDBOX_API_KEY;
  return {
    "Content-Type": "application/json",
    ...(clave ? { "X-API-Key": clave } : {}),
  };
}

const esObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const TIPOS_ERROR = new Set([
  "sintaxis",
  "prohibido",
  "ejecucion",
  "tiempo",
  "memoria",
  "contrato",
  "geometria",
  "salida",
]);

function deErrorCodigo(v: unknown): ErrorCodigoLibre | undefined {
  if (!esObjeto(v) || typeof v.mensaje !== "string") return undefined;
  const tipo =
    typeof v.tipo === "string" && TIPOS_ERROR.has(v.tipo)
      ? v.tipo
      : "ejecucion";
  const salida: ErrorCodigoLibre = {
    tipo: tipo as ErrorCodigoLibre["tipo"],
    mensaje: v.mensaje.slice(0, 2000),
  };
  if (typeof v.linea === "number") salida.linea = v.linea;
  if (typeof v.columna === "number") salida.columna = v.columna;
  if (typeof v.traza === "string" && v.traza)
    salida.traza = v.traza.slice(0, 3000);
  if (typeof v.salida === "string" && v.salida)
    salida.salida = v.salida.slice(0, 2000);
  return salida;
}

const POR_ESTADO: Record<number, { codigo: string; mensaje: string }> = {
  401: {
    codigo: "no_autorizado",
    mensaje:
      "El sandbox CAD rechazó la clave de la aplicación. Avisa a soporte.",
  },
  404: { codigo: "no_encontrado", mensaje: "El sandbox CAD no tiene eso." },
  422: {
    codigo: "codigo_invalido",
    mensaje: "El código no produjo un diseño.",
  },
};
const GENERICO = {
  codigo: "sandbox",
  mensaje: "El sandbox CAD falló. Intenta de nuevo.",
};

async function errorDe(res: Response): Promise<ErrorSandboxCad> {
  const base = POR_ESTADO[res.status] ?? GENERICO;
  let detail: unknown;
  try {
    detail = ((await res.json()) as { detail?: unknown }).detail;
  } catch {
    return new ErrorSandboxCad(base.mensaje, base.codigo, res.status);
  }
  if (esObjeto(detail)) {
    const mensaje =
      typeof detail.mensaje === "string" && detail.mensaje
        ? detail.mensaje
        : base.mensaje;
    const codigo =
      typeof detail.codigo === "string" && detail.codigo
        ? detail.codigo
        : base.codigo;
    return new ErrorSandboxCad(
      mensaje,
      codigo,
      res.status,
      deErrorCodigo(detail.error),
    );
  }
  return new ErrorSandboxCad(base.mensaje, base.codigo, res.status);
}

async function peticion(path: string, init?: RequestInit): Promise<Response> {
  if (!sandboxConfigurado()) {
    throw new ErrorSandboxCad(
      "El diseño libre no está configurado: falta CAD_SANDBOX_BASE_URL.",
      "no_configurado",
      503,
    );
  }
  let res: Response;
  try {
    res = await fetch(url(path), {
      ...init,
      headers: cabeceras(),
      cache: "no-store",
    });
  } catch {
    throw new ErrorSandboxCad(
      "No se pudo conectar con el sandbox CAD.",
      "sin_conexion",
      503,
    );
  }
  if (!res.ok) throw await errorDe(res);
  return res;
}

async function json<T>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    throw new ErrorSandboxCad(
      "El sandbox CAD devolvió una respuesta ilegible.",
      "respuesta",
      502,
    );
  }
}

const post = (cuerpo: unknown): RequestInit => ({
  method: "POST",
  body: JSON.stringify(cuerpo),
});

/** Ejecuta el código. Un error del código llega como `ErrorSandboxCad` con `errorCodigo`. */
export async function ejecutarCodigo(codigo: string): Promise<ResultadoLibre> {
  return json<ResultadoLibre>(await peticion("/ejecutar", post({ codigo })));
}

export async function exportarDxfLibre(
  codigo: string,
  opciones?: { kerf_mm?: number; separacion_mm?: number },
): Promise<ArrayBuffer> {
  const res = await peticion(
    "/dxf",
    post({ codigo, ...(opciones ? { opciones } : {}) }),
  );
  return res.arrayBuffer();
}

export async function exportarStepLibre(codigo: string): Promise<ArrayBuffer> {
  return (await peticion("/step", post({ codigo }))).arrayBuffer();
}

/** PNG 2×2 (isométrica, frente, planta, lateral) como `data:` URL. */
export async function renderizar(
  entrada: { glb_base64: string } | { codigo: string },
): Promise<string> {
  const r = await json<{ png_base64?: unknown }>(
    await peticion("/render", post(entrada)),
  );
  if (typeof r.png_base64 !== "string" || !r.png_base64) {
    throw new ErrorSandboxCad(
      "El sandbox CAD no devolvió la imagen.",
      "respuesta",
      502,
    );
  }
  return `data:image/png;base64,${r.png_base64}`;
}

export async function listarReferencias(): Promise<
  { nombre: string; bytes: number }[]
> {
  return json<{ nombre: string; bytes: number }[]>(
    await peticion("/referencias"),
  );
}

/** El texto de una referencia de VibeCAD. `null` si no existe. */
export async function leerReferencia(nombre: string): Promise<string | null> {
  const ruta = nombre
    .split("/")
    .map((p) => encodeURIComponent(p))
    .join("/");
  try {
    return await (await peticion(`/referencias/${ruta}`)).text();
  } catch (e) {
    if (e instanceof ErrorSandboxCad && e.estado === 404) return null;
    throw e;
  }
}
