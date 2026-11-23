import { describe, expect, it } from "vitest";
import { esquemaCambioPassword } from "./esquemas";
import { evaluarPassword } from "./fortaleza-password";

describe("evaluarPassword", () => {
  it.each(["", "abc", "abcdefg", "12345678", "aaaaaaaaaaaa", "Password1234", "Plexi2026-Nueva"])(
    "%j es insegura (roja)",
    (p) => {
      expect(evaluarPassword(p).nivel).toBe("insegura");
    },
  );

  it.each(["Zorrazul1", "mi-clave-larga-sin-mayus1", "MiClaveLargaSinNumero"])(
    "%j todavía le falta algo (amarilla)",
    (p) => {
      const f = evaluarPassword(p);
      expect(f.nivel).toBe("incompleta");
      expect(f.motivo).toMatch(/^Falta: /);
    },
  );

  it.each(["Zorro-Azul-4712", "kT9mPq2xLw", "Cuaderno Verde 88"])("%j es segura (verde)", (p) => {
    const f = evaluarPassword(p);
    expect(f.nivel).toBe("segura");
    expect(f.motivo).toBeNull();
  });

  it("acepta letras con tilde y eñe como mayúscula o minúscula", () => {
    expect(evaluarPassword("ÁrbolNuevo7x").nivel).toBe("segura");
  });
});

describe("esquemaCambioPassword", () => {
  const con = (password: string, confirmacion = password) =>
    esquemaCambioPassword.safeParse({ password, confirmacion });

  it("acepta una contraseña segura repetida igual", () => {
    expect(con("Zorro-Azul-4712").success).toBe(true);
  });

  it("rechaza lo que la barra marca como no segura, diciendo qué falta", () => {
    const r = con("zorroazul");
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toMatch(/^La contraseña no es segura\. /);
  });

  it("rechaza las que pasan de 72 caracteres", () => {
    expect(con(`Aa1${"x-y".repeat(30)}`).success).toBe(false);
  });

  it("avisa si no coinciden, solo cuando la contraseña ya es segura", () => {
    const r = con("Zorro-Azul-4712", "Zorro-Azul-4713");
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toBe("Las dos contraseñas no coinciden");
  });
});
