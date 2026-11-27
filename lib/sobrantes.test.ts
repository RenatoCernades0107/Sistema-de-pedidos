import { describe, expect, it } from "vitest";
import {
  cabeEn,
  esEstandar,
  leerMedidaBuscada,
  leerNotaDeLote,
  materialDeSobrante,
  materialOdoo,
  medidaSobrante,
  normalizarMedidas,
  notaDeLote,
  ordenDeUso,
  precioDeSobrante,
  sobrantesDeCorte,
  areaPiezasM2,
} from "./sobrantes";

const formatos = [
  { anchoCm: 122, largoCm: 183 },
  { anchoCm: 122, largoCm: 244 },
];

describe("medidas", () => {
  it("el largo es siempre el lado mayor", () => {
    expect(normalizarMedidas(61, 183)).toEqual({ largo: 183, ancho: 61 });
    expect(normalizarMedidas(183, 61)).toEqual({ largo: 183, ancho: 61 });
    expect(medidaSobrante({ largo: 183, ancho: 61.5 })).toBe("183×61.5");
  });

  it("lee una medida escrita de varias formas", () => {
    expect(leerMedidaBuscada("60x80")).toEqual({ a: 60, b: 80 });
    expect(leerMedidaBuscada("cristal 60 × 80,5")).toEqual({ a: 60, b: 80.5 });
    expect(leerMedidaBuscada("cristal")).toBeNull();
  });
});

describe("esEstandar", () => {
  it("media y cuarto de un formato, con un centímetro de tolerancia", () => {
    expect(esEstandar({ largo: 183, ancho: 61 }, formatos)).toBe(true);
    expect(esEstandar({ largo: 122, ancho: 91.5 }, formatos)).toBe(true);
    expect(esEstandar({ largo: 91, ancho: 61.5 }, formatos)).toBe(true);
    expect(esEstandar({ largo: 122, ancho: 122 }, formatos)).toBe(true);
  });

  it("un pedazo cualquiera no", () => {
    expect(esEstandar({ largo: 150, ancho: 40 }, formatos)).toBe(false);
  });
});

describe("cabeEn", () => {
  const s = { largo: 100, ancho: 50 };
  it("girando la pieza si se puede", () => {
    expect(cabeEn(s, { a: 40, b: 90 })).toBe(true);
    expect(cabeEn(s, { a: 40, b: 90 }, false)).toBe(false);
    expect(cabeEn(s, { a: 60, b: 60 })).toBe(false);
  });
});

describe("ordenDeUso", () => {
  it("primero los chicos, luego los antiguos, y los estándar al final", () => {
    const base = { creadoEn: "2026-11-01", estandar: false };
    const orden = ordenDeUso([
      { ...base, codigo: "C", largo: 183, ancho: 61, estandar: true },
      { ...base, codigo: "B", largo: 100, ancho: 50, creadoEn: "2026-11-05" },
      { ...base, codigo: "A", largo: 100, ancho: 50, creadoEn: "2026-11-02" },
      { ...base, codigo: "D", largo: 60, ancho: 40 },
    ]);
    expect(orden.map((s) => s.codigo)).toEqual(["D", "A", "B", "C"]);
  });
});

describe("materialDeSobrante", () => {
  it("material, color y espesor del grupo", () => {
    const g = { material: "Acrílico ECO", variante: "Colores", detalle: "Negro", espesorMm: 3 };
    expect(materialDeSobrante(g)).toBe("Acrílico ECO · Colores negro · 3 mm");
    expect(materialDeSobrante({ ...g, variante: "Cristal", detalle: "" })).toBe("Acrílico ECO · Cristal · 3 mm");
  });
});

describe("precioDeSobrante", () => {
  const formato = { anchoCm: 122, largoCm: 183, costo: 200 };
  it("el fijado por Administración manda", () => {
    expect(precioDeSobrante({ largo: 100, ancho: 50, precioVenta: 30 }, formato, 1.5)).toBe(30);
  });
  it("si no, el costo de su parte de la plancha por el factor", () => {
    // Media plancha: 100 de costo, por 1.5.
    expect(precioDeSobrante({ largo: 183, ancho: 61, precioVenta: null }, formato, 1.5)).toBe(150);
  });
  it("sin costo en Odoo no hay precio que proponer", () => {
    expect(precioDeSobrante({ largo: 183, ancho: 61, precioVenta: null }, { ...formato, costo: 0 }, 1.5)).toBeNull();
    expect(precioDeSobrante({ largo: 183, ancho: 61, precioVenta: null }, null, 1.5)).toBeNull();
  });
});

describe("lo que va a Odoo", () => {
  const grupo = {
    id: "g",
    material: "Acrílico ECO",
    variante: "Blanco",
    detalle: "Lechoso",
    espesorMm: 3,
    rotable: true,
    sobrantesActivo: true,
    formatos: [
      { id: "f", codigo: "F7E072", anchoCm: 122, largoCm: 183, porVerificar: false, nota: null, activo: true },
    ],
  };

  it("el producto Sobrante se nombra como los de la lista, sin tildes", () => {
    expect(materialOdoo(grupo)).toEqual({ codigoBase: "F7E072", nombre: "SOBRANTE ACRILICO ECO BLANCO LECHOSO 3MM" });
    expect(materialOdoo({ ...grupo, formatos: [] })).toBeNull();
  });

  it("la nota del lote es la ubicación, y las viejas con color se leen sin él", () => {
    expect(notaDeLote({ ubicacion: "Rack 2" })).toBe("Rack 2");
    expect(notaDeLote({ ubicacion: null })).toBeNull();
    expect(leerNotaDeLote("Rack 2 · Color: rojo")).toBe("Rack 2");
    expect(leerNotaDeLote("Color: azul")).toBeNull();
    expect(leerNotaDeLote("Estante bajo")).toBe("Estante bajo");
  });
});

describe("el piloto", () => {
  const plancha = (paneles: { x1: number; y1: number; x2: number; y2: number; libre: boolean }[], tipo = "plancha") => ({
    origen: tipo === "plancha" ? { tipo: "plancha" as const } : { tipo: "sobrante" as const, id: "SOB-1" },
    paneles,
  });

  it("propone como sobrantes las zonas libres que no son retazo, también lo que queda de un sobrante", () => {
    const corte = {
      planchas: [
        plancha([
          { x1: 0, y1: 0, x2: 61, y2: 160, libre: false },
          { x1: 61, y1: 0, x2: 122, y2: 183, libre: true },
          { x1: 0, y1: 160, x2: 61, y2: 183, libre: true },
        ]),
        plancha([{ x1: 50, y1: 0, x2: 100, y2: 60, libre: true }], "sobrante"),
      ],
    } as unknown as Parameters<typeof sobrantesDeCorte>[0];
    expect(sobrantesDeCorte(corte, 30)).toEqual([
      { largo: 183, ancho: 61 },
      { largo: 60, ancho: 50 },
    ]);
    expect(sobrantesDeCorte(corte, 20)).toEqual([
      { largo: 183, ancho: 61 },
      { largo: 60, ancho: 50 },
      { largo: 61, ancho: 23 },
    ]);
  });

  it("los m² son los de las piezas", () => {
    expect(areaPiezasM2([{ ancho: 60, alto: 80, cantidad: 10 }])).toBe(4.8);
  });

});
