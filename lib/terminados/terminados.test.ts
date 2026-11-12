import { describe, expect, it } from "vitest";
import { esquemaLineaTerminado } from "../esquemas";
import { importeDe, ponerTerminado, problemaDeLineas, type LineaTerminado } from "../lineas-cotizacion";
import { detalleDesdeLineas, type LineaGuardada } from "../cotizaciones";
import { cantidadesParaDescontar, type LineaDePedido } from "../pedido-lineas";
import { CONFIG_CORTES_DEFECTO } from "../cortes/config";
import {
  calcularTerminado,
  formatosConPrecio,
  planchaDeReferencia,
  type EntradaTerminado,
  type FormatoTerminado,
} from "./calcular";
import { etiquetaDeTipo, textoDeMedidaEstandar, type MedidaEstandar } from "./catalogo";
import { leerConfigTerminados } from "./config";
import { areaM2, limpiarMedidas, textoDeMedidas } from "./geometria";
import {
  descripcionDeTerminado,
  leerMaterialesUsados,
  guardarCorteDeTerminado,
  leerTerminado,
  materialesADescontar,
  type TerminadoGuardado,
} from "./guardado";
import { piezasDeTerminado } from "./piezas";

describe("areaM2", () => {
  it("suma las seis caras de una caja cerrada", () => {
    // 2 × (30×20 + 30×20 + 20×20) = 3200 cm²
    expect(areaM2("caja_cerrada", { m1: 30, m2: 20, m3: 20 })).toBe(0.32);
  });

  it("a la caja abierta le falta la tapa", () => {
    // 30×20 + 2 × (30×20 + 20×20) = 2600 cm²
    expect(areaM2("caja_abierta", { m1: 30, m2: 20, m3: 20 })).toBe(0.26);
  });

  it("el cilindro lleva pared y dos tapas", () => {
    // π×20×25 + 2×π×10² = 2199.11 cm²
    expect(areaM2("cilindro", { diametro: 20, altura: 25 })).toBeCloseTo(0.2199, 4);
  });

  it("el tambor de sorteo usa su largo como altura", () => {
    expect(areaM2("cilindro", { diametro: 20, m1: 25 })).toBe(areaM2("cilindro", { diametro: 20, altura: 25 }));
  });

  it("la lámina es una cara; plegada, el desarrollo", () => {
    expect(areaM2("lamina", { m1: 21, m2: 29.7 })).toBeCloseTo(0.0624, 4);
    expect(areaM2("lamina_plegada", { m1: 10, m2: 15, m3: 5 })).toBe(0.02);
    expect(areaM2("lamina_plegada", { m1: 10, m2: 15 })).toBe(0.015);
  });

  it("las letras van por altura, ancho proporcional y cuántas son", () => {
    // 10 letras de 20 cm, ancho 0.7 → 10 × 20 × 14 = 2800 cm²
    expect(areaM2("letras", { altura: 20, letras: 10 }, 0.7)).toBe(0.28);
  });

  it("no calcula sin todas sus medidas, ni la forma manual", () => {
    expect(areaM2("caja_cerrada", { m1: 30, m2: 20 })).toBeNull();
    expect(areaM2("letras", { altura: 20 })).toBeNull();
    expect(areaM2("manual", { m1: 30, m2: 20, m3: 20 })).toBeNull();
  });
});

describe("textos de medidas", () => {
  it("dice las medidas como se leen", () => {
    expect(textoDeMedidas({ m1: 30, m2: 20, m3: 20 })).toBe("30 × 20 × 20 cm");
    expect(textoDeMedidas({ diametro: 20, altura: 25 })).toBe("Ø 20 × 25 cm");
    expect(textoDeMedidas({ altura: 15, letras: 12 })).toBe("12 letras de 15 cm");
    expect(textoDeMedidas({})).toBe("");
  });

  it("limpia lo que no es una medida", () => {
    expect(limpiarMedidas({ m1: 30, m2: null, m3: 0, letras: 4.9 })).toEqual({ m1: 30, letras: 4 });
  });

  it("dice una medida estándar con su formato de papel", () => {
    const m: MedidaEstandar = {
      id: "x",
      orden: 1,
      m1: 21,
      m2: 29.7,
      m3: null,
      diametro: null,
      altura: null,
      alturaMax: null,
      formato: "A4",
      estimado: false,
      nota: null,
    };
    expect(textoDeMedidaEstandar(m)).toBe("A4 (21 × 29.7 cm)");
    expect(textoDeMedidaEstandar({ ...m, m1: null, m2: null, formato: null, altura: 10, alturaMax: 30 })).toBe(
      "10 a 30 cm de alto",
    );
  });
});

const PLANCHA = { productoId: 20, codigo: "F7E024", nombre: "ACRILICO ECO CRISTAL 3MM", anchoCm: 122, largoCm: 183, precio: 223.26 };

const entrada = (e: Partial<EntradaTerminado> = {}): EntradaTerminado => ({
  geometria: "caja_cerrada",
  medidas: { m1: 30, m2: 20, m3: 20 },
  areaManualM2: null,
  cantidad: 10,
  plancha: PLANCHA,
  accesorios: [],
  factor: 1,
  extras: [],
  mermaPct: 15,
  anchoDeLetra: 0.7,
  ...e,
});

describe("calcularTerminado", () => {
  it("estima las planchas con la merma y de ahí el costo", () => {
    const c = calcularTerminado(entrada());
    // 0.32 m² × 10 × 1.15 = 3.68 m²; la plancha tiene 2.2326 m².
    expect(c.areaUnidadM2).toBe(0.32);
    expect(c.areaTotalM2).toBe(3.68);
    expect(c.planchas).toBe(1.65);
    expect(c.materiales).toEqual([
      { productoId: 20, codigo: "F7E024", nombre: PLANCHA.nombre, unidad: "plancha", cantidad: 1.65, precio: 223.26, esPlancha: true },
    ]);
    expect(c.costoMaterial).toBe(368.38);
    expect(c.precioSugerido).toBe(36.84);
  });

  it("el factor multiplica el material y los extras se suman por unidad", () => {
    const c = calcularTerminado(entrada({ factor: 2.5, extras: [15, 4.5] }));
    // 36.838 × 2.5 + 19.5
    expect(c.precioSugerido).toBe(111.6);
  });

  it("los accesorios entran al costo, salvo los de cantidad cero", () => {
    const c = calcularTerminado(
      entrada({
        accesorios: [
          { productoId: 7, codigo: "CER-01", nombre: "CERRADURA", unidad: "Unidades", cantidad: 10, precio: 8 },
          { productoId: 8, codigo: "BIS-01", nombre: "BISAGRA", unidad: "Unidades", cantidad: 0, precio: 3 },
        ],
      }),
    );
    expect(c.materiales.map((m) => m.productoId)).toEqual([20, 7]);
    expect(c.costoMaterial).toBe(448.38);
  });

  it("el área a mano le gana a la de la forma", () => {
    const c = calcularTerminado(entrada({ areaManualM2: 0.5 }));
    expect(c.areaManual).toBe(true);
    expect(c.areaUnidadM2).toBe(0.5);
    expect(c.areaTotalM2).toBe(5.75);
  });

  it("sin plancha o sin área no estima planchas, y sin cantidad no sugiere precio", () => {
    expect(calcularTerminado(entrada({ plancha: null })).materiales).toEqual([]);
    expect(calcularTerminado(entrada({ geometria: "manual" })).planchas).toBe(0);
    expect(calcularTerminado(entrada({ cantidad: 0 })).precioSugerido).toBe(0);
  });
});

describe("piezasDeTerminado", () => {
  it("una caja cerrada son seis caras, por pares", () => {
    expect(piezasDeTerminado("caja_cerrada", { m1: 30, m2: 20, m3: 10 })).toEqual([
      { nombre: "Base y tapa", ancho: 30, alto: 20, cantidad: 2 },
      { nombre: "Frente y fondo", ancho: 30, alto: 10, cantidad: 2 },
      { nombre: "Laterales", ancho: 20, alto: 10, cantidad: 2 },
    ]);
  });

  it("a la abierta le falta la tapa", () => {
    expect(piezasDeTerminado("caja_abierta", { m1: 30, m2: 20, m3: 10 })?.[0]).toEqual({
      nombre: "Base",
      ancho: 30,
      alto: 20,
      cantidad: 1,
    });
  });

  it("junta las caras de la misma medida, aunque estén giradas", () => {
    expect(piezasDeTerminado("caja_cerrada", { m1: 20, m2: 20, m3: 20 })).toEqual([
      { nombre: "Base y tapa, frente y fondo, laterales", ancho: 20, alto: 20, cantidad: 6 },
    ]);
    // 30×20 (base) y 20×30 (frente, girado) son la misma pieza.
    expect(piezasDeTerminado("caja_cerrada", { m1: 30, m2: 20, m3: 30 })?.map((p) => p.cantidad)).toEqual([4, 2]);
  });

  it("el cilindro: la pared desarrollada, al milímetro hacia arriba, y dos tapas", () => {
    expect(piezasDeTerminado("cilindro", { diametro: 20, altura: 25 })).toEqual([
      { nombre: "Pared (se curva)", ancho: 62.9, alto: 25, cantidad: 1 },
      { nombre: "Tapas", ancho: 20, alto: 20, cantidad: 2 },
    ]);
    expect(piezasDeTerminado("cilindro", { diametro: 20, m1: 25 })).toEqual(
      piezasDeTerminado("cilindro", { diametro: 20, altura: 25 }),
    );
  });

  it("láminas y letras", () => {
    expect(piezasDeTerminado("lamina", { m1: 21, m2: 29.7 })).toEqual([{ nombre: "Lámina", ancho: 21, alto: 29.7, cantidad: 1 }]);
    expect(piezasDeTerminado("lamina_plegada", { m1: 10, m2: 15, m3: 5 })?.[0]).toMatchObject({ ancho: 10, alto: 20 });
    expect(piezasDeTerminado("letras", { altura: 20, letras: 5 }, 0.7)).toEqual([
      { nombre: "Letras", ancho: 14, alto: 20, cantidad: 5 },
    ]);
  });

  it("sin medidas, o la forma manual, no se despieza", () => {
    expect(piezasDeTerminado("caja_cerrada", { m1: 30, m2: 20 })).toBeNull();
    expect(piezasDeTerminado("letras", { altura: 20 })).toBeNull();
    expect(piezasDeTerminado("manual", { m1: 30, m2: 20, m3: 20 })).toBeNull();
  });
});

const FORMATOS: FormatoTerminado[] = [
  { codigo: "F7E024", ancho: 122, alto: 183, precio: 223.26, productoId: 20, nombre: "ACRILICO ECO CRISTAL 3MM 122X183" },
  { codigo: "F7E025", ancho: 122, alto: 244, precio: 320, productoId: 21, nombre: "ACRILICO ECO CRISTAL 3MM 122X244" },
];

const conCortes = (e: Partial<EntradaTerminado> = {}) =>
  entrada({ formatos: FORMATOS, configCortes: CONFIG_CORTES_DEFECTO, espesorMm: 3, ...e });

describe("calcularTerminado con cortes", () => {
  it("acomoda las piezas de toda la línea y cuenta planchas enteras y fracciones", () => {
    const c = calcularTerminado(conCortes({ medidas: { m1: 20, m2: 20, m3: 20 }, cantidad: 10 }));
    expect(c.piezas).toEqual([{ nombre: "Base y tapa, frente y fondo, laterales", ancho: 20, alto: 20, cantidad: 60 }]);
    expect(c.corte).not.toBeNull();
    expect(c.corte!.noCaben).toEqual([]);
    expect(c.corte!.planchas.reduce((s, p) => s + p.piezas, 0)).toBe(60);
    expect(c.aviso).toBeNull();
    expect(c.mermaPct).toBe(0);

    const factores = c.corte!.planchas.reduce((s, p) => s + p.cobro.factor, 0);
    expect(c.planchas).toBe(Math.round(factores * 100) / 100);
    // Solo enteras o las fracciones del taller.
    expect(c.corte!.planchas.every((p) => [0.25, 0.5, 1].includes(p.cobro.factor))).toBe(true);

    const plancha = c.materiales[0];
    expect(plancha).toMatchObject({ esPlancha: true, codigo: c.formato!.codigo, cantidad: c.planchas, unidad: "plancha" });
    expect(c.costoMaterial).toBe(Math.round(c.planchas * plancha.precio * 100) / 100);
  });

  it("una sola caja chica sale de una fracción de plancha", () => {
    const c = calcularTerminado(conCortes({ cantidad: 1 }));
    expect(c.planchas).toBeLessThan(1);
    expect(c.materiales[0].cantidad).toBe(c.planchas);
  });

  it("si una pieza no entra en ninguna plancha, vuelve al cálculo por área y lo dice", () => {
    // La pared de un cilindro de 80 cm de diámetro mide 251.4 cm.
    const c = calcularTerminado(conCortes({ geometria: "cilindro", medidas: { diametro: 80, altura: 30 }, cantidad: 1 }));
    expect(c.corte).toBeNull();
    expect(c.aviso).toMatch(/Pared \(se curva\) \(251\.4 × 30 cm\) no entra/);
    expect(c.mermaPct).toBe(15);
    expect(c.materiales[0].codigo).toBe(PLANCHA.codigo);
  });

  it("el área a mano y la forma manual se estiman por área", () => {
    const manual = calcularTerminado(conCortes({ areaManualM2: 0.5 }));
    expect(manual.corte).toBeNull();
    expect(manual.aviso).toMatch(/área escrita a mano/);
    const sinForma = calcularTerminado(conCortes({ geometria: "manual" }));
    expect(sinForma.corte).toBeNull();
    expect(sinForma.aviso).toBeNull();
  });

  it("sin formatos con precio no hay cortes", () => {
    expect(calcularTerminado(conCortes({ formatos: [] })).corte).toBeNull();
    expect(calcularTerminado(entrada()).corte).toBeNull();
  });

  it("la ficha guarda las piezas y el acomodo", () => {
    const c = calcularTerminado(conCortes({ medidas: { m1: 20, m2: 20, m3: 20 }, cantidad: 2 }));
    const g = guardarCorteDeTerminado(c)!;
    expect(g.piezas).toEqual(c.piezas);
    expect(g.formato.codigo).toBe(c.formato!.codigo);
    expect(g.planchas).toHaveLength(c.corte!.planchas.length);
    expect(guardarCorteDeTerminado(calcularTerminado(entrada()))).toBeNull();
  });
});

describe("formatosConPrecio", () => {
  it("solo los activos con precio, una vez por código", () => {
    const formatos = [
      { codigo: "A", anchoCm: 122, largoCm: 183, activo: true },
      { codigo: "A", anchoCm: 122, largoCm: 183, activo: true },
      { codigo: "B", anchoCm: 122, largoCm: 244, activo: false },
      { codigo: "C", anchoCm: 100, largoCm: 100, activo: true },
    ];
    const precios = new Map([
      ["A", { productoId: 1, precio: 200, nombre: "PLANCHA A" }],
      ["B", { productoId: 2, precio: 300 }],
    ]);
    expect(formatosConPrecio(formatos, precios)).toEqual([
      { codigo: "A", ancho: 122, alto: 183, precio: 200, productoId: 1, nombre: "PLANCHA A" },
    ]);
  });
});

describe("planchaDeReferencia", () => {
  const formatos = [
    { codigo: "A", anchoCm: 122, largoCm: 183 },
    { codigo: "B", anchoCm: 122, largoCm: 244 },
    { codigo: "C", anchoCm: 60, largoCm: 90 },
    { codigo: "D", anchoCm: 122, largoCm: 244, activo: false },
  ];

  it("elige la más barata por metro cuadrado de las que tienen precio", () => {
    const precios = new Map([
      ["A", { productoId: 1, precio: 223 }],
      ["B", { productoId: 2, precio: 280 }],
      ["D", { productoId: 4, precio: 1 }],
    ]);
    expect(planchaDeReferencia(formatos, precios)?.codigo).toBe("B");
  });

  it("no hay referencia si ninguna tiene precio", () => {
    expect(planchaDeReferencia(formatos, new Map())).toBeNull();
    expect(planchaDeReferencia(formatos, new Map([["A", { productoId: 1, precio: 0 }]]))).toBeNull();
  });
});

const guardado: TerminadoGuardado = {
  version: 1,
  estandar: true,
  productoCodigo: "CAJ-004",
  tipoCodigo: "CAJ",
  tipoNombre: "Caja",
  nombre: "Caja de seguridad",
  geometria: "caja_cerrada",
  medidas: { m1: 30, m2: 20, m3: 20 },
  medidaEstandar: true,
  material: { grupoId: "g1", material: "Acrílico ECO", color: "Cristal", espesorMm: 4 },
  opciones: [
    { clase: "complemento", nombre: "Cerradura con llave", extra: 15 },
    { clase: "acabado", nombre: "Brillante (pulido)", extra: 0 },
  ],
  texto: null,
  notas: "Logo al frente",
  areaUnidadM2: 0.32,
  areaManual: false,
  mermaPct: 15,
  materiales: [
    { productoId: 20, codigo: "F7E036", nombre: "ACRILICO ECO CRISTAL 4MM", unidad: "plancha", cantidad: 1.65, precio: 300, esPlancha: true },
    { productoId: 7, codigo: "CER-01", nombre: "CERRADURA", unidad: "Unidades", cantidad: 10, precio: 8, esPlancha: false },
  ],
  costoMaterial: 575,
  factor: 2,
  precioSugerido: 130,
  precioUnitario: 120,
  reservar: true,
  corte: null,
};

describe("la ficha guardada", () => {
  it("se lee tal como se guardó", () => {
    expect(leerTerminado(JSON.parse(JSON.stringify(guardado)))).toEqual(guardado);
  });

  it("una ficha de antes, sin cortes, se lee con corte null", () => {
    const vieja: Record<string, unknown> = { ...guardado };
    delete vieja.corte;
    expect(leerTerminado(vieja)?.corte).toBeNull();
  });

  it("lo que no es una ficha es null", () => {
    expect(leerTerminado(null)).toBeNull();
    expect(leerTerminado({ version: 2 })).toBeNull();
  });

  it("se dice en un renglón", () => {
    expect(descripcionDeTerminado(guardado)).toBe(
      "Medidas: 30 × 20 × 20 cm. Material: Acrílico ECO · Cristal · 4 mm. Acabado: Brillante (pulido). " +
        "Complementos: Cerradura con llave. Notas: Logo al frente",
    );
  });

  it("descuenta lo anotado y, si nadie anotó, lo estimado", () => {
    expect(materialesADescontar(guardado, null).map((m) => [m.productoId, m.cantidad])).toEqual([
      [20, 1.65],
      [7, 10],
    ]);
    const usados = [
      { productoId: 20, codigo: "F7E036", nombre: "ACRILICO", unidad: "plancha", cantidad: 2 },
      { productoId: 20, codigo: "F7E036", nombre: "ACRILICO", unidad: "plancha", cantidad: 0.5 },
      { productoId: 9, codigo: null, nombre: "PEGAMENTO", unidad: null, cantidad: 0 },
    ];
    expect(materialesADescontar(guardado, usados).map((m) => [m.productoId, m.cantidad])).toEqual([[20, 2.5]]);
    expect(materialesADescontar(guardado, [])).toEqual([]);
  });

  it("lee los materiales usados", () => {
    expect(leerMaterialesUsados(null)).toBeNull();
    expect(leerMaterialesUsados([{ productoId: 20, cantidad: 2 }])).toEqual([
      { productoId: 20, codigo: null, nombre: "", unidad: null, cantidad: 2 },
    ]);
  });
});

describe("el producto terminado entre las líneas", () => {
  const linea: LineaGuardada = {
    posicion: 1,
    productoId: 90,
    nombre: "Caja de seguridad",
    codigo: "CAJ-004",
    descripcion: descripcionDeTerminado(guardado),
    cantidad: 10,
    precioUnitario: 120,
    corte: null,
    terminado: guardado,
    importe: 1200,
  };

  it("entra al detalle del pedido con su ficha", () => {
    expect(detalleDesdeLineas([linea])).toBe(`10 × [CAJ-004] Caja de seguridad — ${descripcionDeTerminado(guardado)}`);
  });

  it("de la venta sale el producto terminado, no su material", () => {
    const deVenta: LineaDePedido = {
      posicion: 1,
      productoId: 90,
      nombre: linea.nombre,
      codigo: linea.codigo,
      descripcion: linea.descripcion,
      cantidad: 10,
      corte: null,
      planchasUsadas: null,
      terminado: guardado,
      materialesUsados: null,
      importe: null,
      produccionId: null,
      produccionNombre: null,
      produccionCerrada: false,
    };
    expect([...cantidadesParaDescontar([deVenta])]).toEqual([[90, 10]]);
  });

  it("en el formulario suma cantidad × precio y se reemplaza en su sitio", () => {
    const nueva: Omit<LineaTerminado, "tipo" | "clave"> = {
      productoCodigo: "CAJ-004",
      tipoCodigo: "CAJ",
      nombre: "Caja de seguridad",
      geometria: "caja_cerrada",
      medidas: { m1: 30, m2: 20, m3: 20 },
      grupoId: "g1",
      materialTexto: "Acrílico ECO · Cristal · 4 mm",
      color: null,
      opciones: [],
      opcionesTexto: [],
      texto: "",
      notas: "",
      areaManualM2: null,
      accesorios: [],
      cantidad: 10,
      precioUnitario: 120,
      reservar: false,
      calculo: calcularTerminado(entrada()),
    };
    const { lineas, clave } = ponerTerminado([], nueva, () => "t1");
    expect(importeDe(lineas[0])).toBe(1200);
    expect(problemaDeLineas(lineas)).toBeNull();

    const editada = ponerTerminado(lineas, { ...nueva, clave, cantidad: 3 });
    expect(editada.lineas).toHaveLength(1);
    expect(importeDe(editada.lineas[0])).toBe(360);
    expect(problemaDeLineas(ponerTerminado([], { ...nueva, nombre: " " }).lineas)).toMatch(/nombre/);
  });
});

describe("esquemaLineaTerminado", () => {
  const base = {
    tipo: "terminado" as const,
    productoCodigo: "CAJ-004",
    nombre: null,
    tipoCodigo: "CAJ",
    medidas: { m1: 30, m2: 20, m3: 20, diametro: null, altura: null, letras: null },
    grupoId: "3f2b0c0e-6a55-4f6e-9d0a-0b8a1f1d2c3e",
    color: null,
    opciones: [3, 9],
    texto: null,
    notas: null,
    areaM2: null,
    accesorios: [{ productoId: 7, cantidad: 10 }],
    cantidad: 10,
    precioUnitario: 120,
    reservar: true,
  };

  it("acepta un estándar y un personalizado", () => {
    expect(esquemaLineaTerminado.safeParse(base).success).toBe(true);
    expect(
      esquemaLineaTerminado.safeParse({ ...base, productoCodigo: null, nombre: "Exhibidor especial", grupoId: null }).success,
    ).toBe(true);
  });

  it("un estándar necesita material y un personalizado, nombre", () => {
    expect(esquemaLineaTerminado.safeParse({ ...base, grupoId: null }).success).toBe(false);
    expect(esquemaLineaTerminado.safeParse({ ...base, productoCodigo: null, nombre: null }).success).toBe(false);
  });

  it("rechaza cantidades con decimales y precios negativos", () => {
    expect(esquemaLineaTerminado.safeParse({ ...base, cantidad: 1.5 }).success).toBe(false);
    expect(esquemaLineaTerminado.safeParse({ ...base, precioUnitario: -1 }).success).toBe(false);
  });
});

describe("configuración y etiquetas", () => {
  it("lo que falte de la configuración cae a su defecto", () => {
    expect(leerConfigTerminados(null)).toEqual({ mermaPct: 15, anchoDeLetra: 0.7 });
    expect(leerConfigTerminados({ mermaPct: 20, anchoDeLetra: -1 })).toEqual({ mermaPct: 20, anchoDeLetra: 0.7 });
    expect(leerConfigTerminados({ mermaPct: 0 })).toEqual({ mermaPct: 0, anchoDeLetra: 0.7 });
  });

  it("cada tipo del catálogo tiene su etiqueta de pedido", () => {
    expect(etiquetaDeTipo("ANF")).toBe("anforas");
    expect(etiquetaDeTipo("TAR")).toBe("tarecos");
    expect(etiquetaDeTipo(null)).toBe("otro");
    expect(etiquetaDeTipo("XYZ")).toBe("otro");
  });
});
