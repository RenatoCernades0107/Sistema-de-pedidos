import { describe, expect, it } from "vitest";
import { esquemaCorreoRecuperacion } from "./esquemas";

describe("esquemaCorreoRecuperacion", () => {
  it("normaliza espacios y mayúsculas", () => {
    const r = esquemaCorreoRecuperacion.parse({ correo: "  Ana.Perez@Gmail.COM " });
    expect(r.correo).toBe("ana.perez@gmail.com");
  });

  it.each(["", "   ", "sin-arroba", "a@b", "a b@c.com"])("rechaza %j", (correo) => {
    expect(esquemaCorreoRecuperacion.safeParse({ correo }).success).toBe(false);
  });
});
