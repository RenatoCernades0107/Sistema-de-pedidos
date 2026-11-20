import { describe, expect, it } from "vitest";
import { rutaInternaSegura } from "./ruta-segura";

describe("rutaInternaSegura", () => {
  it.each([
    ["/pedidos"],
    ["/pedidos?ver=mios"],
    ["/pedidos/PED-0001#notas"],
    ["/"],
  ])("deja pasar la ruta interna %s", (ruta) => {
    expect(rutaInternaSegura(ruta)).toBe(ruta);
  });

  it.each([
    ["//evil.com"],
    ["//evil.com/pedidos"],
    ["/\\evil.com"],
    ["/\\/evil.com"],
    ["https://evil.com"],
    ["http://evil.com/pedidos"],
    ["javascript:alert(1)"],
    ["evil.com"],
    ["/\t/evil.com"],
    ["/\n/evil.com"],
    ["/pedidos\r\nSet-Cookie: x=1"],
  ])("descarta el destino peligroso %j", (ruta) => {
    expect(rutaInternaSegura(ruta)).toBe("/");
  });

  it("vacío, nulo o indefinido van a la raíz", () => {
    expect(rutaInternaSegura("")).toBe("/");
    expect(rutaInternaSegura(null)).toBe("/");
    expect(rutaInternaSegura(undefined)).toBe("/");
  });
});
