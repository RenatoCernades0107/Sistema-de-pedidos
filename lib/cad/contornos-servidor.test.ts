import { describe, expect, it, vi } from "vitest";
import type { AdjuntoCad } from "./adjuntos";

// `contornos-servidor` importa Supabase, que no se carga sin sesión; solo se prueba `buscarPdf`.
vi.mock("@/lib/supabase-servidor", () => ({ clienteServidor: vi.fn() }));
import { buscarPdf } from "./contornos-servidor";

const a = (nombre: string, mime: AdjuntoCad["mime"], n: number): AdjuntoCad => ({
  ruta: `00000000-0000-4000-8000-000000000000/00000000-0000-4000-8000-00000000000${n}.${mime === "application/pdf" ? "pdf" : "png"}`,
  nombre,
  mime,
  tamano: 100,
});

describe("buscarPdf", () => {
  const todos = [a("Plano.PDF", "application/pdf", 1), a("foto.png", "image/png", 2), a("plano.pdf", "application/pdf", 3)];

  it("encuentra el PDF por nombre sin distinguir mayúsculas, y toma el más reciente", () => {
    expect(buscarPdf(todos, " PLANO.pdf ")?.ruta).toBe(todos[2].ruta);
  });

  it("una imagen con ese nombre no cuenta", () => {
    expect(buscarPdf(todos, "foto.png")).toBeUndefined();
  });

  it("sin coincidencia, undefined", () => {
    expect(buscarPdf(todos, "otro.pdf")).toBeUndefined();
    expect(buscarPdf([], "plano.pdf")).toBeUndefined();
  });
});
