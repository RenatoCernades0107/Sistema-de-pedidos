import { afterEach, describe, expect, it, vi } from "vitest";
import { CLAVE_DE_DESARROLLO, claveDeLogin } from "./login-secreto";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("claveDeLogin", () => {
  it("usa LOGIN_SECRET cuando está definida", () => {
    vi.stubEnv("LOGIN_SECRET", "una-clave-larga-de-prueba");
    vi.stubEnv("NODE_ENV", "production");
    expect(claveDeLogin()).toBe("una-clave-larga-de-prueba");
  });

  it("en desarrollo, sin variable, cae a la clave de seed.sql", () => {
    vi.stubEnv("LOGIN_SECRET", "");
    vi.stubEnv("NODE_ENV", "development");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(claveDeLogin()).toBe(CLAVE_DE_DESARROLLO);
  });

  it("en producción, sin variable, falla cerrado", () => {
    vi.stubEnv("LOGIN_SECRET", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(claveDeLogin()).toBeNull();
  });
});
