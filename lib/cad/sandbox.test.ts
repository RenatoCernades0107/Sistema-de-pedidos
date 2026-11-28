import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ErrorSandboxCad,
  disenoLibreActivo,
  ejecutarCodigo,
  exportarDxfLibre,
  exportarDxfPlanchasLibre,
  exportarDxfProyecto,
  leerReferencia,
  olvidarSaludSandbox,
  renderizar,
  verificarSandbox,
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
  olvidarSaludSandbox();
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

  it("los contornos (logos) van con cada llamada que manda el código, y sin ellos el cuerpo no cambia", async () => {
    const logo = { ancho_mm: 100, alto_mm: 50, trazos: ["M 0 0 L 1 0 Z"] };
    fetchFalso.mockImplementation(async () => respuesta({}));
    await ejecutarCodigo("piezas = []");
    expect(llamada(0).cuerpo).toEqual({ codigo: "piezas = []" });
    await ejecutarCodigo("piezas = []", {});
    expect(llamada(1).cuerpo).toEqual({ codigo: "piezas = []" });
    await ejecutarCodigo("piezas = []", { logo });
    expect(llamada(2).cuerpo).toEqual({ codigo: "piezas = []", contornos: { logo } });
    await exportarDxfLibre("c", { kerf_mm: 0.1 }, { logo });
    expect(llamada(3).cuerpo).toEqual({ codigo: "c", opciones: { kerf_mm: 0.1 }, contornos: { logo } });
    await exportarDxfPlanchasLibre("c", [], undefined, { logo });
    expect(llamada(4).cuerpo.contornos).toEqual({ logo });
  });

  it("el DXF suelto manda `solo` solo si nombra alguna copia", async () => {
    fetchFalso.mockImplementation(async () => respuesta({}));
    await exportarDxfLibre("c", undefined, undefined, { frente: [2, 3] });
    expect(llamada(0).cuerpo).toEqual({ codigo: "c", solo: { frente: [2, 3] } });
    await exportarDxfLibre("c", undefined, undefined, {});
    expect(llamada(1).cuerpo).toEqual({ codigo: "c" });
  });

  it("el DXF de proyecto manda los diseños (código con sus contornos, o plantilla) y las planchas", async () => {
    const logo = { ancho_mm: 100, alto_mm: 50, trazos: ["M 0 0 L 1 0 Z"] };
    const plancha = { ancho_mm: 1220, alto_mm: 2440, piezas: [{ id: "d1__frente", indice: 1, x_mm: 10, y_mm: 10, rotada: false }] };
    fetchFalso.mockImplementation(async () => new Response("0\nSECTION\n", { status: 200 }));
    const dxf = await exportarDxfProyecto(
      [
        { ref: "d1", nombre: "Logo", codigo: "piezas = []", contornos: { logo } },
        { ref: "d2", nombre: "Caja", plantilla: "caja", parametros: { largo: 150 } },
      ],
      [plancha],
      { kerf_mm: 0.2 },
    );
    expect(dxf.byteLength).toBeGreaterThan(0);
    const l = llamada(0);
    expect(l.url).toBe("http://sandbox.test/dxf/proyecto");
    expect(l.cuerpo).toEqual({
      disenos: [
        { ref: "d1", nombre: "Logo", codigo: "piezas = []", contornos: { logo } },
        { ref: "d2", nombre: "Caja", plantilla: "caja", parametros: { largo: 150 } },
      ],
      planchas: [plancha],
      opciones: { kerf_mm: 0.2 },
    });
  });

  it("el DXF de proyecto no manda `contornos` vacíos", async () => {
    fetchFalso.mockImplementation(async () => new Response("0\nSECTION\n", { status: 200 }));
    await exportarDxfProyecto([{ ref: "d1", codigo: "piezas = []", contornos: {} }], []);
    expect(llamada(0).cuerpo.disenos[0]).toEqual({ ref: "d1", codigo: "piezas = []" });
  });

  it("un acomodo inválido del proyecto trae sus errores", async () => {
    fetchFalso.mockResolvedValue(
      respuesta(
        { detail: { codigo: "acomodo_invalido", mensaje: "No cuadra.", errores: [{ campo: "planchas.0", mensaje: "Se sale." }] } },
        422,
      ),
    );
    const e = await errorDe(exportarDxfProyecto([{ ref: "d1", codigo: "x" }], []));
    expect(e).toMatchObject({ codigo: "acomodo_invalido", estado: 422 });
    expect(e.errores).toEqual([{ campo: "planchas.0", mensaje: "Se sale." }]);
  });

  it("el render por código manda los contornos; por GLB no", async () => {
    const logo = { ancho_mm: 100, alto_mm: 50, trazos: ["M 0 0 L 1 0 Z"] };
    fetchFalso.mockImplementation(async () => respuesta({ png_base64: "AAAA" }));
    await renderizar({ codigo: "c", contornos: { logo } });
    expect(llamada(0).cuerpo).toEqual({ codigo: "c", contornos: { logo } });
    await renderizar({ glb_base64: "Z2xi" });
    expect(llamada(1).cuerpo).toEqual({ glb_base64: "Z2xi" });
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

  it("un 404 de FastAPI (ruta que no existe) dice que la URL es de otro servicio", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchFalso.mockResolvedValue(respuesta({ detail: "Not Found" }, 404));
    const e = await errorDe(ejecutarCodigo("x"));
    expect(e.codigo).toBe("ruta_inexistente");
    expect(e.estado).toBe(404);
    expect(e.message).toContain("/ejecutar");
    expect(e.message).toContain("CAD_SANDBOX_BASE_URL");
  });

  it("si la ruta de referencias no existe, no se confunde con una referencia que falta", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchFalso.mockResolvedValue(respuesta({ detail: "Not Found" }, 404));
    expect((await errorDe(leerReferencia("SKILL.md"))).codigo).toBe("ruta_inexistente");
  });

  it("un 401 apunta a la clave del sandbox", async () => {
    fetchFalso.mockResolvedValue(respuesta({ detail: "Clave inválida" }, 401));
    const e = await errorDe(ejecutarCodigo("x"));
    expect(e.codigo).toBe("no_autorizado");
    expect(e.message).toContain("CAD_SANDBOX_API_KEY");
  });

  it("una referencia inexistente es null y la ruta se codifica por tramos", async () => {
    fetchFalso.mockResolvedValue(respuesta({ detail: { codigo: "referencia_desconocida", mensaje: "no" } }, 404));
    expect(await leerReferencia("plugins/a b.md")).toBeNull();
    expect(llamada().url).toBe("http://sandbox.test/referencias/plugins/a%20b.md");
  });
});

describe("salud", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("ok cuando /salud dice que es el sandbox", async () => {
    fetchFalso.mockResolvedValue(respuesta({ ok: true, version: "0.1.0", servicio: "sandbox" }));
    expect(await verificarSandbox()).toEqual({ ok: true });
    expect(llamada().url).toBe("http://sandbox.test/salud");
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });

  it("detecta que la URL es la del motor", async () => {
    fetchFalso.mockResolvedValue(respuesta({ ok: true, version: "0.1.0", servicio: "motor" }));
    const r = await verificarSandbox();
    expect(r.ok).toBe(false);
    expect(!r.ok && r.motivo).toContain("motor");
  });

  it("sin `servicio` (despliegue anterior) mira si existe /ejecutar", async () => {
    fetchFalso
      .mockResolvedValueOnce(respuesta({ ok: true, version: "0.1.0" }))
      .mockResolvedValueOnce(respuesta({ detail: "Not Found" }, 404));
    const r = await verificarSandbox();
    expect(r.ok).toBe(false);
    expect(!r.ok && r.motivo).toContain("/ejecutar");
    expect(llamada(1)).toMatchObject({ url: "http://sandbox.test/ejecutar", metodo: "POST" });
  });

  it("sin `servicio` y con /ejecutar que existe (401 o 422) está bien", async () => {
    fetchFalso
      .mockResolvedValueOnce(respuesta({ ok: true, version: "0.1.0" }))
      .mockResolvedValueOnce(respuesta({ detail: { codigo: "parametros_invalidos" } }, 422));
    expect(await verificarSandbox()).toEqual({ ok: true });
  });

  it("sin conexión no está disponible", async () => {
    fetchFalso.mockRejectedValue(new TypeError("fetch failed"));
    expect((await verificarSandbox()).ok).toBe(false);
  });

  it("guarda el resultado un rato", async () => {
    fetchFalso.mockResolvedValue(respuesta({ ok: true, servicio: "sandbox" }));
    await verificarSandbox();
    await verificarSandbox();
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });

  it("sin URL configurada ni llama", async () => {
    vi.stubEnv("CAD_SANDBOX_BASE_URL", "");
    expect((await verificarSandbox()).ok).toBe(false);
    expect(fetchFalso).not.toHaveBeenCalled();
  });
});
