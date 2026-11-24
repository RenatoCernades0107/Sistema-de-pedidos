import { afterEach, describe, expect, it, vi } from "vitest";
import { consultarRuc, ErrorRuc, rucEnRegla } from "./ruc";

const respuesta = {
  ruc: "20100047218",
  razon_social: "BANCO DE CREDITO DEL PERU",
  estado: "ACTIVO",
  condicion: "HABIDO",
  direccion: "JR. CENTENARIO NRO 156 URB. LADERAS DE MELGAREJO",
  ubigeo: "150114",
  source: "SUNAT",
  as_of: "2026-05-30",
};

afterEach(() => vi.unstubAllGlobals());

describe("consultarRuc", () => {
  it("devuelve los datos de openruc", async () => {
    const f = vi.fn().mockResolvedValue(Response.json(respuesta));
    vi.stubGlobal("fetch", f);
    expect(await consultarRuc("20100047218")).toEqual(respuesta);
    expect(f.mock.calls[0][0]).toBe("https://openruc.com/api/ruc/20100047218");
  });

  it("404 es 'no encontrado'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 404 })));
    await expect(consultarRuc("20100047218")).rejects.toMatchObject({ status: 404 });
  });

  it("una caída del servicio es un 502 con mensaje", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("red")));
    await expect(consultarRuc("20100047218")).rejects.toBeInstanceOf(ErrorRuc);
  });
});

describe("rucEnRegla", () => {
  it("solo ACTIVO y HABIDO está en regla", () => {
    expect(rucEnRegla(respuesta)).toBe(true);
    expect(rucEnRegla({ estado: "BAJA DEFINITIVA", condicion: "HABIDO" })).toBe(false);
    expect(rucEnRegla({ estado: "ACTIVO", condicion: "NO HABIDO" })).toBe(false);
  });
});
