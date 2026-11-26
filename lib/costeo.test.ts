import { describe, expect, it } from "vitest";
import {
  conceptosDe,
  costoPromedio,
  leerConfigCostos,
  liquidar,
  margenActual,
  margenObjetivo,
  montoManoObra,
  precioSugerido,
  repartirCentimos,
  CONFIG_COSTOS_POR_DEFECTO,
  type CompraCosteo,
} from "./costeo";

const importacion: CompraCosteo = {
  tipo: "importacion",
  monedaMercaderia: "USD",
  tcMercaderia: 3.75,
  tcGastos: 3.8,
  incoterm: "FOB",
};

describe("repartirCentimos", () => {
  it("cuadra exacto con el mayor residuo", () => {
    expect(repartirCentimos(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(repartirCentimos(1001, [3, 7]).reduce((a, b) => a + b)).toBe(1001);
  });
  it("sin pesos no reparte", () => {
    expect(repartirCentimos(500, [0, 0])).toEqual([0, 0]);
  });
});

describe("liquidar", () => {
  it("la mercadería va directa y los gastos por valor o por kilos", () => {
    // Dos planchas: A cara y liviana, B barata y pesada.
    const l = liquidar(
      importacion,
      [
        { cantidad: 10, kilos: 100, precioUnitario: 100 }, // $1,000
        { cantidad: 10, kilos: 300, precioUnitario: 30 }, //  $300
      ],
      [
        { concepto: "flete_maritimo", moneda: "USD", monto: 100, reparto: "peso" }, // S/ 380 → 1:3
        { concepto: "seguro", moneda: "USD", monto: 13, reparto: "valor" }, //        S/ 49.40 → 10:3
      ],
    );
    expect(l.errores).toEqual([]);
    expect(l.lineas[0].mercaderiaPen).toBe(3750);
    expect(l.lineas[1].mercaderiaPen).toBe(1125);
    expect(l.lineas[0].gastos.flete_maritimo).toBe(95);
    expect(l.lineas[1].gastos.flete_maritimo).toBe(285);
    expect(l.lineas[0].gastos.seguro).toBe(38);
    expect(l.lineas[1].gastos.seguro).toBe(11.4);
    expect(l.lineas[0].costoUnitarioPen).toBe(388.3);
    expect(l.lineas[1].costoUnitarioPen).toBe(142.14);
    expect(l.costoTotalPen).toBe(3750 + 1125 + 380 + 49.4);
  });

  it("antes (todo por kilos) la plancha pesada cargaba de más; ahora no", () => {
    const lineas = [
      { cantidad: 1, kilos: 10, precioUnitario: 100 },
      { cantidad: 1, kilos: 30, precioUnitario: 60 },
    ];
    const l = liquidar({ ...importacion, monedaMercaderia: "PEN", tcGastos: 1 }, lineas, []);
    const porKilo = (160 / 40) * 30; // lo de antes: S/ 120 para la pesada
    expect(l.lineas[1].costoUnitarioPen).toBe(60);
    expect(l.lineas[1].costoUnitarioPen).toBeLessThan(porKilo);
  });

  it("IGV, IPM y percepción no son costo", () => {
    const l = liquidar(
      importacion,
      [{ cantidad: 5, kilos: 50, precioUnitario: 200 }],
      [
        { concepto: "igv", moneda: "USD", monto: 9912, reparto: "no_costo" },
        { concepto: "ipm", moneda: "USD", monto: 1599, reparto: "no_costo" },
        { concepto: "percepcion_igv", moneda: "PEN", monto: 9017, reparto: "no_costo" },
        { concepto: "ad_valorem", moneda: "USD", monto: 10, reparto: "valor" },
      ],
    );
    expect(l.gastosPen).toBe(38);
    expect(l.creditoFiscalPen).toBeCloseTo(9912 * 3.8 + 1599 * 3.8 + 9017, 2);
    expect(l.lineas[0].costoUnitarioPen).toBe((1000 * 3.75 + 38) / 5);
  });

  it("los céntimos cuadran con el total", () => {
    const l = liquidar(
      importacion,
      [
        { cantidad: 3, kilos: 33.3, precioUnitario: 10.01 },
        { cantidad: 7, kilos: 11.1, precioUnitario: 3.33 },
        { cantidad: 11, kilos: 77.7, precioUnitario: 1.11 },
      ],
      [{ concepto: "transporte", moneda: "PEN", monto: 1000.01, reparto: "peso" }],
    );
    const suma = l.lineas.reduce((a, x) => a + Math.round(x.gastosPen * 100), 0);
    expect(suma).toBe(100001);
  });

  it("CIF no admite flete ni seguro", () => {
    const l = liquidar(
      { ...importacion, incoterm: "CIF" },
      [{ cantidad: 1, kilos: 1, precioUnitario: 1 }],
      [{ concepto: "flete_maritimo", moneda: "USD", monto: 5, reparto: "peso" }],
    );
    expect(l.errores.join(" ")).toMatch(/CIF/);
  });

  it("pide kilos si hay gastos por peso y tipo de cambio si hay dólares", () => {
    const l = liquidar(
      { ...importacion, tcMercaderia: null, tcGastos: null },
      [{ cantidad: 1, kilos: null, precioUnitario: 1 }],
      [{ concepto: "visto_bueno", moneda: "USD", monto: 5, reparto: "peso" }],
    );
    expect(l.errores).toEqual(
      expect.arrayContaining([
        "Falta el tipo de cambio de la mercadería.",
        "Falta el tipo de cambio de los gastos.",
        "Hay gastos que se reparten por kilos: escribe los kilos de cada ítem.",
      ]),
    );
  });

  it("nacional en soles con transporte y mano de obra", () => {
    const l = liquidar(
      { tipo: "nacional", monedaMercaderia: "PEN", tcMercaderia: null, tcGastos: null, incoterm: null },
      [
        { cantidad: 20, kilos: 200, precioUnitario: 150 },
        { cantidad: 10, kilos: 50, precioUnitario: 90 },
      ],
      [
        { concepto: "transporte", moneda: "PEN", monto: 250, reparto: "peso" },
        { concepto: "mano_obra", moneda: "PEN", monto: montoManoObra(2, 4, 12.5), reparto: "peso" },
      ],
    );
    expect(l.errores).toEqual([]);
    expect(l.gastosPen).toBe(350);
    expect(l.lineas[0].gastosPen).toBe(280);
    expect(l.lineas[0].costoUnitarioPen).toBe(164);
    expect(l.lineas[0].costoUnitarioUsd).toBeNull();
    expect(l.lineas[0].costoKgPen).toBe(16.4);
  });

  it("la DAM real: FOB 63,352.71 + flete 511 + seguro 84.82", () => {
    const l = liquidar(
      { ...importacion, tcMercaderia: 3.4, tcGastos: 3.4 },
      [
        { cantidad: 300, kilos: 18000, precioUnitario: 150.25 }, // 45,075
        { cantidad: 120, kilos: 9000, precioUnitario: 152.31425 }, // 18,277.71
      ],
      [
        { concepto: "flete_maritimo", moneda: "USD", monto: 511, reparto: "peso" },
        { concepto: "seguro", moneda: "USD", monto: 84.82, reparto: "valor" },
      ],
    );
    expect(l.errores).toEqual([]);
    expect(Math.round((l.mercaderiaPen + l.gastosPen) * 100)).toBe(Math.round(63948.53 * 3.4 * 100));
  });
});

describe("precio y margen", () => {
  const o = { igvPct: 18, preciosIncluyenIgv: true, redondeo: "decimo" as const };

  it("precio = costo / (1 − margen) + IGV, redondeado hacia arriba", () => {
    // 100 / 0.7 = 142.857 × 1.18 = 168.57 → 168.6
    expect(precioSugerido(100, 30, o)).toBe(168.6);
    expect(precioSugerido(100, 30, { ...o, redondeo: "sol" })).toBe(169);
    expect(precioSugerido(100, 30, { ...o, preciosIncluyenIgv: false, redondeo: "centimo" })).toBe(142.86);
    expect(precioSugerido(0, 30, o)).toBeNull();
  });

  it("el margen actual sale sobre el precio sin IGV", () => {
    expect(margenActual(118, 70, o)).toBe(30);
    expect(margenActual(0, 70, o)).toBeNull();
    // ida y vuelta: el sugerido da al menos el margen pedido
    expect(margenActual(precioSugerido(87.3, 35, o)!, 87.3, o)!).toBeGreaterThanOrEqual(35);
  });

  it("promedio ponderado por cantidad", () => {
    expect(costoPromedio([{ cantidad: 10, costoUnitarioPen: 100 }, { cantidad: 30, costoUnitarioPen: 120 }])).toBe(115);
    expect(costoPromedio([])).toBeNull();
  });

  it("margen objetivo: plancha, luego material, luego general", () => {
    const c = { ...CONFIG_COSTOS_POR_DEFECTO, margenPorMaterial: { "Acrílico ECO": 25 } };
    expect(margenObjetivo(c, "Acrílico ECO", 40)).toEqual({ pct: 40, origen: "plancha" });
    expect(margenObjetivo(c, "Acrílico ECO", null)).toEqual({ pct: 25, origen: "material" });
    expect(margenObjetivo(c, "Espejo", undefined)).toEqual({ pct: 30, origen: "general" });
  });
});

describe("config y conceptos", () => {
  it("lee valor por valor con defectos", () => {
    const c = leerConfigCostos({ margenDefecto: 40, igvPct: "x", tarifasManoObra: { descarga: 12 } });
    expect(c.margenDefecto).toBe(40);
    expect(c.igvPct).toBe(18);
    expect(c.tarifasManoObra).toEqual({ descarga: 12, supervision: 0, despacho: 0 });
    expect(leerConfigCostos(null)).toEqual(CONFIG_COSTOS_POR_DEFECTO);
  });

  it("la compra nacional ve solo un subconjunto; CIF quita flete y seguro", () => {
    expect(conceptosDe("nacional", null)).toEqual(["transporte", "mano_obra", "combustible", "otro"]);
    const cif = conceptosDe("importacion", "CIF");
    expect(cif).not.toContain("flete_maritimo");
    expect(cif).not.toContain("seguro");
    expect(conceptosDe("importacion", "FOB")).toContain("seguro");
  });
});
