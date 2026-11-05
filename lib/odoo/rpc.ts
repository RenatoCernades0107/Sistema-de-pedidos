/**
 * La única costura con Odoo.
 *
 * Todo lo que la app le pide a Odoo pasa por `ejecutar()`, que habla JSON-RPC
 * clásica (`POST /jsonrpc`, `object.execute_kw`). Es la API que funciona de la
 * versión 14 a la 19; desde la 19 Odoo la marca como deprecada a favor de
 * JSON-2 (`/json/2/<modelo>/<método>` con la API key como Bearer). Si un día hay
 * que cambiar, solo cambia este archivo: el resto de `lib/odoo/` no sabe por
 * dónde viajan las llamadas.
 *
 * Solo servidor. Las cuatro variables son secretos de verdad —la API key de un
 * usuario de Odoo puede crear clientes y cotizaciones— y por eso no llevan
 * `NEXT_PUBLIC_`: en un bundle del navegador llegarían vacías.
 */

export interface ConfigOdoo {
  url: string;
  db: string;
  usuario: string;
  clave: string;
}

/** Un error que ya trae un mensaje para la persona, no para el log. */
export class ErrorOdoo extends Error {
  /** El tipo de excepción de Odoo, cuando lo dijo: `odoo.exceptions.ValidationError`. */
  readonly tipo: string | null;

  constructor(mensaje: string, tipo: string | null = null) {
    super(mensaje);
    this.name = "ErrorOdoo";
    this.tipo = tipo;
  }
}

export const ODOO_NO_CONFIGURADO =
  "Falta configurar Odoo en el servidor (ODOO_URL, ODOO_DB, ODOO_USUARIO y ODOO_API_KEY).";

/** Lo bastante largo para un `create` con varias líneas; lo bastante corto para no colgar un mostrador. */
const TIEMPO_MAXIMO_MS = 15_000;

export function configOdoo(env: NodeJS.ProcessEnv = process.env): ConfigOdoo | null {
  const url = (env.ODOO_URL ?? "").trim().replace(/\/+$/, "");
  const db = (env.ODOO_DB ?? "").trim();
  const usuario = (env.ODOO_USUARIO ?? "").trim();
  const clave = (env.ODOO_API_KEY ?? "").trim();
  if (!url || !db || !usuario || !clave) return null;
  return { url, db, usuario, clave };
}

export const odooConfigurado = () => configOdoo() !== null;

/**
 * El enlace para abrir una cotización en Odoo. El formato `/web#…` es el viejo,
 * pero las versiones nuevas lo siguen redirigiendo, así que sirve para todas.
 */
export function enlaceOdoo(modelo: string, id: number): string | null {
  const config = configOdoo();
  if (!config) return null;
  return `${config.url}/web#id=${id}&model=${encodeURIComponent(modelo)}&view_type=form`;
}

/* ── Errores ───────────────────────────────────────────────────────────────── */

interface ErrorJsonRpc {
  message?: string;
  data?: { name?: string; message?: string; arguments?: unknown[] };
}

/**
 * Odoo responde los errores con HTTP 200 y un objeto `error`. Los de validación
 * (`ValidationError`, `UserError`) traen un mensaje pensado para el usuario de
 * Odoo —"El RUC no es válido"— y ese se muestra tal cual. Los demás dicen más de
 * la mecánica que del problema.
 */
export function errorDeOdoo(error: ErrorJsonRpc): ErrorOdoo {
  const tipo = error.data?.name ?? null;
  const detalle = (error.data?.message ?? error.message ?? "").trim();

  if (tipo?.includes("AccessDenied")) {
    return new ErrorOdoo("Odoo rechazó el usuario o la API key. Revisa la configuración.", tipo);
  }
  if (tipo?.includes("AccessError")) {
    return new ErrorOdoo(
      `El usuario de Odoo no tiene permiso para esto${detalle ? `: ${detalle}` : "."}`,
      tipo,
    );
  }
  if (tipo?.includes("ValidationError") || tipo?.includes("UserError")) {
    return new ErrorOdoo(detalle || "Odoo rechazó los datos.", tipo);
  }
  if (tipo?.includes("MissingError")) {
    return new ErrorOdoo("Ese registro ya no existe en Odoo.", tipo);
  }
  return new ErrorOdoo(`Odoo devolvió un error${detalle ? `: ${detalle}` : "."}`, tipo);
}

/* ── Transporte ────────────────────────────────────────────────────────────── */

let siguienteId = 1;

async function llamar(
  config: ConfigOdoo,
  service: "common" | "object",
  method: string,
  args: unknown[],
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${config.url}/jsonrpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "call",
        params: { service, method, args },
        id: siguienteId++,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
    });
  } catch (e) {
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
      throw new ErrorOdoo("Odoo no respondió a tiempo. Intenta de nuevo.");
    }
    throw new ErrorOdoo("No se pudo conectar con Odoo.");
  }

  if (!res.ok) throw new ErrorOdoo(`Odoo respondió ${res.status}. Intenta de nuevo.`);

  let json: { result?: unknown; error?: ErrorJsonRpc };
  try {
    json = (await res.json()) as typeof json;
  } catch {
    throw new ErrorOdoo("Odoo devolvió una respuesta que no se entiende. ¿La URL es la correcta?");
  }

  if (json.error) throw errorDeOdoo(json.error);
  return json.result;
}

/* ── Sesión ────────────────────────────────────────────────────────────────── */

/**
 * El uid se pide una vez por instancia del servidor. La clave es la config
 * entera: si cambian las variables (en los tests, o al rotar la API key) no se
 * reutiliza un uid de otra base.
 */
let sesion: { clave: string; uid: Promise<number> } | null = null;

const claveDe = (c: ConfigOdoo) => `${c.url}|${c.db}|${c.usuario}|${c.clave}`;

async function uidDe(config: ConfigOdoo): Promise<number> {
  const clave = claveDe(config);
  if (sesion?.clave !== clave) {
    const uid = (async () => {
      const r = await llamar(config, "common", "authenticate", [
        config.db,
        config.usuario,
        config.clave,
        {},
      ]);
      if (typeof r !== "number" || r <= 0) {
        throw new ErrorOdoo("Odoo rechazó el usuario o la API key. Revisa la configuración.");
      }
      return r;
    })();
    sesion = { clave, uid };
    // Un fallo no se cachea: la siguiente llamada vuelve a intentarlo.
    uid.catch(() => {
      if (sesion?.uid === uid) sesion = null;
    });
  }
  return sesion.uid;
}

const alReiniciar: (() => void)[] = [];

/** Para que otros módulos de `lib/odoo/` olviden lo que guardaron de este Odoo. */
export function registrarReinicio(fn: () => void) {
  alReiniciar.push(fn);
}

/** Olvida el uid y todo lo aprendido de este Odoo. Para los tests. */
export function reiniciarCacheOdoo() {
  sesion = null;
  camposPorModelo.clear();
  modelosExistentes.clear();
  for (const fn of alReiniciar) fn();
}

/**
 * `execute_kw` sobre un modelo. `args` son los posicionales del método y
 * `kwargs` los nombrados, exactamente como los documenta la API externa de Odoo.
 */
export async function ejecutar<T = unknown>(
  modelo: string,
  metodo: string,
  args: unknown[] = [],
  kwargs: Record<string, unknown> = {},
): Promise<T> {
  const config = configOdoo();
  if (!config) throw new ErrorOdoo(ODOO_NO_CONFIGURADO);

  const uid = await uidDe(config);
  try {
    return (await llamar(config, "object", "execute_kw", [
      config.db,
      uid,
      config.clave,
      modelo,
      metodo,
      args,
      kwargs,
    ])) as T;
  } catch (e) {
    // La API key pudo rotar mientras el uid seguía en caché.
    if (e instanceof ErrorOdoo && e.tipo?.includes("AccessDenied")) sesion = null;
    throw e;
  }
}

/* ── Lo que cambia entre versiones ─────────────────────────────────────────── */

const camposPorModelo = new Map<string, Promise<Set<string>>>();

/**
 * De los campos que se querrían leer, los que este Odoo tiene. Las versiones
 * mueven campos de sitio —`mobile` de `res.partner` no está en todas— y pedir uno
 * que no existe hace fallar el `search_read` entero.
 */
export async function camposExistentes(modelo: string, deseados: string[]): Promise<string[]> {
  let campos = camposPorModelo.get(modelo);
  if (!campos) {
    campos = ejecutar<Record<string, unknown>>(modelo, "fields_get", [], {
      attributes: ["type"],
    }).then((r) => new Set(Object.keys(r)));
    camposPorModelo.set(modelo, campos);
    campos.catch(() => camposPorModelo.delete(modelo));
  }
  const existen = await campos;
  return deseados.filter((c) => existen.has(c));
}

const modelosExistentes = new Map<string, Promise<boolean>>();

/** Si un módulo opcional está instalado: la localización peruana, por ejemplo. */
export async function modeloExiste(modelo: string): Promise<boolean> {
  let existe = modelosExistentes.get(modelo);
  if (!existe) {
    existe = ejecutar<number>("ir.model", "search_count", [[["model", "=", modelo]]]).then(
      (n) => n > 0,
    );
    modelosExistentes.set(modelo, existe);
    existe.catch(() => modelosExistentes.delete(modelo));
  }
  return existe;
}

/** Un many2one llega como `[id, "nombre"]` o `false`. */
export type Many2one = [number, string] | false;

export const idDe = (m: unknown): number | null =>
  Array.isArray(m) && typeof m[0] === "number" ? m[0] : null;

export const nombreDe = (m: unknown): string | null =>
  Array.isArray(m) && typeof m[1] === "string" ? m[1] : null;

/**
 * Las palabras de una consulta para un `ilike` de Odoo, tal como se escribieron.
 * Sin normalizar a propósito: Odoo compara con tildes, así que quitárselas a
 * "Recién" haría que no encuentre "Recién". Sin distinguir mayúsculas, eso sí,
 * que `ilike` ya lo hace.
 */
export const terminosOdoo = (q: string): string[] => q.trim().split(/\s+/).filter(Boolean);

/** Odoo devuelve `false` para un campo vacío, no `null`. */
export const texto = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;
