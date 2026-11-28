import { describe, expect, it } from "vitest";
import type { FormatoPlancha, GrupoPlancha } from "./catalogo";
import {
  SIN_SELECCION,
  coloresDe,
  compararColores,
  completarSeleccion,
  elegirColor,
  elegirEspesor,
  elegirMaterial,
  espesoresDe,
  materialesDe,
  pasoPendiente,
  porPrioridadDeColor,
  prioridadColor,
  resolverGrupo,
  seleccionDe,
} from "./seleccion-material";

const formato = (ancho: number, largo: number, activo = true): FormatoPlancha => ({
  id: `${ancho}x${largo}`,
  codigo: `F${ancho}${largo}`,
  anchoCm: ancho,
  largoCm: largo,
  porVerificar: false,
  nota: null,
  activo,
});

let n = 0;
const grupo = (material: string, variante: string, detalle: string, espesorMm: number, formatos = [formato(122, 183)]): GrupoPlancha => ({
  id: `g${++n}`,
  material,
  variante,
  detalle,
  espesorMm,
  rotable: true,
  sobrantesActivo: false,
  formatos,
});

const catalogo: GrupoPlancha[] = [
  grupo("Acrílico ECO", "Cristal", "", 3, [formato(122, 183), formato(150, 300), formato(100, 100, false)]),
  grupo("Acrílico ECO", "Cristal", "", 2),
  grupo("Acrílico ECO", "Cristal", "", 5),
  grupo("Acrílico ECO", "Blanco", "lechoso", 1.8),
  grupo("Acrílico PREMIUM", "Negro", "", 3),
  grupo("Espejo", "Dorado", "", 2),
  grupo("Acrílico ECO", "Negro", "", 3),
];

describe("materialesDe", () => {
  it("lista cada material una vez, en orden, con su cantidad de colores", () => {
    expect(materialesDe(catalogo)).toEqual([
      { nombre: "Acrílico ECO", colores: 3 },
      { nombre: "Acrílico PREMIUM", colores: 1 },
      { nombre: "Espejo", colores: 1 },
    ]);
  });

  it("no distingue mayúsculas ni tildes al agrupar", () => {
    const c = [grupo("Acrilico eco", "Cristal", "", 3), grupo("Acrílico ECO", "Negro", "", 3)];
    expect(materialesDe(c)).toHaveLength(1);
  });
});

describe("coloresDe", () => {
  it("solo ofrece los colores del material elegido", () => {
    expect(coloresDe(catalogo, "Acrílico ECO").map((c) => c.nombre)).toEqual(["Cristal", "Blanco lechoso", "Negro"]);
    expect(coloresDe(catalogo, "Espejo").map((c) => c.nombre)).toEqual(["Dorado"]);
  });

  it("cuenta los espesores de cada color", () => {
    expect(coloresDe(catalogo, "Acrílico ECO").find((c) => c.nombre === "Cristal")?.espesores).toBe(3);
  });

  it("sin material no hay colores", () => {
    expect(coloresDe(catalogo, null)).toEqual([]);
    expect(coloresDe(catalogo, "Inexistente")).toEqual([]);
  });
});

describe("orden de colores", () => {
  it("pone Cristal primero, luego Blanco y el resto en orden alfabético", () => {
    const c = ["Negro", "Colores rojo", "Blanco lechoso", "Espejo dorado", "Cristal", "Blanco", "Ámbar"].map((v) =>
      grupo("Acrílico", v, "", 3),
    );
    expect(coloresDe(c, "Acrílico").map((x) => x.nombre)).toEqual([
      "Cristal",
      "Blanco",
      "Blanco lechoso",
      "Ámbar",
      "Colores rojo",
      "Espejo dorado",
      "Negro",
    ]);
  });

  it("agrupa las variantes que empiezan por Cristal o Blanco, sin importar mayúsculas ni tildes", () => {
    expect(prioridadColor("Cristal")).toBe(0);
    expect(prioridadColor("cristal mate")).toBe(0);
    expect(prioridadColor("Blanco")).toBe(1);
    expect(prioridadColor("BLANCO lechoso")).toBe(1);
    expect(prioridadColor("Mate cristal")).toBe(2);
    expect(prioridadColor("Cristalino")).toBe(2);
    expect(prioridadColor("Negro")).toBe(2);
  });

  it("compararColores ordena alfabéticamente dentro de cada bloque", () => {
    expect(["Cristal mate", "Negro", "Blanco perla", "Cristal", "Blanco"].sort(compararColores)).toEqual([
      "Cristal",
      "Cristal mate",
      "Blanco",
      "Blanco perla",
      "Negro",
    ]);
  });

  it("porPrioridadDeColor conserva el orden previo del resto", () => {
    expect(["Rojo", "Blanco", "Azul", "Cristal", "Verde"].sort(porPrioridadDeColor)).toEqual([
      "Cristal",
      "Blanco",
      "Rojo",
      "Azul",
      "Verde",
    ]);
  });
});

describe("espesoresDe", () => {
  it("ofrece los espesores de ese material y color, de menor a mayor", () => {
    expect(espesoresDe(catalogo, "Acrílico ECO", "Cristal").map((e) => e.espesorMm)).toEqual([2, 3, 5]);
    expect(espesoresDe(catalogo, "Acrílico ECO", "Negro").map((e) => e.espesorMm)).toEqual([3]);
  });

  it("trae los formatos activos como información", () => {
    const e3 = espesoresDe(catalogo, "Acrílico ECO", "Cristal").find((e) => e.espesorMm === 3);
    expect(e3?.medidas).toEqual(["122×183", "150×300"]);
  });

  it("sin material o sin color no hay espesores", () => {
    expect(espesoresDe(catalogo, null, "Cristal")).toEqual([]);
    expect(espesoresDe(catalogo, "Acrílico ECO", null)).toEqual([]);
  });

  it("con dos grupos del mismo nombre se queda con el primero", () => {
    const c = [grupo("A", "Rojo", "", 3), grupo("A", "Rojo", "", 3)];
    const lista = espesoresDe(c, "A", "Rojo");
    expect(lista).toHaveLength(1);
    expect(lista[0].grupo.id).toBe(c[0].id);
  });
});

describe("resolverGrupo", () => {
  it("devuelve el grupo de la selección completa", () => {
    const g = resolverGrupo(catalogo, { material: "Acrílico ECO", color: "Cristal", espesorMm: 3 });
    expect(g?.id).toBe(catalogo[0].id);
  });

  it("devuelve null si falta un paso o la combinación no existe", () => {
    expect(resolverGrupo(catalogo, { material: "Acrílico ECO", color: "Cristal", espesorMm: null })).toBeNull();
    expect(resolverGrupo(catalogo, { material: "Acrílico ECO", color: "Negro", espesorMm: 5 })).toBeNull();
  });

  it("es el camino de vuelta de seleccionDe", () => {
    for (const g of catalogo) {
      expect(resolverGrupo(catalogo, seleccionDe(g))?.id).toBe(g.id);
    }
  });
});

describe("la cascada", () => {
  it("al elegir un material con varios colores queda pendiente el color", () => {
    const s = elegirMaterial(catalogo, "Acrílico ECO");
    expect(s).toEqual({ material: "Acrílico ECO", color: null, espesorMm: null });
    expect(pasoPendiente(s)).toBe("color");
  });

  it("si el material tiene un solo color lo elige, y queda pendiente el espesor", () => {
    const s = elegirMaterial(catalogo, "Acrílico PREMIUM");
    // PREMIUM Negro solo tiene 3 mm: resuelve todo.
    expect(s).toEqual({ material: "Acrílico PREMIUM", color: "Negro", espesorMm: 3 });
    expect(pasoPendiente(s)).toBeNull();
  });

  it("si el color tiene varios espesores queda pendiente el espesor", () => {
    const s = elegirColor(catalogo, elegirMaterial(catalogo, "Acrílico ECO"), "Cristal");
    expect(s).toEqual({ material: "Acrílico ECO", color: "Cristal", espesorMm: null });
    expect(pasoPendiente(s)).toBe("espesor");
  });

  it("si el color tiene un solo espesor lo elige", () => {
    const s = elegirColor(catalogo, elegirMaterial(catalogo, "Acrílico ECO"), "Negro");
    expect(s).toEqual({ material: "Acrílico ECO", color: "Negro", espesorMm: 3 });
  });

  it("elegir el espesor completa la selección y resuelve el grupo", () => {
    const parcial = elegirColor(catalogo, elegirMaterial(catalogo, "Acrílico ECO"), "Cristal");
    const s = elegirEspesor(catalogo, parcial, 5);
    expect(pasoPendiente(s)).toBeNull();
    expect(resolverGrupo(catalogo, s)?.espesorMm).toBe(5);
  });

  it("cambiar de material reinicia color y espesor", () => {
    const s = elegirMaterial(catalogo, "Espejo");
    expect(s).toEqual({ material: "Espejo", color: "Dorado", espesorMm: 2 });
  });

  it("un material que no existe vacía la selección", () => {
    expect(elegirMaterial(catalogo, "Inexistente")).toEqual(SIN_SELECCION);
  });

  it("un espesor que no existe en el color se descarta", () => {
    const s = completarSeleccion(catalogo, { material: "Acrílico ECO", color: "Negro", espesorMm: 5 });
    expect(s.espesorMm).toBe(null);
  });

  it("sin nada elegido, el primer paso está pendiente", () => {
    expect(pasoPendiente(SIN_SELECCION)).toBe("material");
  });
});
