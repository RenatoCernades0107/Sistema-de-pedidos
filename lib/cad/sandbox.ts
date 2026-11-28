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

import type { ContornosSandbox } from "./contornos";
import type { ErrorCodigoLibre, OpcionesDxfPlanchas, PlanchaAcomodadaCad, ResultadoLibre } from "./tipos";

export class ErrorSandboxCad extends Error {
  /** `codigo_invalido` (el código del LLM falló), `no_configurado`, `sin_conexion`… */
  codigo: string;
  estado: number;
  /** Solo con `codigo_invalido`: el detalle para que el modelo corrija su código. */
  errorCodigo?: ErrorCodigoLibre;
  /** Solo con `acomodo_invalido`: qué copia de qué pieza no cuadra con las planchas. */
  errores?: { campo: string; mensaje: string }[];

  constructor(
    mensaje: string,
    codigo: string,
    estado: number,
    errorCodigo?: ErrorCodigoLibre,
    errores?: { campo: string; mensaje: string }[],
  ) {
    super(mensaje);
    this.name = "ErrorSandboxCad";
    this.codigo = codigo;
    this.estado = estado;
    if (errorCodigo) this.errorCodigo = errorCodigo;
    if (errores?.length) this.errores = errores;
  }
}

export const sandboxConfigurado = () => Boolean(process.env.CAD_SANDBOX_BASE_URL?.trim());

/** El interruptor del diseño libre: bandera explícita y sandbox configurado. */
export const disenoLibreActivo = () => process.env.CAD_DISENO_LIBRE === "1" && sandboxConfigurado();

function url(path: string): string {
  const base = (process.env.CAD_SANDBOX_BASE_URL ?? "").trim().replace(/\/+$/, "");
  return `${base}${path}`;
}

function cabeceras(): Record<string, string> {
  const clave = process.env.CAD_SANDBOX_API_KEY;
  return { "Content-Type": "application/json", ...(clave ? { "X-API-Key": clave } : {}) };
}

const esObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const TIPOS_ERROR = new Set(["sintaxis", "prohibido", "ejecucion", "tiempo", "memoria", "contrato", "geometria", "salida"]);

function deErrorCodigo(v: unknown): ErrorCodigoLibre | undefined {
  if (!esObjeto(v) || typeof v.mensaje !== "string") return undefined;
  const tipo = typeof v.tipo === "string" && TIPOS_ERROR.has(v.tipo) ? v.tipo : "ejecucion";
  const salida: ErrorCodigoLibre = { tipo: tipo as ErrorCodigoLibre["tipo"], mensaje: v.mensaje.slice(0, 2000) };
  if (typeof v.linea === "number") salida.linea = v.linea;
  if (typeof v.columna === "number") salida.columna = v.columna;
  if (typeof v.traza === "string" && v.traza) salida.traza = v.traza.slice(0, 3000);
  if (typeof v.salida === "string" && v.salida) salida.salida = v.salida.slice(0, 2000);
  return salida;
}

/** Los errores por campo de un 422 (`acomodo_invalido`, `parametros_invalidos`). */
function deErrores(v: unknown): { campo: string; mensaje: string }[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v
    .filter((e): e is { campo: string; mensaje: string } => esObjeto(e) && typeof e.mensaje === "string")
    .slice(0, 50)
    .map((e) => ({ campo: typeof e.campo === "string" ? e.campo : "", mensaje: e.mensaje.slice(0, 500) }));
}

const POR_ESTADO: Record<number, { codigo: string; mensaje: string }> = {
  401: {
    codigo: "no_autorizado",
    mensaje:
      "El sandbox CAD rechazó la clave de la aplicación: revisa CAD_SANDBOX_API_KEY (debe ser la del sandbox, no la del motor).",
  },
  404: { codigo: "no_encontrado", mensaje: "El sandbox CAD no tiene eso." },
  422: { codigo: "codigo_invalido", mensaje: "El código no produjo un diseño." },
};
const GENERICO = { codigo: "sandbox", mensaje: "El sandbox CAD falló. Intenta de nuevo." };

/**
 * Un 404 sin `detail` estructurado es el «Not Found» de FastAPI: la ruta no
 * existe en esa URL. Casi siempre es que `CAD_SANDBOX_BASE_URL` apunta a otro
 * servicio (el motor, que no tiene `/ejecutar`). Los 404 propios del sandbox
 * (p. ej. una referencia que no existe) sí traen `detail` como objeto.
 */
function rutaInexistente(path: string, res: Response): ErrorSandboxCad {
  console.error(`[cad] sandbox: ${res.status} en ${path}; CAD_SANDBOX_BASE_URL no parece ser el sandbox`);
  return new ErrorSandboxCad(
    `El sandbox CAD no tiene la ruta ${path}: CAD_SANDBOX_BASE_URL apunta a otro servicio (¿al motor?). Avisa a soporte.`,
    "ruta_inexistente",
    res.status,
  );
}

async function errorDe(path: string, res: Response): Promise<ErrorSandboxCad> {
  const base = POR_ESTADO[res.status] ?? GENERICO;
  let detail: unknown;
  try {
    detail = ((await res.json()) as { detail?: unknown }).detail;
  } catch {
    if (res.status === 404) return rutaInexistente(path, res);
    return new ErrorSandboxCad(base.mensaje, base.codigo, res.status);
  }
  if (res.status === 404 && !esObjeto(detail)) return rutaInexistente(path, res);
  if (esObjeto(detail)) {
    const mensaje = typeof detail.mensaje === "string" && detail.mensaje ? detail.mensaje : base.mensaje;
    const codigo = typeof detail.codigo === "string" && detail.codigo ? detail.codigo : base.codigo;
    return new ErrorSandboxCad(mensaje, codigo, res.status, deErrorCodigo(detail.error), deErrores(detail.errores));
  }
  return new ErrorSandboxCad(base.mensaje, base.codigo, res.status);
}

async function peticion(path: string, init?: RequestInit): Promise<Response> {
  if (!sandboxConfigurado()) {
    throw new ErrorSandboxCad("El diseño libre no está configurado: falta CAD_SANDBOX_BASE_URL.", "no_configurado", 503);
  }
  let res: Response;
  try {
    res = await fetch(url(path), { ...init, headers: cabeceras(), cache: "no-store" });
  } catch {
    throw new ErrorSandboxCad("No se pudo conectar con el sandbox CAD.", "sin_conexion", 503);
  }
  if (!res.ok) throw await errorDe(path, res);
  return res;
}

async function json<T>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    throw new ErrorSandboxCad("El sandbox CAD devolvió una respuesta ilegible.", "respuesta", 502);
  }
}

const post = (cuerpo: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(cuerpo) });

/**
 * Los logos del diseño (`lib/cad/contornos.ts`) van con CADA llamada que manda el
 * código: el sandbox no guarda nada entre ejecuciones. Sin ninguno, el cuerpo no
 * cambia (y un sandbox viejo, que ignora campos que no conoce, sigue sirviendo).
 */
const conContornos = (contornos?: ContornosSandbox): { contornos?: ContornosSandbox } =>
  contornos && Object.keys(contornos).length > 0 ? { contornos } : {};

/** Ejecuta el código. Un error del código llega como `ErrorSandboxCad` con `errorCodigo`. */
export async function ejecutarCodigo(codigo: string, contornos?: ContornosSandbox): Promise<ResultadoLibre> {
  return json<ResultadoLibre>(await peticion("/ejecutar", post({ codigo, ...conContornos(contornos) })));
}

export async function exportarDxfLibre(
  codigo: string,
  opciones?: { kerf_mm?: number; separacion_mm?: number },
  contornos?: ContornosSandbox,
): Promise<ArrayBuffer> {
  const res = await peticion("/dxf", post({ codigo, ...(opciones ? { opciones } : {}), ...conContornos(contornos) }));
  return res.arrayBuffer();
}

/**
 * El DXF de producción de un diseño libre: ejecuta el código y dibuja sus
 * piezas en las planchas del acomodo (capa PLANCHA), como `/dxf/planchas` del
 * motor. Un acomodo que no cuadra llega como `acomodo_invalido` con `errores`.
 */
export async function exportarDxfPlanchasLibre(
  codigo: string,
  planchas: PlanchaAcomodadaCad[],
  opciones?: OpcionesDxfPlanchas,
  contornos?: ContornosSandbox,
): Promise<ArrayBuffer> {
  const res = await peticion(
    "/dxf/planchas",
    post({ codigo, planchas, ...(opciones ? { opciones } : {}), ...conContornos(contornos) }),
  );
  return res.arrayBuffer();
}

export async function exportarStepLibre(codigo: string, contornos?: ContornosSandbox): Promise<ArrayBuffer> {
  return (await peticion("/step", post({ codigo, ...conContornos(contornos) }))).arrayBuffer();
}

/** PNG 2×2 (isométrica, frente, planta, lateral) como `data:` URL. */
export async function renderizar(
  entrada: { glb_base64: string } | { codigo: string; contornos?: ContornosSandbox },
): Promise<string> {
  const cuerpo = "codigo" in entrada ? { codigo: entrada.codigo, ...conContornos(entrada.contornos) } : entrada;
  const r = await json<{ png_base64?: unknown }>(await peticion("/render", post(cuerpo)));
  if (typeof r.png_base64 !== "string" || !r.png_base64) {
    throw new ErrorSandboxCad("El sandbox CAD no devolvió la imagen.", "respuesta", 502);
  }
  return `data:image/png;base64,${r.png_base64}`;
}

export async function listarReferencias(): Promise<{ nombre: string; bytes: number }[]> {
  return json<{ nombre: string; bytes: number }[]>(await peticion("/referencias"));
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
    if (e instanceof ErrorSandboxCad && e.estado === 404 && e.codigo !== "ruta_inexistente") return null;
    throw e;
  }
}

/* ── Chequeo de salud ──────────────────────────────────────────────────────── */

export type SaludSandbox = { ok: true } | { ok: false; motivo: string };

const ESPERA_SALUD_MS = 5000;
const CACHE_OK_MS = 60_000;
const CACHE_FALLO_MS = 15_000;
let cacheSalud: { resultado: SaludSandbox; hasta: number } | null = null;

/** Solo para las pruebas. */
export function olvidarSaludSandbox() {
  cacheSalud = null;
}

async function pedirSalud(path: string, init?: RequestInit): Promise<Response | string> {
  try {
    return await fetch(url(path), {
      ...init,
      headers: cabeceras(),
      cache: "no-store",
      signal: AbortSignal.timeout(ESPERA_SALUD_MS),
    });
  } catch {
    return "no se pudo conectar con CAD_SANDBOX_BASE_URL";
  }
}

async function comprobarSalud(): Promise<SaludSandbox> {
  if (!sandboxConfigurado()) return { ok: false, motivo: "falta CAD_SANDBOX_BASE_URL" };

  const salud = await pedirSalud("/salud");
  if (typeof salud === "string") return { ok: false, motivo: salud };
  if (!salud.ok) return { ok: false, motivo: `/salud respondió ${salud.status}` };
  let servicio: unknown;
  try {
    servicio = ((await salud.json()) as { servicio?: unknown }).servicio;
  } catch {
    return { ok: false, motivo: "/salud no devolvió JSON" };
  }
  if (servicio === "sandbox") return { ok: true };
  if (servicio !== undefined) {
    return { ok: false, motivo: `CAD_SANDBOX_BASE_URL es del servicio «${String(servicio)}», no del sandbox` };
  }

  // Un sandbox desplegado antes de que `/salud` dijera `servicio`: se mira que
  // exista `/ejecutar`. Sin cuerpo, el sandbox responde 401 o 422; el motor, 404.
  const ejecutar = await pedirSalud("/ejecutar", { method: "POST", body: "{}" });
  if (typeof ejecutar === "string") return { ok: false, motivo: ejecutar };
  if (ejecutar.status === 404) {
    return { ok: false, motivo: "CAD_SANDBOX_BASE_URL no tiene /ejecutar (¿apunta al motor?)" };
  }
  return { ok: true };
}

/**
 * Comprueba que `CAD_SANDBOX_BASE_URL` responde y es de verdad el sandbox (no
 * el motor). Se guarda un rato para no pagar la llamada en cada turno del chat.
 */
export async function verificarSandbox(): Promise<SaludSandbox> {
  const ahora = Date.now();
  if (cacheSalud && cacheSalud.hasta > ahora) return cacheSalud.resultado;
  const resultado = await comprobarSalud();
  cacheSalud = { resultado, hasta: ahora + (resultado.ok ? CACHE_OK_MS : CACHE_FALLO_MS) };
  if (!resultado.ok) console.error(`[cad] sandbox no disponible: ${resultado.motivo}`);
  return resultado;
}
