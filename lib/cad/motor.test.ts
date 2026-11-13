import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ErrorMotorCad,
  exportarDxf,
  exportarStep,
  generarDiseno,
  listarPlantillas,
  obtenerPlantilla,
} from "./motor";

const fetchFalso = vi.fn<typeof fetch>();

const respuesta = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** La petición que recibió el motor falso, ya desmenuzada. */
function llamada(n = 0) {
  const [url, init] = fetchFalso.mock.calls[n];
  return {
    url: String(url),
    metodo: init?.method ?? "GET",
    cabeceras: init?.headers as Record<string, string>,
    cuerpo: init?.body ? JSON.parse(String(init.body)) : undefined,
    cache: init?.cache,
  };
}

async function errorDe(promesa: Promise<unknown>): Promise<ErrorMotorCad> {
  try {
    await promesa;
  } catch (e) {
    expect(e).toBeInstanceOf(ErrorMotorCad);
    return e as ErrorMotorCad;
  }
  throw new Error("Se esperaba un ErrorMotorCad y la llamada terminó bien.");
}

beforeEach(() => {
  fetchFalso.mockReset();
  vi.stubGlobal("fetch", fetchFalso);
  vi.stubEnv("CAD_API_BASE_URL", "http://motor.test/");
  vi.stubEnv("CAD_API_KEY", "clave-secreta");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("transporte", () => {
  it("manda la clave, no cachea y no duplica la barra de la base", async () => {
    fetchFalso.mockResolvedValue(respuesta([]));
    await listarPlantillas();

    const { url, metodo, cabeceras, cache } = llamada();
    expect(url).toBe("http://motor.test/plantillas");
    expect(metodo).toBe("GET");
    expect(cabeceras["X-API-Key"]).toBe("clave-secreta");
    expect(cache).toBe("no-store");
  });

  it("sin clave no manda la cabecera (motor local)", async () => {
    vi.stubEnv("CAD_API_KEY", "");
    fetchFalso.mockResolvedValue(respuesta([]));
    await listarPlantillas();
    expect(llamada().cabeceras).not.toHaveProperty("X-API-Key");
  });

  it("sin CAD_API_BASE_URL falla sin tocar la red", async () => {
    vi.stubEnv("CAD_API_BASE_URL", "");
    const e = await errorDe(listarPlantillas());
    expect(e).toMatchObject({ codigo: "no_configurado", estado: 503 });
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it("convierte un fallo de red en un error del motor", async () => {
    fetchFalso.mockRejectedValue(new TypeError("fetch failed"));
    const e = await errorDe(listarPlantillas());
    expect(e).toMatchObject({ codigo: "sin_conexion", estado: 503 });
  });

  it("una respuesta 200 que no es JSON no revienta con un SyntaxError", async () => {
    fetchFalso.mockResolvedValue(new Response("<html>", { status: 200 }));
    const e = await errorDe(listarPlantillas());
    expect(e).toMatchObject({ codigo: "respuesta", estado: 502 });
  });
});

describe("plantillas", () => {
  const caja = { codigo: "caja", nombre: "Caja", familia: "cajas", version: 1 };

  it("lista las plantillas", async () => {
    fetchFalso.mockResolvedValue(respuesta([caja]));
    expect(await listarPlantillas()).toEqual([caja]);
  });

  it("pide una plantilla escapando el código", async () => {
    fetchFalso.mockResolvedValue(respuesta(caja));
    expect(await obtenerPlantilla("caja/rara")).toEqual(caja);
    expect(llamada().url).toBe("http://motor.test/plantillas/caja%2Frara");
  });

  it("devuelve null si el motor no la conoce", async () => {
    fetchFalso.mockResolvedValue(respuesta({ detail: "Not Found" }, 404));
    expect(await obtenerPlantilla("nada")).toBeNull();
  });

  it("no se traga los demás errores", async () => {
    fetchFalso.mockResolvedValue(respuesta({ detail: "Unauthorized" }, 401));
    const e = await errorDe(obtenerPlantilla("caja"));
    expect(e).toMatchObject({ codigo: "no_autorizado", estado: 401 });
    expect(e.message).not.toContain("Unauthorized");
  });
});

describe("generarDiseno", () => {
  it("manda plantilla y parámetros y devuelve el resultado", async () => {
    const resultado = { plantilla: "caja", piezas: [], validaciones: [] };
    fetchFalso.mockResolvedValue(respuesta(resultado));

    expect(await generarDiseno("caja", { largo: 200 })).toEqual(resultado);
    const { url, metodo, cuerpo, cabeceras } = llamada();
    expect(url).toBe("http://motor.test/generar");
    expect(metodo).toBe("POST");
    expect(cabeceras["Content-Type"]).toBe("application/json");
    expect(cuerpo).toEqual({ plantilla: "caja", parametros: { largo: 200 } });
  });

  it("422: conserva el código, el mensaje y los errores por campo", async () => {
    fetchFalso.mockResolvedValue(
      respuesta(
        {
          detail: {
            codigo: "parametros_invalidos",
            mensaje: "Revisa las medidas.",
            errores: [{ campo: "largo", mensaje: "Debe ser mayor que 50." }, { basura: true }],
          },
        },
        422,
      ),
    );
    const e = await errorDe(generarDiseno("caja", { largo: 1 }));
    expect(e).toMatchObject({ codigo: "parametros_invalidos", estado: 422 });
    expect(e.message).toBe("Revisa las medidas.");
    expect(e.errores).toEqual([{ campo: "largo", mensaje: "Debe ser mayor que 50." }]);
  });

  it("422 de esquema (lista de pydantic): saca el campo de `loc`", async () => {
    fetchFalso.mockResolvedValue(
      respuesta(
        { detail: [{ loc: ["body", "parametros", "largo"], msg: "Input should be a number" }] },
        422,
      ),
    );
    const e = await errorDe(generarDiseno("caja", { largo: "x" }));
    expect(e.codigo).toBe("parametros_invalidos");
    expect(e.errores).toEqual([{ campo: "largo", mensaje: "Input should be a number" }]);
  });

  it("500: fallo de geometría, sin errores por campo", async () => {
    fetchFalso.mockResolvedValue(
      respuesta({ detail: { codigo: "geometria", mensaje: "El radio no cabe." } }, 500),
    );
    const e = await errorDe(generarDiseno("caja", {}));
    expect(e).toMatchObject({ codigo: "geometria", estado: 500 });
    expect(e.message).toBe("El radio no cabe.");
    expect(e.errores).toBeUndefined();
  });

  it("404: plantilla desconocida", async () => {
    fetchFalso.mockResolvedValue(respuesta({ detail: "Not Found" }, 404));
    const e = await errorDe(generarDiseno("nada", {}));
    expect(e).toMatchObject({ codigo: "plantilla_desconocida", estado: 404 });
  });

  it("un error sin cuerpo JSON cae en el mensaje genérico", async () => {
    fetchFalso.mockResolvedValue(new Response("Bad Gateway", { status: 502 }));
    const e = await errorDe(generarDiseno("caja", {}));
    expect(e).toMatchObject({ codigo: "motor", estado: 502 });
  });
});

describe("exportaciones", () => {
  const bytes = new TextEncoder().encode("0\nSECTION\n");

  it("DXF: devuelve los bytes y solo manda opciones si las hay", async () => {
    fetchFalso.mockImplementation(async () => new Response(bytes, { status: 200 }));

    const dxf = await exportarDxf("caja", { largo: 200 });
    expect(new Uint8Array(dxf)).toEqual(bytes);
    expect(llamada(0).url).toBe("http://motor.test/dxf");
    expect(llamada(0).cuerpo).toEqual({ plantilla: "caja", parametros: { largo: 200 } });

    await exportarDxf("caja", { largo: 200 }, { kerf_mm: 0.1, separacion_mm: 5 });
    expect(llamada(1).cuerpo.opciones).toEqual({ kerf_mm: 0.1, separacion_mm: 5 });
  });

  it("STEP: devuelve los bytes", async () => {
    fetchFalso.mockImplementation(async () => new Response(bytes, { status: 200 }));
    const step = await exportarStep("caja", {});
    expect(step.byteLength).toBe(bytes.byteLength);
    expect(llamada().url).toBe("http://motor.test/step");
  });

  it("propaga los errores del motor", async () => {
    fetchFalso.mockResolvedValue(
      respuesta({ detail: { codigo: "geometria", mensaje: "No se pudo acostar." } }, 500),
    );
    const e = await errorDe(exportarDxf("caja", {}));
    expect(e.codigo).toBe("geometria");
  });
});
