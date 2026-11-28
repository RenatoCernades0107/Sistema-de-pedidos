import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GrupoPlancha } from "@/lib/cortes/catalogo";
import type { DisenoCad, PiezaCad } from "./tipos";

// Todo lo que toca la red o la base se sustituye: aquí se prueba qué se exige y cómo se arma el corte.
const m = vi.hoisted(() => ({
  obtenerProyecto: vi.fn(),
  obtenerMaterialDiseno: vi.fn(),
  obtenerMaterialesPorCopia: vi.fn(),
  obtenerVersionLibre: vi.fn(),
  contornosDeDiseno: vi.fn(),
  generarDiseno: vi.fn(),
  ejecutarCodigo: vi.fn(),
  catalogoParaDiseno: vi.fn(),
  disenoLibreActivo: vi.fn(),
}));

vi.mock("@/lib/supabase-servidor", () => ({ clienteServidor: vi.fn() }));
vi.mock("./proyectos-servidor", () => ({ obtenerProyecto: m.obtenerProyecto }));
vi.mock("./disenos-servidor", () => ({
  obtenerMaterialDiseno: m.obtenerMaterialDiseno,
  obtenerMaterialesPorCopia: m.obtenerMaterialesPorCopia,
}));
vi.mock("./libre-servidor", () => ({ obtenerVersionLibre: m.obtenerVersionLibre, contornosDeDiseno: m.contornosDeDiseno }));
vi.mock("./motor", () => ({ generarDiseno: m.generarDiseno }));
vi.mock("./pagina-servidor", () => ({ catalogoParaDiseno: m.catalogoParaDiseno }));
vi.mock("./sandbox", () => ({ disenoLibreActivo: m.disenoLibreActivo, ejecutarCodigo: m.ejecutarCodigo }));

import { calcularCorteProyecto, planchasParaDxfProyecto } from "./proyecto-corte-servidor";

const GRUPO: GrupoPlancha = {
  id: "blanco-3",
  material: "Acrílico",
  variante: "Blanco",
  detalle: "",
  espesorMm: 3,
  rotable: true,
  sobrantesActivo: false,
  formatos: [{ id: "f", codigo: "C", anchoCm: 122, largoCm: 244, porVerificar: false, nota: null, activo: true }],
};

const pieza = (id: string, ancho: number, alto: number, espesor = 3, cantidad = 1): PiezaCad => ({
  id,
  nombre: id,
  cantidad,
  espesor_mm: espesor,
  ancho_mm: ancho,
  alto_mm: alto,
  area_mm2: ancho * alto,
  perimetro_mm: 2 * (ancho + alto),
});

const diseno = (id: string, nombre: string, extra: Partial<DisenoCad> = {}): DisenoCad => ({
  id,
  nombre,
  plantilla: "caja",
  parametros: {},
  version: 1,
  miniatura: null,
  proyecto_id: "p1",
  estado: "plantilla",
  creado_en: "2026-11-28T00:00:00Z",
  actualizado_en: "2026-11-28T00:00:00Z",
  ...extra,
});

function proyectoCon(disenos: DisenoCad[]) {
  m.obtenerProyecto.mockResolvedValue({
    id: "p1",
    nombre: "Hurley Trujillo",
    creado_en: "",
    actualizado_en: "",
    disenos,
    resumen: {},
  });
}

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.catalogoParaDiseno.mockResolvedValue({ grupos: [GRUPO], kerfMm: 0.2, margenMm: 5, politica: "merma", costos: null });
  m.obtenerMaterialDiseno.mockResolvedValue({ grupoPlanchaId: "blanco-3", color: null });
  m.obtenerMaterialesPorCopia.mockResolvedValue({});
  m.disenoLibreActivo.mockReturnValue(true);
  m.contornosDeDiseno.mockResolvedValue({});
  m.generarDiseno.mockImplementation(async (_p: string, parametros: Record<string, unknown>) => ({
    plantilla: "caja",
    parametros,
    piezas: [pieza("frente", 400, 200)],
  }));
});

describe("calcularCorteProyecto", () => {
  it("acomoda juntas las piezas de dos diseños de plantilla y prepara el DXF", async () => {
    proyectoCon([diseno("a", "Logo"), diseno("b", "Counter")]);
    const c = await calcularCorteProyecto("p1");
    expect(c).not.toBeNull();
    expect(c!.vista.problemas).toEqual([]);
    expect(c!.vista.listo).toBe(true);
    expect(c!.vista.disenos.map((d) => d.ref)).toEqual(["d1", "d2"]);
    expect(c!.vista.grupos).toHaveLength(1);
    expect(c!.vista.grupos[0]).toMatchObject({ planchas: 1, aportes: [{ ref: "d1", copias: 1 }, { ref: "d2", copias: 1 }] });

    const dxf = planchasParaDxfProyecto(c!);
    expect(dxf?.planchas).toHaveLength(1);
    expect(dxf?.planchas[0].piezas.map((p) => p.id).sort()).toEqual(["d1__frente", "d2__frente"]);
    expect(dxf?.disenos.map((d) => d.ref)).toEqual(["d1", "d2"]);
    expect(dxf?.disenos[0]).toMatchObject({ plantilla: "caja" });
  });

  it("un diseño libre se regenera con su código y sus contornos, y viaja así al DXF", async () => {
    proyectoCon([diseno("a", "Logo", { plantilla: "libre", estado: "aprobado" })]);
    m.obtenerVersionLibre.mockResolvedValue({ version: 2, codigo: "piezas = []", estado: "aprobado", aprobadoEn: "x" });
    const logo = { ancho_mm: 100, alto_mm: 50, trazos: ["M 0 0 Z"] };
    m.contornosDeDiseno.mockResolvedValue({ logo });
    m.ejecutarCodigo.mockResolvedValue({ piezas: [pieza("frente", 500, 300)] });
    const c = await calcularCorteProyecto("p1");
    expect(m.ejecutarCodigo).toHaveBeenCalledWith("piezas = []", { logo });
    expect(planchasParaDxfProyecto(c!)?.disenos[0]).toEqual({ ref: "d1", nombre: "Logo", codigo: "piezas = []", contornos: { logo } });
  });

  it("no deja cortar con un diseño sin versión o un personalizado sin aprobar, y lo dice por su nombre", async () => {
    proyectoCon([
      diseno("a", "Vacío", { estado: "sin_version", plantilla: null, version: 0 }),
      diseno("b", "Logo", { plantilla: "libre", estado: "borrador" }),
      diseno("c", "Caja"),
    ]);
    const c = await calcularCorteProyecto("p1");
    expect(c!.vista.listo).toBe(false);
    expect(c!.vista.problemas).toEqual([
      expect.stringMatching(/«Vacío» todavía no tiene diseño/),
      expect.stringMatching(/«Logo» es un diseño personalizado sin aprobar/),
    ]);
    // Lo que sí está listo se acomoda igual, para ver cuánto da.
    expect(c!.vista.grupos).toHaveLength(1);
    // Los libres sin aprobar ni se regeneran.
    expect(m.ejecutarCodigo).not.toHaveBeenCalled();
  });

  it("un diseño sin material lo pide por su nombre", async () => {
    proyectoCon([diseno("a", "Counter")]);
    m.obtenerMaterialDiseno.mockResolvedValue(null);
    const c = await calcularCorteProyecto("p1");
    expect(c!.vista.problemas).toEqual(["«Counter» no tiene material: elígelo en su pestaña Planchas."]);
    expect(c!.vista.listo).toBe(false);
  });

  it("si un diseño no se puede regenerar, lo dice y sigue con los demás", async () => {
    proyectoCon([diseno("a", "Roto"), diseno("b", "Bueno")]);
    m.generarDiseno.mockImplementationOnce(async () => {
      throw new Error("El motor no responde");
    });
    const c = await calcularCorteProyecto("p1");
    expect(c!.vista.problemas).toContain("«Roto»: El motor no responde");
    expect(c!.vista.grupos[0].aportes).toEqual([{ ref: "d2", copias: 1 }]);
  });

  it("con el diseño libre apagado, un personalizado aprobado no se puede cortar", async () => {
    proyectoCon([diseno("a", "Logo", { plantilla: "libre", estado: "aprobado" })]);
    m.disenoLibreActivo.mockReturnValue(false);
    const c = await calcularCorteProyecto("p1");
    expect(c!.vista.problemas.join(" ")).toMatch(/diseño libre no está disponible/);
  });

  it("lo que se corta aparte sale en la vista con su `solo`, y no va en las planchas", async () => {
    proyectoCon([diseno("a", "Logo")]);
    m.generarDiseno.mockResolvedValue({
      plantilla: "caja",
      parametros: {},
      piezas: [pieza("frente", 400, 200), pieza("fondo", 500, 300, 12, 2)],
    });
    m.obtenerMaterialesPorCopia.mockResolvedValue({
      fondo_1: { material: "MDF 12 mm", variante: "", detalle: "", color: null, corteAparte: true },
      fondo_2: { material: "MDF 12 mm", variante: "", detalle: "", color: null, corteAparte: true },
    });
    const c = await calcularCorteProyecto("p1");
    expect(c!.vista.problemas).toEqual([]);
    expect(c!.vista.corteAparte).toEqual([
      {
        ref: "d1",
        disenoId: "a",
        disenoNombre: "Logo",
        piezaId: "fondo",
        nombre: "fondo",
        copias: 2,
        material: "MDF 12 mm",
        espesorMm: 12,
        solo: { fondo: [1, 2] },
      },
    ]);
    expect(planchasParaDxfProyecto(c!)?.planchas[0].piezas.map((p) => p.id)).toEqual(["d1__frente"]);
  });

  it("devuelve null si el proyecto no existe, y no hay planchas que bajar sin grupos", async () => {
    m.obtenerProyecto.mockResolvedValue(null);
    expect(await calcularCorteProyecto("nada")).toBeNull();

    proyectoCon([diseno("a", "Caja")]);
    const c = await calcularCorteProyecto("p1");
    expect(planchasParaDxfProyecto(c!, "otro-grupo")).toBeNull();
    const clave = c!.vista.grupos[0].clave;
    expect(planchasParaDxfProyecto(c!, clave)?.planchas).toHaveLength(1);
  });

  it("un proyecto vacío avisa y no es 'listo'", async () => {
    proyectoCon([]);
    const c = await calcularCorteProyecto("p1");
    expect(c!.vista.problemas).toEqual(["El proyecto no tiene diseños."]);
    expect(c!.vista.listo).toBe(false);
  });
});
