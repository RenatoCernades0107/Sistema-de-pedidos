import { describe, expect, it, vi } from "vitest";

// `sesion.ts` importa el cliente de Supabase, que lee `next/headers`: aquí solo se
// prueba la función pura.
vi.mock("./supabase-servidor", () => ({ clienteServidor: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("react", async (original) => ({ ...(await original<typeof import("react")>()), cache: <T,>(f: T) => f }));

import { bienvenidaPendiente } from "./sesion";

describe("bienvenidaPendiente", () => {
  it("no hay nada pendiente con contraseña propia y correo registrado", () => {
    expect(bienvenidaPendiente({ debeCambiarPassword: false, debeRegistrarCorreo: false })).toBe(false);
  });

  it.each([
    [true, false],
    [false, true],
    [true, true],
  ])("queda pendiente con cambio=%s, correo=%s", (debeCambiarPassword, debeRegistrarCorreo) => {
    expect(bienvenidaPendiente({ debeCambiarPassword, debeRegistrarCorreo })).toBe(true);
  });
});
