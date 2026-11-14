import { describe, expect, it } from "vitest";
import {
  camposDe,
  completarParametros,
  copiaDeNodo,
  numeroDeNodo,
  nodoAPieza,
  nombreArchivo,
  normalizarValor,
  pasoDe,
  unidadDe,
  valoresPorDefecto,
} from "./esquema";
import type { EsquemaParametros } from "./tipos";

const esquema: EsquemaParametros = {
  type: "object",
  properties: {
    largo: { type: "number", title: "Largo", default: 200, minimum: 50, maximum: 1200 },
    divisiones: { type: "integer", title: "Divisiones", default: 2, minimum: 0, maximum: 10 },
    con_tapa: { type: "boolean", title: "Con tapa", default: true },
    union: { type: "string", title: "Unión", enum: ["pegada", "encastre"] },
    espesor: { type: "number", minimum: 2 },
  },
  required: ["largo"],
};

describe("camposDe", () => {
  it("respeta el orden del esquema y elige el control por tipo", () => {
    const campos = camposDe(esquema);
    expect(campos.map((c) => [c.clave, c.control])).toEqual([
      ["largo", "numero"],
      ["divisiones", "entero"],
      ["con_tapa", "interruptor"],
      ["union", "lista"],
      ["espesor", "numero"],
    ]);
    expect(campos[0]).toMatchObject({ etiqueta: "Largo", requerido: true, minimo: 50, maximo: 1200 });
    expect(campos[4].etiqueta).toBe("espesor");
  });

  it("aguanta un esquema vacío o ausente", () => {
    expect(camposDe(null)).toEqual([]);
    expect(camposDe({ type: "object", properties: {} })).toEqual([]);
  });
});

describe("valoresPorDefecto", () => {
  it("usa `default` y, si falta, algo razonable por tipo", () => {
    expect(valoresPorDefecto(esquema)).toEqual({
      largo: 200,
      divisiones: 2,
      con_tapa: true,
      union: "pegada",
      espesor: 2,
    });
  });
});

describe("completarParametros", () => {
  it("pone lo guardado encima de los valores por defecto y descarta lo que sobra", () => {
    expect(completarParametros(esquema, { largo: 300, viejo: 1 })).toEqual({
      largo: 300,
      divisiones: 2,
      con_tapa: true,
      union: "pegada",
      espesor: 2,
    });
  });
});

describe("normalizarValor", () => {
  const largo = esquema.properties.largo;
  const divisiones = esquema.properties.divisiones;

  it("lee números con coma o punto", () => {
    expect(normalizarValor(largo, "120,5")).toBe(120.5);
    expect(normalizarValor(largo, " 80 ")).toBe(80);
  });

  it("no inventa un número con lo que no lo es", () => {
    expect(normalizarValor(largo, "")).toBeUndefined();
    expect(normalizarValor(largo, "abc")).toBeUndefined();
    expect(normalizarValor(largo, true)).toBeUndefined();
  });

  it("redondea los enteros y acota solo si se pide", () => {
    expect(normalizarValor(divisiones, "2.6")).toBe(3);
    expect(normalizarValor(largo, "5000")).toBe(5000);
    expect(normalizarValor(largo, "5000", { acotar: true })).toBe(1200);
    expect(normalizarValor(largo, "1", { acotar: true })).toBe(50);
  });

  it("valida booleanos y listas", () => {
    expect(normalizarValor(esquema.properties.con_tapa, false)).toBe(false);
    expect(normalizarValor(esquema.properties.con_tapa, "x")).toBeUndefined();
    expect(normalizarValor(esquema.properties.union, "encastre")).toBe("encastre");
    expect(normalizarValor(esquema.properties.union, "soldada")).toBeUndefined();
  });
});

describe("nombreArchivo", () => {
  it("lleva la plantilla y las medidas redondeadas", () => {
    expect(nombreArchivo("caja", { x: 200, y: 150.4, z: 100 }, "dxf")).toBe(
      "diseno-caja-200x150x100.dxf",
    );
    expect(nombreArchivo("porta_afiches", null, "step")).toBe("diseno-porta_afiches.step");
  });
});

describe("nodoAPieza", () => {
  const ids = ["base", "lateral", "lateral_corto"];

  it("resuelve el nodo exacto y el repetido", () => {
    expect(nodoAPieza("base", ids)).toBe("base");
    expect(nodoAPieza("lateral_2", ids)).toBe("lateral");
  });

  it("prefiere el id más largo que encaje", () => {
    expect(nodoAPieza("lateral_corto_1", ids)).toBe("lateral_corto");
  });

  it("no confunde prefijos sin separador", () => {
    expect(nodoAPieza("basement", ids)).toBeNull();
    expect(nodoAPieza("tapa", ids)).toBeNull();
  });
});

describe("unidadDe y pasoDe", () => {
  it("las medidas van en mm, las cantidades sin unidad y los ángulos en grados", () => {
    expect(unidadDe({ type: "number", title: "Largo" })).toBe("mm");
    expect(unidadDe({ type: "integer", title: "Divisiones" })).toBeNull();
    expect(unidadDe({ type: "integer", title: "Espesor", description: "En mm." })).toBe("mm");
    expect(unidadDe({ type: "number", title: "Ángulo de inclinación" })).toBe("°");
    expect(unidadDe({ type: "boolean" })).toBeNull();
  });

  it("el paso es entero salvo en rangos cortos de decimales", () => {
    expect(pasoDe({ type: "integer", minimum: 0, maximum: 10 })).toBe(1);
    expect(pasoDe({ type: "number", minimum: 2, maximum: 10 })).toBe(0.5);
    expect(pasoDe({ type: "number", minimum: 50, maximum: 1200 })).toBe(1);
  });
});

describe("copiaDeNodo", () => {
  const ids = ["lateral", "lateral__5mm", "base"];
  it("prefiere los extras del GLB", () => {
    expect(copiaDeNodo("lateral_2", { pieza: "lateral__5mm", origen: "lateral", nodo: "lateral_2", espesor_mm: 5 }, ids)).toEqual({
      pieza: "lateral__5mm",
      nodo: "lateral_2",
      origen: "lateral",
      espesorMm: 5,
    });
  });
  it("sin extras, por el nombre", () => {
    expect(copiaDeNodo("lateral_1", undefined, ids)).toEqual({
      pieza: "lateral",
      nodo: "lateral_1",
      origen: "lateral",
      espesorMm: null,
    });
    expect(copiaDeNodo("otro", {}, ids)).toBeNull();
  });
  it("ignora una pieza de los extras que no está en el despiece", () => {
    expect(copiaDeNodo("base", { pieza: "fantasma" }, ids)?.pieza).toBe("base");
  });
  it("número de copia", () => {
    expect(numeroDeNodo("lateral_2")).toBe(2);
    expect(numeroDeNodo("base")).toBe(0);
  });
});
