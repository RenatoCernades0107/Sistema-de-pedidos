import { describe, expect, it } from "vitest";
import { CONFIG_CORTES_DEFECTO } from "@/lib/cortes/config";
import type { GrupoPlancha } from "@/lib/cortes/catalogo";
import { costoDiseno } from "./costo";
import {
  acomodoParaGuardar,
  costoPorGrupos,
  grupoPara,
  leerAcomodoGuardado,
  leerMateriales,
  materialDeGrupo,
  planchasDelDiseno,
  resolverCopias,
} from "./materiales";
import type { PiezaCad } from "./tipos";

function grupo(id: string, material: string, variante: string, espesorMm: number): GrupoPlancha {
  return {
    id,
    material,
    variante,
    detalle: "",
    espesorMm,
    rotable: true,
    sobrantesActivo: false,
    formatos: [
      { id: `${id}-f`, codigo: `C-${id}`, anchoCm: 122, largoCm: 183, skuCompartido: false, porVerificar: false, nota: null, activo: true },
    ],
  };
}

const CATALOGO = [
  grupo("cristal-3", "Acrílico", "Cristal", 3),
  grupo("cristal-5", "Acrílico", "Cristal", 5),
  grupo("rojo-3", "Acrílico", "Rojo", 3),
];
const CRISTAL_3 = { grupoPlanchaId: "cristal-3", color: null };
const ROJO = materialDeGrupo(CATALOGO[2]);
const CORTE = { kerfMm: 0.2, margenMm: 5 };

const pieza = (id: string, cantidad: number, espesor: number, extra: Partial<PiezaCad> = {}): PiezaCad => ({
  id,
  nombre: id,
  cantidad,
  espesor_mm: espesor,
  ancho_mm: 200,
  alto_mm: 100,
  area_mm2: 20000,
  perimetro_mm: 600,
  ...extra,
});

// Una caja con el lateral 2 de 5 mm (separado por el motor) y el lateral 1 rojo.
const PIEZAS = [
  pieza("base", 1, 3),
  pieza("lateral", 1, 3, { nodos: ["lateral_1"], origen: "lateral" }),
  pieza("lateral__5mm", 1, 5, { nodos: ["lateral_2"], origen: "lateral" }),
];

describe("material y espesor por copia", () => {
  it("cada copia busca la plancha de su material y su espesor", () => {
    const copias = resolverCopias(PIEZAS, CRISTAL_3, { lateral_1: ROJO }, CATALOGO);
    expect(copias.map((c) => [c.nodo, c.grupo?.id, c.propio])).toEqual([
      ["base", "cristal-3", false],
      ["lateral_1", "rojo-3", true],
      ["lateral_2", "cristal-5", false],
    ]);
  });

  it("agrupa por plancha y acomoda cada grupo", () => {
    const r = planchasDelDiseno({
      catalogo: CATALOGO,
      porDefecto: CRISTAL_3,
      porCopia: { lateral_1: ROJO },
      parametros: { espesor: 3 },
      piezas: PIEZAS,
      corte: CORTE,
    });
    expect(r.problemas).toEqual([]);
    expect(r.grupos.map((g) => g.etiqueta)).toEqual([
      "Acrílico · Cristal · 3 mm",
      "Acrílico · Rojo · 3 mm",
      "Acrílico · Cristal · 5 mm",
    ]);
    expect(r.grupos.every((g) => g.acomodo?.planchas.length === 1)).toBe(true);
  });

  it("respeta el índice real de cada copia en el acomodo", () => {
    const r = planchasDelDiseno({
      catalogo: CATALOGO,
      porDefecto: CRISTAL_3,
      porCopia: { lado_2: ROJO },
      parametros: {},
      piezas: [pieza("lado", 2, 3)],
      corte: CORTE,
    });
    const rojo = r.grupos.find((g) => g.grupo.id === "rojo-3")!;
    expect(rojo.acomodo?.planchas[0].piezas.map((p) => [p.id, p.indice])).toEqual([["lado", 2]]);
    const cristal = r.grupos.find((g) => g.grupo.id === "cristal-3")!;
    expect(cristal.acomodo?.planchas[0].piezas.map((p) => [p.id, p.indice])).toEqual([["lado", 1]]);
  });

  it("avisa cuando el catálogo no tiene ese material en ese espesor", () => {
    const r = planchasDelDiseno({
      catalogo: CATALOGO,
      porDefecto: CRISTAL_3,
      porCopia: { lateral_2: ROJO },
      parametros: {},
      piezas: PIEZAS,
      corte: CORTE,
    });
    expect(r.problemas).toEqual([
      "El catálogo no tiene Acrílico · Rojo de 5 mm: «lateral__5mm» (copia 2). Elige otro material o espesor.",
    ]);
  });

  it("sin material no hay grupos ni problemas", () => {
    const r = planchasDelDiseno({ catalogo: CATALOGO, porDefecto: null, porCopia: {}, parametros: {}, piezas: PIEZAS, corte: CORTE });
    expect(r.grupos).toEqual([]);
    expect(r.problemas).toEqual([]);
  });

  it("el espesor del diseño tiene que ser el de su plancha", () => {
    const r = planchasDelDiseno({
      catalogo: CATALOGO,
      porDefecto: CRISTAL_3,
      porCopia: {},
      parametros: { espesor: 4 },
      piezas: [pieza("base", 1, 3)],
      corte: CORTE,
    });
    expect(r.problemas[0]).toMatch(/4 mm de espesor/);
  });

  it("grupoPara no mira el color elegido, sí el espesor", () => {
    expect(grupoPara({ ...ROJO, color: "Rojo fuego" }, 3, CATALOGO)?.id).toBe("rojo-3");
    expect(grupoPara(ROJO, 5, CATALOGO)).toBeNull();
  });

  it("lee lo guardado y descarta lo que no tiene forma", () => {
    expect(leerMateriales({ porCopia: { lateral_1: ROJO } })).toEqual({ lateral_1: ROJO });
    expect(leerMateriales({ porCopia: { "Lateral 1": ROJO } })).toEqual({});
    expect(leerMateriales(null)).toEqual({});
  });
});

describe("acomodo guardado", () => {
  const r = planchasDelDiseno({
    catalogo: CATALOGO,
    porDefecto: CRISTAL_3,
    porCopia: { lateral_1: ROJO },
    parametros: {},
    piezas: PIEZAS,
    corte: CORTE,
  });

  it("versión 2, por grupos, con el área total", () => {
    const g = acomodoParaGuardar(r.grupos, 0.2)!;
    expect(g.version).toBe(2);
    expect(g.grupos).toHaveLength(3);
    expect(g.areaPiezasMm2).toBeCloseTo(r.grupos.reduce((s, x) => s + x.acomodo!.areaPiezasMm2, 0));
    expect(leerAcomodoGuardado(JSON.parse(JSON.stringify(g)))?.grupos).toHaveLength(3);
  });

  it("lee también el de antes, de un solo grupo", () => {
    const antiguo = { ...r.grupos[0].acomodo!, kerfMm: 0.1 };
    const leido = leerAcomodoGuardado(antiguo);
    expect(leido?.kerfMm).toBe(0.1);
    expect(leido?.grupos).toHaveLength(1);
    expect(leerAcomodoGuardado({ planchas: [] })).toBeNull();
  });
});

describe("costo por grupos", () => {
  const r = planchasDelDiseno({
    catalogo: CATALOGO,
    porDefecto: CRISTAL_3,
    porCopia: { lateral_1: ROJO },
    parametros: {},
    piezas: PIEZAS,
    corte: CORTE,
  });
  const precios = { "C-cristal-3": 100, "C-cristal-5": 160, "C-rojo-3": 120 };

  it("suma los grupos y redondea una sola vez", () => {
    const c = costoPorGrupos(r.grupos, costoDiseno, { precios, config: CONFIG_CORTES_DEFECTO })!;
    expect(c.grupos).toHaveLength(3);
    const material = c.grupos.reduce((s, g) => s + g.costo!.material, 0);
    expect(c.material).toBeCloseTo(material, 2);
    expect(c.total).toBeLessThanOrEqual(c.grupos.reduce((s, g) => s + g.costo!.total, 0) + 1e-9);
    expect(c.problema).toBeNull();
  });

  it("con un solo grupo es el costo de siempre", () => {
    const uno = planchasDelDiseno({
      catalogo: CATALOGO,
      porDefecto: CRISTAL_3,
      porCopia: {},
      parametros: {},
      piezas: [pieza("base", 1, 3)],
      corte: CORTE,
    });
    const c = costoPorGrupos(uno.grupos, costoDiseno, { precios, config: CONFIG_CORTES_DEFECTO })!;
    const directo = costoDiseno({ piezas: uno.grupos[0].piezas, grupo: uno.grupos[0].grupo, acomodo: uno.grupos[0].acomodo, precios, config: CONFIG_CORTES_DEFECTO })!;
    expect(c.total).toBe(directo.total);
    expect(c.material).toBe(directo.material);
  });
});
