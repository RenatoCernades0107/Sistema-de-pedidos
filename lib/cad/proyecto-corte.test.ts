import { describe, expect, it } from "vitest";
import { aPlanchasMotor } from "./acomodo";
import type { GrupoPlancha } from "@/lib/cortes/catalogo";
import { aPlanchasMotorDeGrupos, materialDeGrupo, planchasDelDiseno } from "./materiales";
import {
  cortarProyecto,
  idDeProyecto,
  partirId,
  piezasDeDiseno,
  refDeDiseno,
  resumirGrupos,
  soloDeCorteAparte,
  type DisenoParaCorte,
} from "./proyecto-corte";
import type { PiezaCad } from "./tipos";

function grupo(id: string, variante: string, espesorMm: number, anchoCm = 122, largoCm = 244): GrupoPlancha {
  return {
    id,
    material: "Acrílico",
    variante,
    detalle: "",
    espesorMm,
    rotable: true,
    sobrantesActivo: false,
    formatos: [{ id: `${id}-f`, codigo: `C-${id}`, anchoCm, largoCm, porVerificar: false, nota: null, activo: true }],
  };
}

const BLANCO = grupo("blanco-3", "Blanco", 3);
const NEGRO = grupo("negro-3", "Negro", 3);
const CATALOGO = [BLANCO, NEGRO];
const CORTE = { kerfMm: 0.2, margenMm: 5 };

const pieza = (id: string, cantidad: number, ancho: number, alto: number, espesor = 3): PiezaCad => ({
  id,
  nombre: id,
  cantidad,
  espesor_mm: espesor,
  ancho_mm: ancho,
  alto_mm: alto,
  area_mm2: ancho * alto,
  perimetro_mm: 2 * (ancho + alto),
});

const diseno = (posicion: number, nombre: string, piezas: PiezaCad[], grupoId: string, porCopia = {}): DisenoParaCorte => ({
  ref: refDeDiseno(posicion),
  nombre,
  piezas,
  material: { grupoPlanchaId: grupoId, color: null },
  porCopia,
  parametros: {},
});

describe("ids de proyecto", () => {
  it("prefija con la referencia del diseño y se puede deshacer", () => {
    expect(refDeDiseno(0)).toBe("d1");
    expect(idDeProyecto("d2", "lateral")).toBe("d2__lateral");
    expect(partirId("d2__lateral")).toEqual({ ref: "d2", id: "lateral" });
    // Un id con el separador adentro se parte en el primero.
    expect(partirId("d2__lateral__5mm")).toEqual({ ref: "d2", id: "lateral__5mm" });
    expect(partirId("lateral")).toBeNull();
  });

  it("no deja pasar un id que no cabe en el tope del motor", () => {
    expect(() => idDeProyecto("d1", "x".repeat(70))).toThrow(/demasiado largo/);
  });

  it("piezasDeDiseno prefija id, nodos y nombre, también con varias copias", () => {
    const [p, q] = piezasDeDiseno({
      ref: "d3",
      nombre: "Fitting",
      piezas: [pieza("base", 1, 100, 50), { ...pieza("lateral", 2, 80, 40), nodos: ["lateral_1", "lateral_2"] }],
    });
    expect(p).toMatchObject({ id: "d3__base", nombre: "Fitting › base", nodos: ["d3__base"] });
    expect(q.nodos).toEqual(["d3__lateral_1", "d3__lateral_2"]);
  });
});

describe("cortarProyecto", () => {
  it("dos diseños con una pieza del mismo nombre comparten plancha sin chocar", () => {
    const r = cortarProyecto({
      disenos: [diseno(0, "Logo", [pieza("frente", 1, 500, 300)], "blanco-3"), diseno(1, "Counter", [pieza("frente", 1, 400, 200)], "blanco-3")],
      catalogo: CATALOGO,
      corte: CORTE,
    });
    expect(r.problemas).toEqual([]);
    expect(r.grupos).toHaveLength(1);
    const g = r.grupos[0];
    expect(g.piezas.map((p) => p.id).sort()).toEqual(["d1__frente", "d2__frente"]);
    expect(g.acomodo?.planchas).toHaveLength(1);
    expect(g.acomodo?.planchas[0].piezas.map((p) => p.id).sort()).toEqual(["d1__frente", "d2__frente"]);
  });

  it("cada diseño usa SU material: el negro y el blanco no se mezclan", () => {
    const r = cortarProyecto({
      disenos: [diseno(0, "A", [pieza("p", 1, 300, 300)], "blanco-3"), diseno(1, "B", [pieza("p", 1, 300, 300)], "negro-3")],
      catalogo: CATALOGO,
      corte: CORTE,
    });
    expect(r.grupos.map((g) => g.grupo.id).sort()).toEqual(["blanco-3", "negro-3"]);
    expect(resumirGrupos(r.grupos).every((g) => g.planchas === 1)).toBe(true);
  });

  it("el material propio de una copia (por nodo) también lleva el prefijo", () => {
    const negro = materialDeGrupo(NEGRO);
    const r = cortarProyecto({
      disenos: [diseno(0, "A", [{ ...pieza("lado", 2, 300, 300), nodos: ["lado_1", "lado_2"] }], "blanco-3", { lado_2: negro })],
      catalogo: CATALOGO,
      corte: CORTE,
    });
    const porGrupo = Object.fromEntries(r.grupos.map((g) => [g.grupo.id, g.piezas[0].indices]));
    expect(porGrupo).toEqual({ "blanco-3": [1], "negro-3": [2] });
  });

  it("el corte aparte (MDF) queda fuera de las planchas, sin problema, y se lista por diseño", () => {
    const mdf = { material: "MDF 12 mm", variante: "", detalle: "", color: null, corteAparte: true as const };
    const r = cortarProyecto({
      disenos: [
        diseno(0, "Logo", [pieza("frente", 1, 500, 300), { ...pieza("fondo", 2, 600, 400, 12), nodos: ["fondo_1", "fondo_2"] }], "blanco-3", {
          fondo_1: mdf,
          fondo_2: mdf,
        }),
      ],
      catalogo: CATALOGO,
      corte: CORTE,
    });
    expect(r.problemas).toEqual([]);
    expect(r.grupos).toHaveLength(1);
    expect(r.grupos[0].piezas.map((p) => p.id)).toEqual(["d1__frente"]);
    expect(r.corteAparte).toEqual([
      { ref: "d1", piezaId: "fondo", nombre: "fondo", indices: [1, 2], material: "MDF 12 mm", espesorMm: 12 },
    ]);
    expect(soloDeCorteAparte(r.corteAparte, "d1")).toEqual({ fondo: [1, 2] });
    expect(soloDeCorteAparte(r.corteAparte, "d2")).toEqual({});
  });

  it("un material que no está en el catálogo (y no es de corte aparte) sigue siendo un problema, con el nombre del diseño", () => {
    const r = cortarProyecto({
      disenos: [diseno(0, "Logo", [pieza("frente", 1, 500, 300, 8)], "blanco-3")],
      catalogo: CATALOGO,
      corte: CORTE,
    });
    expect(r.problemas.join(" ")).toMatch(/Logo › frente/);
    expect(r.problemas.join(" ")).toMatch(/catálogo no tiene/);
  });

  it("avisa de los diseños sin material", () => {
    const sin: DisenoParaCorte = { ...diseno(0, "Counter", [pieza("p", 1, 100, 100)], "blanco-3"), material: null };
    const r = cortarProyecto({ disenos: [sin], catalogo: CATALOGO, corte: CORTE });
    expect(r.problemas).toEqual(["«Counter» no tiene material: elígelo en su pestaña Planchas."]);
    expect(r.grupos).toEqual([]);
  });

  it("una pieza que no entra en ninguna plancha lo dice con el nombre del diseño", () => {
    const r = cortarProyecto({
      disenos: [diseno(0, "Fachada", [pieza("logo", 1, 3470, 830)], "blanco-3")],
      catalogo: CATALOGO,
      corte: CORTE,
    });
    expect(r.problemas.join(" ")).toMatch(/Fachada › logo.*no entra/);
  });

  it("las planchas salen con los ids prefijados, listas para el DXF del proyecto", () => {
    const r = cortarProyecto({
      disenos: [diseno(0, "A", [pieza("p", 1, 300, 300)], "blanco-3"), diseno(1, "B", [pieza("p", 1, 200, 200)], "blanco-3")],
      catalogo: CATALOGO,
      corte: CORTE,
    });
    const planchas = aPlanchasMotorDeGrupos(r.grupos, aPlanchasMotor);
    expect(planchas).toHaveLength(1);
    expect(planchas[0].etiqueta).toContain("Blanco");
    expect(planchas[0].piezas.map((p) => p.id).sort()).toEqual(["d1__p", "d2__p"]);
  });

  it("con un solo diseño da lo mismo que planchasDelDiseno", () => {
    const piezas = [pieza("base", 1, 500, 300), pieza("lado", 2, 200, 100)];
    const solo = planchasDelDiseno({
      catalogo: CATALOGO,
      porDefecto: { grupoPlanchaId: "blanco-3", color: null },
      porCopia: {},
      parametros: {},
      piezas,
      corte: CORTE,
    });
    const r = cortarProyecto({ disenos: [diseno(0, "Uno", piezas, "blanco-3")], catalogo: CATALOGO, corte: CORTE });
    expect(r.grupos[0].acomodo?.planchas.length).toBe(solo.grupos[0].acomodo?.planchas.length);
    expect(r.grupos[0].acomodo?.mermaPct).toBeCloseTo(solo.grupos[0].acomodo?.mermaPct ?? 0, 6);
  });
});

describe("resumirGrupos", () => {
  it("cuenta lo que aporta cada diseño y redondea la merma", () => {
    const r = cortarProyecto({
      disenos: [diseno(0, "A", [pieza("p", 2, 300, 300)], "blanco-3"), diseno(1, "B", [pieza("q", 1, 200, 200)], "blanco-3")],
      catalogo: CATALOGO,
      corte: CORTE,
    });
    const [g] = resumirGrupos(r.grupos);
    expect(g.aportes).toEqual([
      { ref: "d1", copias: 2 },
      { ref: "d2", copias: 1 },
    ]);
    expect(g.planchas).toBe(1);
    expect(g.formato).toEqual({ anchoMm: 1220, altoMm: 2440 });
    expect(Number.isInteger((g.mermaPct ?? 0) * 10)).toBe(true);
  });
});
