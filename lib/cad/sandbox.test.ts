import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ErrorSandboxCad,
  disenoLibreActivo,
  ejecutarCodigo,
  exportarDxfLibre,
  exportarDxfPlanchasLibre,
  leerReferencia,
  renderizar,
} from "./sandbox";

const fetchFalso = vi.fn<typeof fetch>();

const respuesta = (cuerpo: unknown, status = 200) =>
  new Response(typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function llamada(n = 0) {
  const [url, init] = fetchFalso.mock.calls[n];
  return {
    url: String(url),
    metodo: init?.method ?? "GET",
    cabeceras: init?.headers as Record<string, string>,
    cuerpo: init?.body ? JSON.parse(String(init.body)) : undefined,
  };
}

async function errorDe(promesa: Promise<unknown>): Promise<ErrorSandboxCad> {
  try {
    await promesa;
  } catch (e) {
    expect(e).toBeInstanceOf(ErrorSandboxCad);
    return e as ErrorSandboxCad;
  }
  throw new Error("Se esperaba un ErrorSandboxCad.");
}

beforeEach(() => {
  fetchFalso.mockReset();
  vi.stubGlobal("fetch", fetchFalso);
  vi.stubEnv("CAD_SANDBOX_BASE_URL", "http://sandbox.test/");
  vi.stubEnv("CAD_SANDBOX_API_KEY", "clave-sandbox");
  vi.stubEnv("CAD_DISENO_LIBRE", "1");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("interruptor", () => {
  it("solo con la bandera y el sandbox configurado", () => {
    expect(disenoLibreActivo()).toBe(true);
    vi.stubEnv("CAD_DISENO_LIBRE", "0");
    expect(disenoLibreActivo()).toBe(false);
    vi.stubEnv("CAD_DISENO_LIBRE", "1");
    vi.stubEnv("CAD_SANDBOX_BASE_URL", "");
    expect(disenoLibreActivo()).toBe(false);
  });

  it("sin sandbox configurado no llama a nadie", async () => {
    vi.stubEnv("CAD_SANDBOX_BASE_URL", "");
    const e = await errorDe(ejecutarCodigo("piezas = []"));
    expect(e.codigo).toBe("no_configurado");
    expect(fetchFalso).not.toHaveBeenCalled();
  });
});

describe("transporte", () => {
  it("ejecuta con la clave y sin duplicar la barra", async () => {
    fetchFalso.mockResolvedValue(respuesta({ codigo: "x", glb_base64: "", piezas: [], validaciones: [], dimensiones: { x: 1, y: 1, z: 1 } }));
    const r = await ejecutarCodigo("x");
    const { url, metodo, cabeceras, cuerpo } = llamada();
    expect(url).toBe("http://sandbox.test/ejecutar");
    expect(metodo).toBe("POST");
    expect(cabeceras["X-API-Key"]).toBe("clave-sandbox");
    expect(cuerpo).toEqual({ codigo: "x" });
    expect(r.codigo).toBe("x");
  });

  it("un 422 trae el error estructurado del código", async () => {
    fetchFalso.mockResolvedValue(
      respuesta(
        {
          detail: {
            codigo: "codigo_invalido",
            mensaje: "No se puede importar «os».",
            error: { tipo: "prohibido", mensaje: "No se puede importar «os».", linea: 3, columna: 0 },
          },
        },
        422,
      ),
    );
    const e = await errorDe(ejecutarCodigo("import os"));
    expect(e.codigo).toBe("codigo_invalido");
    expect(e.estado).toBe(422);
    expect(e.errorCodigo).toEqual({ tipo: "prohibido", mensaje: "No se puede importar «os».", linea: 3, columna: 0 });
  });

  it("un tipo de error desconocido se trata como de ejecución", async () => {
    fetchFalso.mockResolvedValue(respuesta({ detail: { codigo: "codigo_invalido", mensaje: "x", error: { tipo: "raro", mensaje: "x" } } }, 422));
    const e = await errorDe(ejecutarCodigo("x"));
    expect(e.errorCodigo?.tipo).toBe("ejecucion");
  });

  it("un fallo de red es sin_conexion", async () => {
    fetchFalso.mockRejectedValue(new TypeError("fetch failed"));
    expect((await errorDe(ejecutarCodigo("x"))).codigo).toBe("sin_conexion");
  });

  it("el DXF manda las opciones", async () => {
    fetchFalso.mockResolvedValue(new Response("0\nSECTION"));
    await exportarDxfLibre("x", { kerf_mm: 0.1 });
    expect(llamada().cuerpo).toEqual({ codigo: "x", opciones: { kerf_mm: 0.1 } });
  });

  it("el DXF por plancha manda el código, las planchas y el kerf", async () => {
    fetchFalso.mockResolvedValue(new Response("0\nSECTION"));
    const planchas = [{ ancho_mm: 300, alto_mm: 300, piezas: [{ id: "a", indice: 1, x_mm: 0, y_mm: 0, rotada: false }] }];
    await exportarDxfPlanchasLibre("x", planchas, { kerf_mm: 0.2 });
    expect(llamada().url).toBe("http://sandbox.test/dxf/planchas");
    expect(llamada().cuerpo).toEqual({ codigo: "x", planchas, opciones: { kerf_mm: 0.2 } });
  });

  it("un acomodo inválido trae sus errores", async () => {
    fetchFalso.mockResolvedValue(
      respuesta(
        {
          detail: {
            codigo: "acomodo_invalido",
            mensaje: "El acomodo en planchas no es válido.",
            errores: [{ campo: "planchas", mensaje: "Falta colocar la copia 1 de «a»." }],
          },
        },
        422,
      ),
    );
    const e = await errorDe(exportarDxfPlanchasLibre("x", []));
    expect(e.codigo).toBe("acomodo_invalido");
    expect(e.errores).toEqual([{ campo: "planchas", mensaje: "Falta colocar la copia 1 de «a»." }]);
  });

  it("el render vuelve como data URL", async () => {
    fetchFalso.mockResolvedValue(respuesta({ png_base64: "iVBORw0KGgo=" }));
    expect(await renderizar({ glb_base64: "Z2xURg==" })).toBe("data:image/png;base64,iVBORw0KGgo=");
  });

  it("una referencia inexistente es null y la ruta se codifica por tramos", async () => {
    fetchFalso.mockResolvedValue(respuesta({ detail: { codigo: "referencia_desconocida", mensaje: "no" } }, 404));
    expect(await leerReferencia("plugins/a b.md")).toBeNull();
    expect(llamada().url).toBe("http://sandbox.test/referencias/plugins/a%20b.md");
  });
});
