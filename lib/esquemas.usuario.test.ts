import { describe, expect, it } from "vitest";
import { esquemaFijarCorreo, esquemaNuevoUsuario } from "./esquemas";

const base = { usuario: "carla", nombre: "Carla Mendoza", rol: "logistica", correo: "" };

describe("esquemaNuevoUsuario", () => {
  it("acepta el alta sin correo y normaliza el usuario", () => {
    const r = esquemaNuevoUsuario.parse({ ...base, usuario: "  Carla.M " });
    expect(r.usuario).toBe("carla.m");
    expect(r.correo).toBe("");
  });

  it("normaliza el correo", () => {
    const r = esquemaNuevoUsuario.parse({ ...base, correo: " Carla@Ejemplo.COM " });
    expect(r.correo).toBe("carla@ejemplo.com");
  });

  it.each(["ab", "con espacio", "_empieza", "x".repeat(31), "ñandú"])("rechaza el usuario %j", (usuario) => {
    expect(esquemaNuevoUsuario.safeParse({ ...base, usuario }).success).toBe(false);
  });

  it("rechaza un rol que no existe y un correo mal escrito", () => {
    expect(esquemaNuevoUsuario.safeParse({ ...base, rol: "gerencia" }).success).toBe(false);
    expect(esquemaNuevoUsuario.safeParse({ ...base, correo: "sin-arroba" }).success).toBe(false);
  });

  it("exige un nombre", () => {
    expect(esquemaNuevoUsuario.safeParse({ ...base, nombre: " " }).success).toBe(false);
  });
});

describe("esquemaFijarCorreo", () => {
  const id = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

  it("acepta un correo válido", () => {
    expect(esquemaFijarCorreo.parse({ id, correo: " A@B.co " }).correo).toBe("a@b.co");
  });

  it("no acepta vacío ni un id que no es uuid", () => {
    expect(esquemaFijarCorreo.safeParse({ id, correo: "" }).success).toBe(false);
    expect(esquemaFijarCorreo.safeParse({ id: "1", correo: "a@b.co" }).success).toBe(false);
  });
});
