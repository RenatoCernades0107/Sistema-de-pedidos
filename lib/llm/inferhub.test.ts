import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ErrorLlm,
  cuerpoDePeticion,
  leerSse,
  llmConfigurado,
  transmitirChat,
  type EventoLlm,
  type PeticionChat,
} from "./inferhub";

/* ── Apoyo ─────────────────────────────────────────────────────────────────── */

const codificador = new TextEncoder();

/** Un cuerpo que entrega exactamente estos trozos, uno por lectura. */
function cuerpo(trozos: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(control) {
      if (i >= trozos.length) return control.close();
      const t = trozos[i++];
      control.enqueue(typeof t === "string" ? codificador.encode(t) : t);
    },
  });
}

/** El mismo texto cortado cada `n` bytes: a media línea y a medio carácter. */
function enPedazos(texto: string, n: number): Uint8Array[] {
  const bytes = codificador.encode(texto);
  const salida: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += n) salida.push(bytes.slice(i, i + n));
  return salida;
}

const sse = (...objetos: unknown[]) =>
  objetos.map((o) => `data: ${typeof o === "string" ? o : JSON.stringify(o)}\n\n`).join("");

const delta = (d: Record<string, unknown>, finish: string | null = null) => ({
  choices: [{ index: 0, delta: d, finish_reason: finish }],
});

function respuestaSse(trozos: (string | Uint8Array)[], status = 200): Response {
  return new Response(cuerpo(trozos), { status, headers: { "Content-Type": "text/event-stream" } });
}

async function todos(peticion: PeticionChat): Promise<EventoLlm[]> {
  const eventos: EventoLlm[] = [];
  for await (const e of transmitirChat(peticion)) eventos.push(e);
  return eventos;
}

const PETICION: PeticionChat = {
  sistema: "Eres un asistente.",
  mensajes: [{ rol: "usuario", contenido: "Hola" }],
};

const fetchFalso = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchFalso);
  vi.stubEnv("INFERHUB_API_KEY", "clave-secreta-123");
  vi.stubEnv("INFERHUB_BASE_URL", "");
  vi.stubEnv("INFERHUB_MODELO", "");
  vi.stubEnv("INFERHUB_MODELOS_RESPALDO", "");
  vi.stubEnv("INFERHUB_REINTENTOS", "");
});

afterEach(() => {
  fetchFalso.mockReset();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/* ── SSE ───────────────────────────────────────────────────────────────────── */

describe("leerSse", () => {
  async function datos(trozos: (string | Uint8Array)[]) {
    const salida: string[] = [];
    for await (const d of leerSse(cuerpo(trozos))) salida.push(d);
    return salida;
  }

  it("entrega cada data: aunque la red corte a media línea", async () => {
    expect(await datos(["da", "ta: uno\n\nda", "ta: d", "os\n", "\ndata: tres\n\n"])).toEqual([
      "uno",
      "dos",
      "tres",
    ]);
  });

  it("no rompe un carácter partido entre dos trozos", async () => {
    const texto = "data: acrílico de 3 mm — ¡listo!\n\n";
    for (const n of [1, 2, 3, 5, 7]) {
      expect(await datos(enPedazos(texto, n))).toEqual(["acrílico de 3 mm — ¡listo!"]);
    }
  });

  it("admite \\r\\n, comentarios, otros campos y data: sin espacio", async () => {
    expect(
      await datos([": keep-alive\r\n", "event: mensaje\r\nid: 7\r\n", "data:uno\r\n\r\n", "data: dos\r\n"]),
    ).toEqual(["uno", "dos"]);
  });

  it("entrega la última línea aunque no termine en salto", async () => {
    expect(await datos(["data: uno\n\ndata: [DONE]"])).toEqual(["uno", "[DONE]"]);
  });
});

/* ── La petición ───────────────────────────────────────────────────────────── */

describe("lo que se envía", () => {
  it("usa la URL, el modelo y la clave por defecto del entorno", async () => {
    fetchFalso.mockResolvedValue(respuestaSse([sse(delta({ content: "ok" }, "stop"), "[DONE]")]));
    await todos(PETICION);

    const [url, init] = fetchFalso.mock.calls[0];
    expect(url).toBe("https://inferhub.dev/v1/chat/completions");
    expect(init?.method).toBe("POST");
    const cabeceras = init?.headers as Record<string, string>;
    expect(cabeceras.Authorization).toBe("Bearer clave-secreta-123");

    const enviado = JSON.parse(init?.body as string);
    expect(enviado.model).toBe("ag/claude-opus-5-5");
    expect(enviado.stream).toBe(true);
    expect(enviado.messages).toEqual([
      { role: "system", content: "Eres un asistente." },
      { role: "user", content: "Hola" },
    ]);
    expect(enviado.tools).toBeUndefined();
  });

  it("respeta INFERHUB_BASE_URL (sin la barra final) e INFERHUB_MODELO", async () => {
    vi.stubEnv("INFERHUB_BASE_URL", "https://otra.example/api/v1/");
    vi.stubEnv("INFERHUB_MODELO", "otro/modelo");
    fetchFalso.mockResolvedValue(respuestaSse([sse("[DONE]")]));
    await todos(PETICION);

    const [url, init] = fetchFalso.mock.calls[0];
    expect(url).toBe("https://otra.example/api/v1/chat/completions");
    expect(JSON.parse(init?.body as string).model).toBe("otro/modelo");
  });

  it("un PDF adjunto va como parte `file` con su `data:`", () => {
    const enviado = cuerpoDePeticion(
      {
        sistema: "S",
        mensajes: [
          {
            rol: "usuario",
            contenido: [
              { tipo: "texto", texto: "Mira el plano" },
              { tipo: "archivo", nombre: "plano.pdf", mime: "application/pdf", datos: "JVBERi0=" },
            ],
          },
        ],
      },
      "m",
    );
    expect(enviado.messages).toEqual([
      { role: "system", content: "S" },
      {
        role: "user",
        content: [
          { type: "text", text: "Mira el plano" },
          { type: "file", file: { filename: "plano.pdf", file_data: "data:application/pdf;base64,JVBERi0=" } },
        ],
      },
    ]);
  });

  it("traduce herramientas, imágenes y el ida y vuelta de una llamada", () => {
    const enviado = cuerpoDePeticion(
      {
        sistema: "S",
        mensajes: [
          {
            rol: "usuario",
            contenido: [
              { tipo: "texto", texto: "¿Qué es esto?" },
              { tipo: "imagen", url: "data:image/png;base64,AAAA" },
            ],
          },
          {
            rol: "asistente",
            contenido: "",
            llamadas: [{ id: "c1", nombre: "ver_plantilla", argumentos: { codigo: "caja" } }],
          },
          { rol: "herramienta", idLlamada: "c1", contenido: '{"ok":true}' },
        ],
        herramientas: [
          { nombre: "ver_plantilla", descripcion: "Ver", parametros: { type: "object", properties: {} } },
        ],
      },
      "m",
    );

    expect(enviado.messages).toEqual([
      { role: "system", content: "S" },
      {
        role: "user",
        content: [
          { type: "text", text: "¿Qué es esto?" },
          { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
        ],
      },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "c1", type: "function", function: { name: "ver_plantilla", arguments: '{"codigo":"caja"}' } },
        ],
      },
      { role: "tool", tool_call_id: "c1", content: '{"ok":true}' },
    ]);
    expect(enviado.tools).toEqual([
      {
        type: "function",
        function: { name: "ver_plantilla", description: "Ver", parameters: { type: "object", properties: {} } },
      },
    ]);
  });

  it("las imágenes de herramientas van en un mensaje user después de toda la tanda", () => {
    const enviado = cuerpoDePeticion(
      {
        sistema: "S",
        mensajes: [
          {
            rol: "asistente",
            contenido: "",
            llamadas: [
              { id: "c1", nombre: "ver_render", argumentos: {} },
              { id: "c2", nombre: "otra", argumentos: {} },
            ],
          },
          { rol: "herramienta", idLlamada: "c1", contenido: '{"ok":true}', imagenes: ["data:image/png;base64,AAAA"] },
          { rol: "herramienta", idLlamada: "c2", contenido: '{"ok":true}' },
          { rol: "asistente", contenido: "Listo." },
        ],
      },
      "m",
    );
    const mensajes = enviado.messages as Record<string, unknown>[];
    expect(mensajes.map((m) => m.role)).toEqual(["system", "assistant", "tool", "tool", "user", "assistant"]);
    expect(mensajes[2]).toEqual({ role: "tool", tool_call_id: "c1", content: '{"ok":true}' });
    expect(mensajes[4]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "Imágenes devueltas por las herramientas (c1):" },
        { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
      ],
    });
  });

  it("una imagen al final de la conversación también se envía", () => {
    const enviado = cuerpoDePeticion(
      {
        sistema: "S",
        mensajes: [{ rol: "herramienta", idLlamada: "c1", contenido: "x", imagenes: ["u"] }],
      },
      "m",
    );
    expect((enviado.messages as { role: string }[]).map((m) => m.role)).toEqual(["system", "tool", "user"]);
  });
});

/* ── La respuesta ──────────────────────────────────────────────────────────── */

describe("transmitirChat", () => {
  it("entrega el texto por trozos y un solo fin", async () => {
    const flujo = sse(
      delta({ role: "assistant", content: "" }),
      delta({ content: "Una caja " }),
      delta({ content: "de acrílico" }),
      delta({}, "stop"),
      "[DONE]",
    );
    fetchFalso.mockResolvedValue(respuestaSse(enPedazos(flujo, 11)));

    expect(await todos(PETICION)).toEqual([
      { tipo: "texto", delta: "Una caja " },
      { tipo: "texto", delta: "de acrílico" },
      { tipo: "fin", motivo: "fin" },
    ]);
  });

  it("junta por índice los argumentos de dos herramientas intercaladas", async () => {
    const llamada = (index: number, id: string | undefined, name: string | undefined, args: string) => ({
      index,
      ...(id ? { id, type: "function" } : {}),
      function: { ...(name ? { name } : {}), arguments: args },
    });
    const flujo = sse(
      delta({ content: "Voy a generarlo." }),
      delta({ tool_calls: [llamada(0, "call_a", "generar_diseno", "")] }),
      delta({ tool_calls: [llamada(1, "call_b", "buscar_planchas", '{"espe')] }),
      delta({ tool_calls: [llamada(0, undefined, undefined, '{"plantilla":"caja","parametros":{"lar')] }),
      delta({ tool_calls: [llamada(1, undefined, undefined, 'sor_mm":3}')] }),
      delta({ tool_calls: [llamada(0, undefined, undefined, 'go":200}}')] }),
      delta({}, "tool_calls"),
      "[DONE]",
    );
    fetchFalso.mockResolvedValue(respuestaSse(enPedazos(flujo, 17)));

    expect(await todos(PETICION)).toEqual([
      { tipo: "texto", delta: "Voy a generarlo." },
      {
        tipo: "llamada_herramienta",
        id: "call_a",
        nombre: "generar_diseno",
        argumentos: { plantilla: "caja", parametros: { largo: 200 } },
      },
      { tipo: "llamada_herramienta", id: "call_b", nombre: "buscar_planchas", argumentos: { espesor_mm: 3 } },
      { tipo: "fin", motivo: "herramientas" },
    ]);
  });

  it("una herramienta sin argumentos llega con un objeto vacío", async () => {
    const flujo = sse(
      delta({ tool_calls: [{ index: 0, id: "c1", function: { name: "listar_plantillas", arguments: "" } }] }),
      delta({}, "stop"),
      "[DONE]",
    );
    fetchFalso.mockResolvedValue(respuestaSse([flujo]));

    expect(await todos(PETICION)).toEqual([
      { tipo: "llamada_herramienta", id: "c1", nombre: "listar_plantillas", argumentos: {} },
      // Pidió una herramienta: eso manda sobre el "stop".
      { tipo: "fin", motivo: "herramientas" },
    ]);
  });

  it("marca los argumentos que no son JSON en vez de reventar", async () => {
    const flujo = sse(
      delta({ tool_calls: [{ index: 0, id: "c1", function: { name: "ver_plantilla", arguments: '{"codigo":' } }] }),
      delta({}, "tool_calls"),
    );
    fetchFalso.mockResolvedValue(respuestaSse([flujo]));

    expect(await todos(PETICION)).toEqual([
      {
        tipo: "llamada_herramienta",
        id: "c1",
        nombre: "ver_plantilla",
        argumentos: {},
        argumentosInvalidos: '{"codigo":',
      },
      { tipo: "fin", motivo: "herramientas" },
    ]);
  });

  it("termina aunque el flujo se cierre sin [DONE] ni motivo", async () => {
    fetchFalso.mockResolvedValue(respuestaSse([sse(delta({ content: "Hola" }))]));
    expect(await todos(PETICION)).toEqual([
      { tipo: "texto", delta: "Hola" },
      { tipo: "fin", motivo: "otro" },
    ]);
  });

  it("traduce el motivo de corte por longitud", async () => {
    fetchFalso.mockResolvedValue(respuestaSse([sse(delta({ content: "a" }, "length"), "[DONE]")]));
    expect((await todos(PETICION)).at(-1)).toEqual({ tipo: "fin", motivo: "longitud" });
  });
});

/* ── Los errores ───────────────────────────────────────────────────────────── */

describe("errores", () => {
  async function fallo(peticion: PeticionChat = PETICION): Promise<unknown> {
    try {
      await todos(peticion);
    } catch (e) {
      return e;
    }
    throw new Error("No falló");
  }

  it("sin clave no llama a nadie y lo dice", async () => {
    vi.stubEnv("INFERHUB_API_KEY", "  ");
    expect(llmConfigurado()).toBe(false);

    const e = await fallo();
    expect(e).toBeInstanceOf(ErrorLlm);
    expect((e as ErrorLlm).codigo).toBe("no_configurado");
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it("un 401 es un ErrorLlm con el estado y sin la clave en el mensaje", async () => {
    fetchFalso.mockResolvedValue(
      Response.json({ error: { message: "Invalid API key: clave-sec…" } }, { status: 401 }),
    );
    const e = (await fallo()) as ErrorLlm;
    expect(e).toBeInstanceOf(ErrorLlm);
    expect(e.codigo).toBe("http");
    expect(e.estado).toBe(401);
    expect(e.message).toContain("INFERHUB_API_KEY");
    expect(e.message).not.toContain("clave-secreta-123");
  });

  it("un 500 con cuerpo que no es JSON cita el texto, recortado", async () => {
    fetchFalso.mockResolvedValue(new Response(`upstream   caído ${"x".repeat(1000)}`, { status: 500 }));
    const e = (await fallo()) as ErrorLlm;
    expect(e.estado).toBe(500);
    expect(e.message).toContain("upstream caído");
    expect(e.message.length).toBeLessThan(400);
  });

  it("un fallo de red es un ErrorLlm de red", async () => {
    fetchFalso.mockRejectedValue(new TypeError("fetch failed"));
    const e = (await fallo()) as ErrorLlm;
    expect(e).toBeInstanceOf(ErrorLlm);
    expect(e.codigo).toBe("red");
  });

  it("un trozo ilegible es un ErrorLlm de respuesta", async () => {
    fetchFalso.mockResolvedValue(respuestaSse(["data: {no es json\n\n"]));
    expect(((await fallo()) as ErrorLlm).codigo).toBe("respuesta");
  });

  it("un error dentro del flujo corta con su motivo", async () => {
    fetchFalso.mockResolvedValue(
      respuestaSse([sse(delta({ content: "Ho" }), { error: { message: "overloaded" } })]),
    );
    const e = (await fallo()) as ErrorLlm;
    expect(e.codigo).toBe("respuesta");
    expect(e.message).toContain("overloaded");
  });

  it("pasa la señal a fetch y, al abortar antes de responder, sale con el aborto", async () => {
    const control = new AbortController();
    fetchFalso.mockImplementation(async (_url, init) => {
      expect(init?.signal).toBe(control.signal);
      control.abort();
      throw new DOMException("Aborted", "AbortError");
    });
    const e = await fallo({ ...PETICION, senal: control.signal });
    expect(e).not.toBeInstanceOf(ErrorLlm);
    expect((e as Error).name).toBe("AbortError");
  });

  it("al abortar a media respuesta deja de entregar y no lo disfraza de error de red", async () => {
    const control = new AbortController();
    let i = 0;
    const flujo = new ReadableStream<Uint8Array>({
      pull(c) {
        if (i++ === 0) return c.enqueue(codificador.encode(sse(delta({ content: "Uno" }))));
        // Lo que hace fetch con un cuerpo cuya señal aborta: la lectura falla.
        control.abort();
        c.error(new DOMException("Aborted", "AbortError"));
      },
    });
    fetchFalso.mockResolvedValue(new Response(flujo, { status: 200 }));

    const vistos: EventoLlm[] = [];
    let error: unknown;
    try {
      for await (const e of transmitirChat({ ...PETICION, senal: control.signal })) vistos.push(e);
    } catch (e) {
      error = e;
    }
    expect(vistos).toEqual([{ tipo: "texto", delta: "Uno" }]);
    expect(error).not.toBeInstanceOf(ErrorLlm);
    expect((error as Error).name).toBe("AbortError");
  });
});

/* ── El razonamiento ───────────────────────────────────────────────────────── */

describe("razonamiento", () => {
  it("solo lo pide si la petición lo activa, con el esfuerzo del entorno", () => {
    expect(cuerpoDePeticion(PETICION, "m").reasoning_effort).toBeUndefined();
    expect(cuerpoDePeticion({ ...PETICION, razonamiento: true }, "m").reasoning_effort).toBe("medium");
    vi.stubEnv("INFERHUB_RAZONAMIENTO", "HIGH");
    expect(cuerpoDePeticion({ ...PETICION, razonamiento: true }, "m").reasoning_effort).toBe("high");
    vi.stubEnv("INFERHUB_RAZONAMIENTO", "off");
    expect(cuerpoDePeticion({ ...PETICION, razonamiento: true }, "m").reasoning_effort).toBeUndefined();
  });

  it("transmite el razonamiento según llega, con cualquiera de sus nombres", async () => {
    fetchFalso.mockResolvedValue(
      respuestaSse([
        sse(
          delta({ reasoning_content: "Mido " }),
          delta({ reasoning: "la caja" }),
          delta({ thinking: "." }),
          delta({ content: "Listo" }, "stop"),
          "[DONE]",
        ),
      ]),
    );
    expect(await todos({ ...PETICION, razonamiento: true })).toEqual([
      { tipo: "razonamiento", delta: "Mido " },
      { tipo: "razonamiento", delta: "la caja" },
      { tipo: "razonamiento", delta: "." },
      { tipo: "texto", delta: "Listo" },
      { tipo: "fin", motivo: "fin" },
    ]);
  });

  it("junta los bloques firmados y los devuelve con las llamadas del turno", async () => {
    fetchFalso.mockResolvedValue(
      respuestaSse([
        sse(
          delta({ thinking_blocks: [{ type: "thinking", thinking: "Uso " }] }),
          delta({ thinking_blocks: [{ type: "thinking", thinking: "la plantilla" }] }),
          delta({ thinking_blocks: [{ type: "thinking", signature: "abc" }] }),
          delta({ tool_calls: [{ index: 0, id: "c1", function: { name: "listar_plantillas", arguments: "" } }] }, "tool_calls"),
          "[DONE]",
        ),
      ]),
    );
    const eventos = await todos({ ...PETICION, razonamiento: true });
    const bloques = eventos.find((e) => e.tipo === "bloques_razonamiento");
    expect(bloques).toEqual({
      tipo: "bloques_razonamiento",
      bloques: [{ type: "thinking", thinking: "Uso la plantilla", signature: "abc" }],
    });
    expect(eventos.at(-1)).toEqual({ tipo: "fin", motivo: "herramientas" });

    const cuerpo = cuerpoDePeticion(
      {
        ...PETICION,
        mensajes: [
          ...PETICION.mensajes,
          {
            rol: "asistente",
            contenido: "",
            llamadas: [{ id: "c1", nombre: "listar_plantillas", argumentos: {} }],
            razonamiento: { texto: "Uso la plantilla", bloques: (bloques as { bloques: Record<string, unknown>[] }).bloques },
          },
        ],
      },
      "m",
    );
    const asistente = (cuerpo.messages as Record<string, unknown>[])[2];
    expect(asistente.reasoning_content).toBe("Uso la plantilla");
    expect(asistente.thinking_blocks).toEqual([{ type: "thinking", thinking: "Uso la plantilla", signature: "abc" }]);
  });
});

describe("modelo de respaldo", () => {
  const SATURADO =
    "1156 of 1157 providers for this model are out of quota or cooling down until their limits reset, and the 1 still serving are all at their concurrency limit right now; retry shortly";

  const modeloDe = (llamada: number) =>
    (JSON.parse(fetchFalso.mock.calls[llamada][1]?.body as string) as { model: string }).model;

  const textoDe = (eventos: EventoLlm[]) =>
    eventos.map((e) => (e.tipo === "texto" ? e.delta : "")).join("");

  async function fallo(): Promise<ErrorLlm> {
    try {
      await todos(PETICION);
    } catch (e) {
      return e as ErrorLlm;
    }
    throw new Error("No falló");
  }

  it("si el principal está saturado, pasa al de respaldo y entrega su respuesta", async () => {
    vi.stubEnv("INFERHUB_MODELOS_RESPALDO", "otro/modelo");
    fetchFalso
      .mockResolvedValueOnce(respuestaSse([sse({ error: { message: SATURADO } })]))
      .mockResolvedValueOnce(respuestaSse([sse(delta({ content: "Hola" }, "stop"), "[DONE]")]));

    const eventos = await todos(PETICION);
    expect(fetchFalso).toHaveBeenCalledTimes(2);
    expect(modeloDe(0)).toBe("ag/claude-opus-5-5");
    expect(modeloDe(1)).toBe("otro/modelo");
    expect(textoDe(eventos)).toBe("Hola");
  });

  it("un 503 también pasa al de respaldo", async () => {
    vi.stubEnv("INFERHUB_MODELOS_RESPALDO", "otro/modelo");
    fetchFalso
      .mockResolvedValueOnce(new Response("Service Unavailable", { status: 503 }))
      .mockResolvedValueOnce(respuestaSse([sse(delta({ content: "Listo" }, "stop"))]));

    expect(textoDe(await todos(PETICION))).toBe("Listo");
    expect(modeloDe(1)).toBe("otro/modelo");
  });

  it("un 401 no pasa al de respaldo", async () => {
    vi.stubEnv("INFERHUB_MODELOS_RESPALDO", "otro/modelo");
    fetchFalso.mockResolvedValueOnce(Response.json({ error: { message: "bad key" } }, { status: 401 }));

    const e = await fallo();
    expect(e.estado).toBe(401);
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });

  it("si ya entregó texto, no repite con el de respaldo", async () => {
    vi.stubEnv("INFERHUB_MODELOS_RESPALDO", "otro/modelo");
    fetchFalso.mockResolvedValueOnce(
      respuestaSse([sse(delta({ content: "Ho" }), { error: { message: SATURADO } })]),
    );

    const e = await fallo();
    expect(e.message).toContain("cortó la respuesta");
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });

  it("si todos están saturados, dice que el modelo está saturado", async () => {
    vi.stubEnv("INFERHUB_MODELOS_RESPALDO", "otro/modelo");
    fetchFalso
      .mockResolvedValueOnce(respuestaSse([sse({ error: { message: SATURADO } })]))
      .mockResolvedValueOnce(new Response("busy", { status: 429 }));

    const e = await fallo();
    expect(e).toBeInstanceOf(ErrorLlm);
    expect(e.message).toContain("saturado");
    expect(fetchFalso).toHaveBeenCalledTimes(2);
  });

  it("sin INFERHUB_MODELOS_RESPALDO usa ag/claude-sonnet-5-5", async () => {
    delete process.env.INFERHUB_MODELOS_RESPALDO;
    fetchFalso
      .mockResolvedValueOnce(respuestaSse([sse({ error: { message: SATURADO } })]))
      .mockResolvedValueOnce(respuestaSse([sse(delta({ content: "Ok" }, "stop"))]));

    expect(textoDe(await todos(PETICION))).toBe("Ok");
    expect(modeloDe(1)).toBe("ag/claude-sonnet-5-5");
  });

  it("con INFERHUB_REINTENTOS repite el mismo modelo tras una pausa", async () => {
    vi.useFakeTimers();
    try {
      vi.stubEnv("INFERHUB_REINTENTOS", "1");
      fetchFalso
        .mockResolvedValueOnce(respuestaSse([sse({ error: { message: SATURADO } })]))
        .mockResolvedValueOnce(respuestaSse([sse(delta({ content: "Ya" }, "stop"))]));

      const promesa = todos(PETICION);
      await vi.runAllTimersAsync();
      expect(textoDe(await promesa)).toBe("Ya");
      expect(modeloDe(0)).toBe("ag/claude-opus-5-5");
      expect(modeloDe(1)).toBe("ag/claude-opus-5-5");
    } finally {
      vi.useRealTimers();
    }
  });
});
