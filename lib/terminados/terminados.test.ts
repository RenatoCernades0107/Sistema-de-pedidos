import { describe, expect, it } from "vitest";
import { esquemaLineaTerminado } from "../esquemas";
import { importeDe, ponerTerminado, problemaDeLineas, type LineaTerminado } from "../lineas-cotizacion";
import { detalleDesdeLineas, type LineaGuardada } from "../cotizaciones";
import { cantidadesParaDescontar, type LineaDePedido } from "../pedido-lineas";
import { calcularTerminado, planchaDeReferencia, type EntradaTerminado } from "./calcular";
import { etiquetaDeTipo, textoDeMedidaEstandar, type MedidaEstandar } from "./catalogo";
import { leerConfigTerminados } from "./config";
import { areaM2, limpiarMedidas, textoDeMedidas } from "./geometria";
import {
  descripcionDeTerminado,
  leerMaterialesUsados,
  leerTerminado,
  materialesADescontar,
  type TerminadoGuardado,
} from "./guardado";

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
};

describe("la ficha guardada", () => {
  it("se lee tal como se guardó", () => {
    expect(leerTerminado(JSON.parse(JSON.stringify(guardado)))).toEqual(guardado);
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
