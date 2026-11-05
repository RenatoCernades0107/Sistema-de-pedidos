import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  camposExistentes,
  configOdoo,
  ejecutar,
  enlaceOdoo,
  ErrorOdoo,
  errorDeOdoo,
  modeloExiste,
  ODOO_NO_CONFIGURADO,
  reiniciarCacheOdoo,
} from "./rpc";

const ENV = {
  ODOO_URL: "https://odoo.ejemplo.test/",
  ODOO_DB: "plexiacril",
  ODOO_USERNAME: "bot@plexiacril.test",
  ODOO_PASSWORD: "clave",
};

/** Un `fetch` que contesta según el servicio y el método de la JSON-RPC. */
function odooQueResponde(responder: (params: { service: string; method: string; args: unknown[] }) => unknown) {
  const llamadas: { url: string; cuerpo: { params: { service: string; method: string; args: unknown[] } } }[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const cuerpo = JSON.parse(String(init.body));
    llamadas.push({ url, cuerpo });
    const r = responder(cuerpo.params);
    if (r instanceof Response) return r;
    return Response.json(r && typeof r === "object" && "error" in r ? { jsonrpc: "2.0", ...r } : { jsonrpc: "2.0", result: r });
  });
  vi.stubGlobal("fetch", fetch);
  return llamadas;
}

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  reiniciarCacheOdoo();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("configuración", () => {
  it("quita la barra final de la URL", () => {
    expect(configOdoo()?.url).toBe("https://odoo.ejemplo.test");
  });

  it("sin alguna variable no hay configuración, y ejecutar lo dice", async () => {
    vi.stubEnv("ODOO_PASSWORD", "");
    expect(configOdoo()).toBeNull();
    await expect(ejecutar("res.partner", "search", [[]])).rejects.toThrow(ODOO_NO_CONFIGURADO);
  });

  it("arma el enlace para abrir un registro en Odoo", () => {
    expect(enlaceOdoo("sale.order", 55)).toBe(
      "https://odoo.ejemplo.test/web#id=55&model=sale.order&view_type=form",
    );
  });
});

describe("ejecutar", () => {
  it("se autentica una vez y manda execute_kw con la forma exacta de la API externa", async () => {
    const llamadas = odooQueResponde(({ service, method }) =>
      service === "common" && method === "authenticate" ? 7 : [{ id: 1 }],
    );

    await ejecutar("res.partner", "search_read", [[["vat", "=", "1"]]], { fields: ["name"], limit: 1 });
    await ejecutar("res.partner", "search_read", [[]], {});

    expect(llamadas.map((l) => l.url)).toEqual(Array(3).fill("https://odoo.ejemplo.test/jsonrpc"));
    expect(llamadas[0].cuerpo.params).toEqual({
      service: "common",
      method: "authenticate",
      args: ["plexiacril", "bot@plexiacril.test", "clave", {}],
    });
    expect(llamadas[1].cuerpo.params).toEqual({
      service: "object",
      method: "execute_kw",
      args: [
        "plexiacril", 7, "clave", "res.partner", "search_read",
        [[["vat", "=", "1"]]],
        { fields: ["name"], limit: 1 },
      ],
    });
    // El uid quedó en caché: la tercera llamada ya no se autentica.
    expect(llamadas[2].cuerpo.params.method).toBe("execute_kw");
  });

  it("credenciales rechazadas: un mensaje que se entiende, y se vuelve a intentar la próxima vez", async () => {
    const llamadas = odooQueResponde(() => false);
    await expect(ejecutar("res.partner", "search", [[]])).rejects.toThrow(/rechazó el usuario o la API key/);
    await expect(ejecutar("res.partner", "search", [[]])).rejects.toThrow(ErrorOdoo);
    expect(llamadas.filter((l) => l.cuerpo.params.method === "authenticate")).toHaveLength(2);
  });

  it("los errores de validación de Odoo pasan con su texto", async () => {
    odooQueResponde(({ method }) =>
      method === "authenticate"
        ? 7
        : { error: { code: 200, message: "Odoo Server Error", data: { name: "odoo.exceptions.ValidationError", message: "El RUC no es válido." } } },
    );
    await expect(ejecutar("res.partner", "create", [{}])).rejects.toThrow("El RUC no es válido.");
  });

  it("HTTP de error, red caída y tiempo agotado tienen su propio mensaje", async () => {
    odooQueResponde(({ method }) => (method === "authenticate" ? 7 : new Response("x", { status: 502 })));
    await expect(ejecutar("res.partner", "search", [[]])).rejects.toThrow("Odoo respondió 502");

    reiniciarCacheOdoo();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    await expect(ejecutar("res.partner", "search", [[]])).rejects.toThrow("No se pudo conectar con Odoo.");

    reiniciarCacheOdoo();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("timeout", "TimeoutError"); }));
    await expect(ejecutar("res.partner", "search", [[]])).rejects.toThrow("no respondió a tiempo");
  });

  it("una respuesta que no es JSON sugiere revisar la URL", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>login</html>")));
    await expect(ejecutar("res.partner", "search", [[]])).rejects.toThrow(/La URL es la correcta/);
  });
});

describe("lo que cambia entre versiones", () => {
  it("pide solo los campos que existen, y pregunta una sola vez por modelo", async () => {
    const llamadas = odooQueResponde(({ method }) =>
      method === "authenticate" ? 7 : { name: {}, phone: {}, vat: {} },
    );
    expect(await camposExistentes("res.partner", ["name", "mobile", "vat"])).toEqual(["name", "vat"]);
    expect(await camposExistentes("res.partner", ["phone"])).toEqual(["phone"]);
    expect(llamadas.filter((l) => l.cuerpo.params.method === "execute_kw")).toHaveLength(1);
  });

  it("sabe si un módulo opcional está instalado", async () => {
    odooQueResponde(({ method, args }) => {
      if (method === "authenticate") return 7;
      const dominio = (args[5] as unknown[][])[0] as [string, string, string][];
      return dominio[0][2] === "l10n_latam.identification.type" ? 1 : 0;
    });
    expect(await modeloExiste("l10n_latam.identification.type")).toBe(true);
    expect(await modeloExiste("no.existe")).toBe(false);
  });
});

describe("errorDeOdoo", () => {
  it("traduce los tipos de excepción conocidos", () => {
    expect(errorDeOdoo({ data: { name: "odoo.exceptions.AccessError", message: "Sin acceso a Ventas" } }).message).toBe(
      "El usuario de Odoo no tiene permiso para esto: Sin acceso a Ventas",
    );
    expect(errorDeOdoo({ data: { name: "odoo.exceptions.MissingError" } }).message).toMatch(/ya no existe/);
    expect(errorDeOdoo({ message: "Odoo Server Error" }).message).toBe("Odoo devolvió un error: Odoo Server Error");
  });
});
