import { describe, expect, it } from "vitest";
import {
  avisoCambioAjeno,
  cambioAjenoDesde,
  fechaVersion,
  limpiarNombreVersion,
  nombreAutor,
  ordenarVersiones,
  soloDe,
  textoOrigen,
  ultimaVersionDe,
  versionActual,
  type FirmaVersion,
} from "./historial";

const ANA = "ana";
const CARLA = "carla";

const v = (version: number, creadoPor: string | null, autorNombre = ""): FirmaVersion => ({
  version,
  creadoPor,
  autorNombre,
});

const historial = [
  v(1, ANA, "Ana Torres"),
  v(2, ANA, "Ana Torres"),
  v(3, CARLA, "Carla Ruiz"),
  v(4, CARLA, "Carla Ruiz"),
];

describe("versiones de un diseño", () => {
  it("la actual es la de número más alto, sin importar el orden", () => {
    expect(versionActual([v(3, ANA), v(5, CARLA), v(4, ANA)])?.version).toBe(5);
    expect(versionActual([])).toBeNull();
    expect(ordenarVersiones([v(1, ANA), v(3, ANA), v(2, ANA)]).map((x) => x.version)).toEqual([3, 2, 1]);
  });

  it("encuentra la última versión mía", () => {
    expect(ultimaVersionDe(historial, ANA)?.version).toBe(2);
    expect(ultimaVersionDe(historial, CARLA)?.version).toBe(4);
    expect(ultimaVersionDe(historial, "miguel")).toBeNull();
    expect(soloDe(historial, ANA).map((x) => x.version)).toEqual([1, 2]);
  });

  it("dice Tú para quien mira y el nombre para los demás", () => {
    expect(nombreAutor(historial[0], ANA)).toBe("Tú");
    expect(nombreAutor(historial[2], ANA)).toBe("Carla Ruiz");
    expect(nombreAutor(v(9, null, ""), ANA)).toBe("Alguien");
  });

  it("textos de origen", () => {
    expect(textoOrigen({ origen: "formulario", restauradaDe: null })).toBe("Formulario");
    expect(textoOrigen({ origen: "chat", restauradaDe: null })).toBe("Asistente");
    expect(textoOrigen({ origen: "restauracion", restauradaDe: 8 })).toBe("Restaurada de v8");
  });
});

describe("aviso de cambio ajeno", () => {
  it("avisa si la actual es de otra persona y tengo una mía", () => {
    expect(avisoCambioAjeno(historial, ANA)).toMatchObject({ autor: "Carla", version: 4, mia: { version: 2 } });
  });

  it("no avisa si la actual es mía o si nunca guardé", () => {
    expect(avisoCambioAjeno(historial, CARLA)).toBeNull();
    expect(avisoCambioAjeno(historial, "miguel")).toBeNull();
    expect(avisoCambioAjeno([], ANA)).toBeNull();
  });

  it("edición en paralelo: la más nueva ajena después de la que tenía", () => {
    expect(cambioAjenoDesde(historial, 2, ANA)?.version).toBe(4);
    expect(cambioAjenoDesde(historial, 4, ANA)).toBeNull();
    // Mis propias versiones (asistente, otra pestaña) no cuentan.
    expect(cambioAjenoDesde(historial, 0, ANA)?.creadoPor).toBe(CARLA);
    expect(cambioAjenoDesde(historial, 2, CARLA)).toBeNull();
  });
});

describe("fecha de una versión", () => {
  // 16 nov 2026, 15:00 en Lima (UTC-5).
  const ahora = new Date("2026-11-16T20:00:00Z");

  it("relativa si es de hace poco", () => {
    expect(fechaVersion("2026-11-16T19:59:30Z", ahora)).toBe("hace un momento");
    expect(fechaVersion("2026-11-16T19:35:00Z", ahora)).toBe("hace 25 min");
  });

  it("hoy, ayer y fecha, en hora de Lima", () => {
    expect(fechaVersion("2026-11-16T14:05:00Z", ahora)).toBe("hoy 09:05");
    // 02:00 UTC del 16 todavía es el 15 en Lima.
    expect(fechaVersion("2026-11-16T02:00:00Z", ahora)).toBe("ayer 21:00");
    expect(fechaVersion("2026-11-03T15:30:00Z", ahora)).toBe("3 nov 10:30");
    expect(fechaVersion("2025-12-31T15:30:00Z", ahora)).toBe("31 dic 2025 10:30");
  });
});

describe("nombre de una versión", () => {
  it("recorta, junta espacios y acota a 80", () => {
    expect(limpiarNombreVersion("  Aprobada   por el cliente ")).toBe("Aprobada por el cliente");
    expect(limpiarNombreVersion("   ")).toBeNull();
    expect(limpiarNombreVersion("x".repeat(100))).toHaveLength(80);
  });
});
