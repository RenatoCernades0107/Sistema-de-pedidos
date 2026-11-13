/**
 * El modelo de lenguaje, detrás de una interfaz que no sabe de proveedores.
 *
 * Este es el ÚNICO archivo que conoce a Inferhub (una pasarela de modelos). El
 * resto de la app habla en los tipos de aquí —`MensajeLlm`, `HerramientaLlm`,
 * `EventoLlm`— y cambiar de proveedor es reescribir este archivo y nada más.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ SIN VERIFICAR: la documentación de Inferhub (https://inferhub.dev/docs)  │
 * │ no se pudo consultar al escribir esto. Son SUPOSICIONES, a confirmar:    │
 * │   - la URL base por defecto, `https://inferhub.dev/v1`;                  │
 * │   - que habla el formato "chat completions" compatible con OpenAI:       │
 * │     `POST {base}/chat/completions`, `Authorization: Bearer <clave>`,     │
 * │     `stream: true` con SSE (`data: {...}` y `data: [DONE]`), `tools` y   │
 * │     `tool_calls` que llegan en trozos por `index`, imágenes como partes  │
 * │     `image_url`.                                                         │
 * │ Si alguna no se cumple, lo que hay que tocar es `cuerpoDePeticion` y     │
 * │ `transmitirChat`; los tipos exportados no cambian.                       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * La clave no sale de aquí: ni en los errores ni en los logs.
 */

const BASE_POR_DEFECTO = "https://inferhub.dev/v1";
const MODELO_POR_DEFECTO = "ag/claude-opus-5-5";

/* ── La interfaz ───────────────────────────────────────────────────────────── */

/** Un trozo del mensaje de quien escribe: texto, o una imagen (URL o `data:`). */
export type ParteLlm = { tipo: "texto"; texto: string } | { tipo: "imagen"; url: string };

/** Una herramienta que el modelo pidió usar, con sus argumentos ya leídos. */
export type LlamadaLlm = {
  id: string;
  nombre: string;
  argumentos: Record<string, unknown>;
};

export type MensajeLlm =
  | { rol: "usuario"; contenido: string | ParteLlm[] }
  | { rol: "asistente"; contenido: string; llamadas?: LlamadaLlm[] }
  /**
   * El resultado de una llamada, que vuelve al modelo. `imagenes` (URLs o
   * `data:`) son para herramientas que devuelven algo que mirar, como un render.
   */
  | { rol: "herramienta"; idLlamada: string; contenido: string; imagenes?: string[] };

export type HerramientaLlm = {
  nombre: string;
  descripcion: string;
  /** JSON Schema de los argumentos. */
  parametros: Record<string, unknown>;
};

/** Por qué dejó de escribir: terminó, quiere usar herramientas, o lo cortaron. */
export type MotivoFin = "fin" | "herramientas" | "longitud" | "filtro" | "otro";

export type EventoLlm =
  | { tipo: "texto"; delta: string }
  | {
      tipo: "llamada_herramienta";
      id: string;
      nombre: string;
      argumentos: Record<string, unknown>;
      /** Los argumentos no eran un objeto JSON: `argumentos` va vacío y aquí lo que llegó. */
      argumentosInvalidos?: string;
    }
  | { tipo: "fin"; motivo: MotivoFin };

export type PeticionChat = {
  /** Las instrucciones del asistente. */
  sistema: string;
  mensajes: MensajeLlm[];
  herramientas?: HerramientaLlm[];
  /** Para cortar la respuesta a medias: quien escucha se fue o pulsó "detener". */
  senal?: AbortSignal;
};

export type CodigoErrorLlm = "no_configurado" | "http" | "red" | "respuesta";

/**
 * Lo que puede salir mal al hablar con el modelo. El mensaje está pensado para
 * mostrarse: nunca lleva la clave ni la respuesta entera del proveedor.
 */
export class ErrorLlm extends Error {
  readonly codigo: CodigoErrorLlm;
  /** El estado HTTP, cuando el proveedor contestó con un error. */
  readonly estado?: number;

  constructor(codigo: CodigoErrorLlm, mensaje: string, estado?: number) {
    super(mensaje);
    this.name = "ErrorLlm";
    this.codigo = codigo;
    this.estado = estado;
  }
}

export const LLM_NO_CONFIGURADO =
  "El asistente no está configurado: falta la clave del modelo (INFERHUB_API_KEY).";

/** Si hay clave. Sin ella no se intenta nada: la pantalla lo dice. */
export function llmConfigurado(): boolean {
  return Boolean(process.env.INFERHUB_API_KEY?.trim());
}

/* ── El formato de Inferhub (compatible con OpenAI, por confirmar) ─────────── */

function contenidoDeUsuario(contenido: string | ParteLlm[]) {
  if (typeof contenido === "string") return contenido;
  return contenido.map((p) =>
    p.tipo === "texto"
      ? { type: "text", text: p.texto }
      : { type: "image_url", image_url: { url: p.url } },
  );
}

function mensajeDeCable(m: MensajeLlm): Record<string, unknown> {
  switch (m.rol) {
    case "usuario":
      return { role: "user", content: contenidoDeUsuario(m.contenido) };
    case "herramienta":
      return { role: "tool", tool_call_id: m.idLlamada, content: m.contenido };
    case "asistente":
      if (!m.llamadas?.length) return { role: "assistant", content: m.contenido };
      return {
        role: "assistant",
        // Un turno que solo pide herramientas no trae texto.
        content: m.contenido || null,
        tool_calls: m.llamadas.map((l) => ({
          id: l.id,
          type: "function",
          function: { name: l.nombre, arguments: JSON.stringify(l.argumentos) },
        })),
      };
  }
}

/**
 * Los mensajes en el formato del cable. Un mensaje `tool` solo lleva texto en
 * este formato (y no todos los proveedores aceptan imágenes ahí), así que las
 * imágenes de los resultados de herramientas van en un mensaje `user` justo
 * después de la tanda de resultados —nunca en medio: los `tool` de una misma
 * tanda tienen que ir seguidos—.
 */
function mensajesDeCable(mensajes: MensajeLlm[]): Record<string, unknown>[] {
  const salida: Record<string, unknown>[] = [];
  let pendientes: { idLlamada: string; url: string }[] = [];
  const vaciar = () => {
    if (pendientes.length === 0) return;
    salida.push({
      role: "user",
      content: [
        {
          type: "text",
          text: `Imágenes devueltas por las herramientas (${[...new Set(pendientes.map((p) => p.idLlamada))].join(", ")}):`,
        },
        ...pendientes.map((p) => ({ type: "image_url", image_url: { url: p.url } })),
      ],
    });
    pendientes = [];
  };
  for (const m of mensajes) {
    if (m.rol !== "herramienta") vaciar();
    salida.push(mensajeDeCable(m));
    if (m.rol === "herramienta" && m.imagenes?.length) {
      pendientes.push(...m.imagenes.map((url) => ({ idLlamada: m.idLlamada, url })));
    }
  }
  vaciar();
  return salida;
}

/** El cuerpo de `POST /chat/completions`. Exportado para poder probarlo. */
export function cuerpoDePeticion(peticion: PeticionChat, modelo: string): Record<string, unknown> {
  const cuerpo: Record<string, unknown> = {
    model: modelo,
    stream: true,
    messages: [{ role: "system", content: peticion.sistema }, ...mensajesDeCable(peticion.mensajes)],
  };
  if (peticion.herramientas?.length) {
    cuerpo.tools = peticion.herramientas.map((h) => ({
      type: "function",
      function: { name: h.nombre, description: h.descripcion, parameters: h.parametros },
    }));
  }
  return cuerpo;
}

const MOTIVOS: Record<string, MotivoFin> = {
  stop: "fin",
  end_turn: "fin",
  tool_calls: "herramientas",
  function_call: "herramientas",
  length: "longitud",
  content_filter: "filtro",
};

/* ── SSE ───────────────────────────────────────────────────────────────────── */

/**
 * Los `data:` de un cuerpo SSE, uno por uno, sin el prefijo.
 *
 * La red parte el cuerpo por donde quiere: a media línea y hasta a medio
 * carácter (una tilde son dos bytes). Por eso se decodifica en modo `stream` y
 * solo se entregan líneas completas; lo que quede sin salto al final se entrega
 * al cerrar. Cada línea `data:` es un mensaje —así lo manda este formato—; los
 * comentarios (`: keep-alive`), `event:`, `id:` y las líneas vacías se ignoran.
 */
export async function* leerSse(cuerpo: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const lector = cuerpo.getReader();
  const decodificador = new TextDecoder();
  let pendiente = "";

  const dato = (linea: string): string | null => {
    if (!linea.startsWith("data:")) return null;
    const valor = linea.slice(5);
    return valor.startsWith(" ") ? valor.slice(1) : valor;
  };

  try {
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      pendiente += decodificador.decode(value, { stream: true });

      let salto: number;
      while ((salto = pendiente.indexOf("\n")) !== -1) {
        const linea = pendiente.slice(0, salto).replace(/\r$/, "");
        pendiente = pendiente.slice(salto + 1);
        const d = dato(linea);
        if (d !== null) yield d;
      }
    }
    pendiente += decodificador.decode();
    const d = dato(pendiente.replace(/\r$/, ""));
    if (d !== null) yield d;
  } finally {
    // Si quien consume deja de leer (o hubo un error), se suelta la conexión.
    await lector.cancel().catch(() => {});
  }
}

/* ── La llamada ────────────────────────────────────────────────────────────── */

/** Lo que el proveedor dijo del error, en corto. Nunca la respuesta entera. */
async function detalleDeError(respuesta: Response): Promise<string> {
  let texto = "";
  try {
    texto = await respuesta.text();
  } catch {
    return "";
  }
  try {
    const json = JSON.parse(texto) as { error?: { message?: unknown } | string; message?: unknown };
    const mensaje =
      typeof json.error === "string" ? json.error : (json.error?.message ?? json.message);
    if (typeof mensaje === "string") texto = mensaje;
  } catch {
    // No era JSON: se cita el texto tal cual, recortado.
  }
  return texto.replace(/\s+/g, " ").trim().slice(0, 300);
}

function mensajeHttp(estado: number, detalle: string): string {
  const cola = detalle ? ` (${detalle})` : "";
  if (estado === 401 || estado === 403) {
    return `El modelo rechazó la clave configurada: revisa INFERHUB_API_KEY${cola}.`;
  }
  if (estado === 404) {
    return `El modelo no respondió en esa dirección: revisa INFERHUB_BASE_URL e INFERHUB_MODELO${cola}.`;
  }
  if (estado === 429) return `El modelo está recibiendo demasiadas peticiones. Espera un momento${cola}.`;
  return `El modelo respondió con un error ${estado}${cola}.`;
}

type LlamadaEnCurso = { id: string; nombre: string; argumentos: string };

function cerrarLlamada(l: LlamadaEnCurso, indice: number): EventoLlm {
  const base = { tipo: "llamada_herramienta" as const, id: l.id || `llamada_${indice}`, nombre: l.nombre };
  const crudo = l.argumentos.trim();
  // Una herramienta sin argumentos llega como cadena vacía.
  if (!crudo) return { ...base, argumentos: {} };
  try {
    const leido: unknown = JSON.parse(crudo);
    if (leido && typeof leido === "object" && !Array.isArray(leido)) {
      return { ...base, argumentos: leido as Record<string, unknown> };
    }
  } catch {
    // Cae abajo: se le devuelve al modelo como argumentos inválidos.
  }
  return { ...base, argumentos: {}, argumentosInvalidos: crudo.slice(0, 500) };
}

/**
 * Una respuesta del modelo, en streaming.
 *
 * Entrega el texto según llega (`texto`), después las herramientas que pidió
 * —enteras, con los argumentos ya juntados— y por último un único `fin`. No
 * ejecuta herramientas ni repite la llamada: ese bucle es de quien llama.
 *
 * Lanza `ErrorLlm` si falta la clave, si el proveedor contesta con error o si
 * la respuesta no se entiende. Si `senal` aborta, sale con el error de aborto
 * del propio `fetch` (`AbortError`), sin envolver.
 */
export async function* transmitirChat(peticion: PeticionChat): AsyncGenerator<EventoLlm> {
  const clave = process.env.INFERHUB_API_KEY?.trim();
  if (!clave) throw new ErrorLlm("no_configurado", LLM_NO_CONFIGURADO);

  const base = (process.env.INFERHUB_BASE_URL?.trim() || BASE_POR_DEFECTO).replace(/\/+$/, "");
  const modelo = process.env.INFERHUB_MODELO?.trim() || MODELO_POR_DEFECTO;

  let respuesta: Response;
  try {
    respuesta = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${clave}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(cuerpoDePeticion(peticion, modelo)),
      signal: peticion.senal,
      cache: "no-store",
    });
  } catch (e) {
    if (peticion.senal?.aborted) throw e;
    throw new ErrorLlm("red", "No se pudo conectar con el modelo. Intenta de nuevo.");
  }

  if (!respuesta.ok) {
    throw new ErrorLlm("http", mensajeHttp(respuesta.status, await detalleDeError(respuesta)), respuesta.status);
  }
  if (!respuesta.body) throw new ErrorLlm("respuesta", "El modelo respondió sin contenido.");

  // Las herramientas llegan en trozos: el primero trae id y nombre, los
  // siguientes solo más argumentos, y el `index` dice de cuál es cada uno.
  const llamadas = new Map<number, LlamadaEnCurso>();
  let motivo: MotivoFin | null = null;

  try {
    for await (const dato of leerSse(respuesta.body)) {
      if (dato === "[DONE]") break;
      if (!dato.trim()) continue;

      let trozo: {
        error?: { message?: unknown } | string;
        choices?: {
          delta?: {
            content?: unknown;
            tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
          };
          finish_reason?: string | null;
        }[];
      };
      try {
        trozo = JSON.parse(dato);
      } catch {
        throw new ErrorLlm("respuesta", "El modelo envió una respuesta que no se pudo leer.");
      }

      if (trozo.error) {
        const detalle = typeof trozo.error === "string" ? trozo.error : trozo.error.message;
        throw new ErrorLlm(
          "respuesta",
          `El modelo cortó la respuesta${typeof detalle === "string" ? ` (${detalle.slice(0, 300)})` : ""}.`,
        );
      }

      const opcion = trozo.choices?.[0];
      if (!opcion) continue;

      const delta = opcion.delta;
      if (typeof delta?.content === "string" && delta.content) {
        yield { tipo: "texto", delta: delta.content };
      }
      for (const t of delta?.tool_calls ?? []) {
        const indice = t.index ?? 0;
        const actual = llamadas.get(indice) ?? { id: "", nombre: "", argumentos: "" };
        if (t.id) actual.id = t.id;
        if (t.function?.name) actual.nombre += t.function.name;
        if (t.function?.arguments) actual.argumentos += t.function.arguments;
        llamadas.set(indice, actual);
      }
      if (opcion.finish_reason) motivo = MOTIVOS[opcion.finish_reason] ?? "otro";
    }
  } catch (e) {
    if (e instanceof ErrorLlm || peticion.senal?.aborted) throw e;
    throw new ErrorLlm("red", "Se cortó la conexión con el modelo. Intenta de nuevo.");
  }

  const pedidas = [...llamadas.entries()].sort(([a], [b]) => a - b).filter(([, l]) => l.nombre);
  for (const [indice, l] of pedidas) yield cerrarLlamada(l, indice);

  // Hay proveedores que piden herramientas y aun así cierran con "stop": si
  // pidió alguna, eso es lo que cuenta.
  yield { tipo: "fin", motivo: pedidas.length > 0 ? "herramientas" : (motivo ?? "otro") };
}
