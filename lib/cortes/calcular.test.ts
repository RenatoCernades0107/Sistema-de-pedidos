import { describe, expect, it } from "vitest";
import {
  calcularConSobrante,
  calcularCorte,
  calcularMezcla,
  calcularEleccion,
  compararFormatos,
  desperdicioFisicoPct,
  filaDe,
  piezasEnSobrante,
  type EntradaCorte,
  type FormatoCorte,
} from "./calcular";
import { CONFIG_CORTES_DEFECTO, FRACCIONES_ESTANDAR, leerConfigCortes, type ConfigCortes } from "./config";
import { parametrosLaser, tiempoLaser } from "./laser";
import { tarifaManual } from "./manual";
import { EPS } from "./optimizador";

const config = CONFIG_CORTES_DEFECTO;
const F20: FormatoCorte = { codigo: "F20E001", ancho: 205, alto: 305, precio: 480 };
// El documento describe la plancha como 305×205; el resultado no depende de cuál lado es cuál.
const F20_APAISADA: FormatoCorte = { ...F20, ancho: 305, alto: 205 };

const corte = (piezas: [number, number, number][], extra: Partial<EntradaCorte> = {}): EntradaCorte => ({
  piezas: piezas.map(([ancho, alto, cantidad]) => ({ ancho, alto, cantidad })),
  espesorMm: 3,
  modalidad: "laser",
  rotable: true,
  ...extra,
});

describe("qué fracción de la plancha se cobra", () => {
  it("2 de 150×60 y una de 40×40: caben en media plancha, y se cobra media con recargo", () => {
    const r = calcularCorte(corte([[150, 60, 2], [40, 40, 1]]), F20_APAISADA, config);
    expect(r.planchas).toHaveLength(1);
    expect(r.planchas[0].cobro).toMatchObject({ nombre: "1/2", factor: 0.5, ancho: 152.5, alto: 205 });
    // 480 / 2 × 1.10
    expect(r.material).toBe(264);
  });

  it("2 de 250×60 usan el 48 %, pero no entran en ninguna media: plancha completa", () => {
    const r = calcularCorte(corte([[250, 60, 2]]), F20_APAISADA, config);
    expect(r.planchas[0].usoPct).toBeGreaterThan(47);
    expect(r.planchas[0].usoPct).toBeLessThan(50);
    expect(r.planchas[0].cobro).toMatchObject({ nombre: "1", factor: 1 });
    expect(r.planchas[0].cobro.nota).toMatch(/48 % de uso, pero las piezas no caben/);
    expect(r.material).toBe(480);
  });

  it("una de 140×95 cabe en un cuarto", () => {
    const r = calcularCorte(corte([[140, 95, 1]]), F20_APAISADA, config);
    expect(r.planchas[0].cobro).toMatchObject({ nombre: "1/4", ancho: 152.5, alto: 102.5 });
    // 480 / 4 × 1.10
    expect(r.material).toBe(132);
  });

  it("por encima de la mitad del área se cobra completa, sin nota", () => {
    const r = calcularCorte(corte([[200, 200, 1]]), F20_APAISADA, config);
    expect(r.planchas[0].cobro).toMatchObject({ factor: 1, nota: null });
  });

  it("nunca se cobra menos área de la que se usa, y las piezas quedan dentro de lo cobrado", () => {
    const pedidos: [number, number, number][][] = [
      [[150, 60, 2], [40, 40, 1]],
      [[60, 80, 10]],
      [[30, 30, 7], [100, 20, 3]],
      [[140, 95, 1]],
      [[70, 100, 3], [20, 20, 9]],
    ];
    for (const pedido of pedidos) {
      const r = calcularCorte(corte(pedido), F20, config);
      for (const p of r.planchas) {
        expect(p.cobro.factor).toBeGreaterThanOrEqual(p.areaUsada / (p.ancho * p.alto) - 1e-9);
        // Piezas, libres y sobrante cubren la plancha entera.
        const suma = p.paneles.reduce((s, x) => s + (x.x2 - x.x1) * (x.y2 - x.y1), 0);
        expect(suma).toBeCloseTo(p.ancho * p.alto, 4);
        for (const panel of p.paneles.filter((x) => !x.libre)) {
          expect(panel.x2).toBeLessThanOrEqual(p.cobro.ancho + EPS);
          expect(panel.y2).toBeLessThanOrEqual(p.cobro.alto + EPS);
        }
        // El sobrante queda fuera de lo cobrado.
        for (const s of p.paneles.filter((x) => x.sobrante)) {
          expect(s.x1 >= p.cobro.ancho - EPS || s.y1 >= p.cobro.alto - EPS).toBe(true);
        }
      }
    }
  });

  it("sin fracciones configuradas, siempre plancha completa", () => {
    const sin: ConfigCortes = { ...config, cobro: { ...config.cobro, fracciones: [] } };
    expect(calcularCorte(corte([[40, 40, 1]]), F20, sin).material).toBe(480);
  });

  it("10 piezas de 60×80 en 122×183: dos planchas completas y media", () => {
    const f7: FormatoCorte = { codigo: "F7E030", ancho: 122, alto: 183, precio: 200 };
    const r = calcularCorte(corte([[60, 80, 10]]), f7, config);
    expect(r.planchas).toHaveLength(3);
    expect(r.planchas.map((p) => p.cobro.nombre).sort()).toEqual(["1", "1", "1/2"]);
    // 200 + 200 + 200/2 × 1.10
    expect(r.material).toBe(510);
    expect(r.piezas).toBe(10);
  });
});

describe("con 1/16, 1/8 y 3/4 encendidas", () => {
  const todas: ConfigCortes = {
    ...config,
    cobro: { ...config.cobro, fracciones: leerConfigCortes({ cobro: { ...config.cobro, fracciones: [...FRACCIONES_ESTANDAR] } }).cobro.fracciones },
  };
  const F7: FormatoCorte = { codigo: "F7E030", ancho: 122, alto: 183, precio: 200 };

  it.each([
    // [pieza, fracción, monto]: 200 × factor × (1 + su recargo)
    [[30, 40], "1/16", 15],
    [[50, 40], "1/8", 30],
    [[100, 130], "3/4", 165],
  ] as const)("%j se cobra como %s", ([ancho, alto], nombre, monto) => {
    const r = calcularCorte(corte([[ancho, alto, 1]]), F7, todas);
    expect(r.planchas[0].cobro.nombre).toBe(nombre);
    expect(r.material).toBe(monto);
  });

  it("se prueban de la más chica a la más grande", () => {
    expect(todas.cobro.fracciones.map((f) => f.nombre)).toEqual(["1/16", "1/8", "1/4", "1/2", "3/4"]);
  });

  it("nunca se cobra menos área de la que se usa, y el sobrante queda fuera de lo cobrado", () => {
    for (const pedido of [[[30, 40, 1]], [[50, 40, 2]], [[100, 130, 1]], [[60, 45, 3]], [[20, 20, 12]]] as [number, number, number][][]) {
      for (const p of calcularCorte(corte(pedido), F7, todas).planchas) {
        expect(p.cobro.factor).toBeGreaterThanOrEqual(p.areaUsada / (p.ancho * p.alto) - 1e-9);
        const suma = p.paneles.reduce((s, x) => s + (x.x2 - x.x1) * (x.y2 - x.y1), 0);
        expect(suma).toBeCloseTo(p.ancho * p.alto, 4);
        for (const s of p.paneles.filter((x) => x.sobrante)) {
          expect(s.x1 >= p.cobro.ancho - EPS || s.y1 >= p.cobro.alto - EPS).toBe(true);
        }
      }
    }
  });
});

describe("servicio de corte", () => {
  it("láser: perímetro entre velocidad, más pierce y overhead, por el costo del minuto y el IGV", () => {
    // 10 piezas de 60×80 a 3 mm: perímetro 2800 mm, 20 mm/s × 0.9 = 18 mm/s.
    const t = tiempoLaser([{ ancho: 60, alto: 80, cantidad: 10 }], 3, config.laser);
    const porPieza = 2800 / 18 + 0.1 + 2.5;
    expect(t.segundos).toBeCloseTo(10 * porPieza, 6);
    expect(t.costo).toBeCloseTo(((10 * porPieza) / 60) * 0.8, 6);

    const sinRedondeo: ConfigCortes = { ...config, cobro: { ...config.cobro, redondearAlSol: false } };
    const r = calcularCorte(corte([[60, 80, 10]]), F20, sinRedondeo);
    expect(r.servicio).toBeCloseTo(t.costo * 1.18, 2);
    expect(r.minutosLaser).toBeCloseTo(t.segundos / 60, 6);
  });

  it("la tabla del láser interpola entre espesores y se queda en los extremos", () => {
    expect(parametrosLaser(config.laser.tabla, 3).velocidad).toBe(20);
    expect(parametrosLaser(config.laser.tabla, 3.5).velocidad).toBeCloseTo(18.5, 6);
    expect(parametrosLaser(config.laser.tabla, 1).velocidad).toBe(30);
    expect(parametrosLaser(config.laser.tabla, 50).velocidad).toBe(2);
    // Las pasadas no se quedan a medias.
    const dos = [
      { mm: 10, velocidad: 6, pierce: 0.1, pasadas: 1 },
      { mm: 20, velocidad: 2, pierce: 0.1, pasadas: 2 },
    ];
    expect(parametrosLaser(dos, 12).pasadas).toBe(2);
  });

  it("manual: metros lineales de cutter por la tarifa de ese espesor", () => {
    const sinRedondeo: ConfigCortes = { ...config, cobro: { ...config.cobro, redondearAlSol: false } };
    // Media plancha de 122×183 (61×183) partida al medio: el corte que la separa
    // (183) más uno de 61.
    const f7: FormatoCorte = { codigo: "F7E030", ancho: 122, alto: 183, precio: 200 };
    const r = calcularCorte(corte([[61, 91.5, 2]], { modalidad: "manual", espesorMm: 4 }), f7, sinRedondeo);
    expect(r.planchas[0].cobro.nombre).toBe("1/2");
    expect(r.metrosManual).toBeCloseTo(2.44);
    // 2.44 m × S/ 5
    expect(r.servicio).toBeCloseTo(12.2);
    expect(r.minutosLaser).toBeNull();
    expect(r.problema).toBeNull();
    expect(r.desglose.at(-2)?.etiqueta).toBe("Corte manual: 2.44 m lineales × S/ 5.00/m (4 mm)");
    expect(r.planchas[0].cortes?.map((c) => c.largo)).toEqual([183, 61]);
  });

  it("la tarifa manual va por tramos: cada fila vale hasta su espesor", () => {
    const t = config.manual.tarifas;
    expect(tarifaManual(t, 1.5)).toBe(3);
    expect(tarifaManual(t, 2)).toBe(3);
    expect(tarifaManual(t, 2.5)).toBe(4);
    expect(tarifaManual(t, 3)).toBe(4);
    expect(tarifaManual(t, 4)).toBe(5);
    expect(tarifaManual(t, 5)).toBe(6);
    expect(tarifaManual(t, 6)).toBe(6);
    expect(tarifaManual(t, 8)).toBeNull();
  });

  it("el láser no trae cortes de cutter ni metros", () => {
    const r = calcularCorte(corte([[30, 30, 5]]), F20, config);
    expect(r.metrosManual).toBeNull();
    expect(r.planchas.every((p) => p.cortes === undefined)).toBe(true);
  });

  it("manual más grueso que la tabla: se dice, no se inventa un precio", () => {
    expect(tarifaManual(config.manual.tarifas, 10)).toBeNull();
    const r = calcularCorte(corte([[30, 30, 5]], { modalidad: "manual", espesorMm: 10 }), F20, config);
    expect(r.problema).toMatch(/No hay tarifa de corte manual para 10 mm/);
  });

  it("el total se redondea al sol hacia arriba y el redondeo lo absorbe el servicio", () => {
    const r = calcularCorte(corte([[60, 80, 10]]), F20, config);
    expect(Number.isInteger(r.total)).toBe(true);
    expect(r.material + r.servicio).toBeCloseTo(r.total, 2);
    expect(r.desglose.at(-1)).toMatchObject({ etiqueta: "Total", monto: r.total, esTotal: true });
  });
});

describe("elección de formato", () => {
  const formatos: FormatoCorte[] = [
    { codigo: "F7E030", ancho: 122, alto: 183, precio: 200 },
    { codigo: "F9.5E030", ancho: 122, alto: 244, precio: 265 },
    { codigo: "F20E030", ancho: 205, alto: 305, precio: 560 },
  ];

  it("ordena por precio total, no por desperdicio", () => {
    const r = compararFormatos(corte([[60, 80, 10]]), formatos, config);
    expect(r.map((c) => c.formato.codigo)).toHaveLength(3);
    for (let i = 1; i < r.length; i++) expect(r[i].total).toBeGreaterThanOrEqual(r[i - 1].total);
  });

  it("con el criterio de tamaño, va primero la plancha más chica que sirve", () => {
    const r = compararFormatos(corte([[60, 80, 10]]), formatos, config, [], "tamano");
    expect(r.map((c) => c.formato.codigo)).toEqual(["F7E030", "F9.5E030", "F20E030"]);
    const areas = r.map((c) => c.formato.ancho * c.formato.alto);
    expect(areas).toEqual([...areas].sort((a, b) => a - b));
  });

  it("con el criterio de tamaño, lo chico gana aunque desperdicie más", () => {
    // 100 × 110: en 122×183 queda mucho retazo; en 122×244 se aprovecha más.
    const entrada = corte([[100, 110, 2]]);
    const porPrecio = compararFormatos(entrada, formatos, config);
    const porTamano = compararFormatos(entrada, formatos, config, [], "tamano");
    expect(porTamano[0].formato.codigo).toBe("F7E030");
    const chico = porTamano.find((c) => c.formato.codigo === "F7E030")!;
    const otro = porTamano.find((c) => c.formato.codigo === "F9.5E030")!;
    expect(chico.desperdicioPct).toBeGreaterThan(otro.desperdicioPct);
    expect(porPrecio).toHaveLength(porTamano.length);
  });

  it("con el criterio de tamaño, los formatos donde no cabe siguen al final", () => {
    const r = compararFormatos(corte([[200, 150, 1]]), formatos, config, [], "tamano");
    expect(r[0].formato.codigo).toBe("F20E030");
    expect(r[0].problema).toBeNull();
    expect(r.slice(1).every((c) => c.problema)).toBe(true);
  });

  it("con la merma mínima, va primero el que menos desperdicia", () => {
    const entrada = corte([[100, 110, 2]]);
    const r = compararFormatos(entrada, formatos, config, [], "merma");
    for (let i = 1; i < r.length; i++) expect(r[i].desperdicioPct).toBeGreaterThanOrEqual(r[i - 1].desperdicioPct);
  });

  it("con el promedio, el primero no es peor que el resto en precio y merma a la vez", () => {
    const entrada = corte([[100, 110, 2]]);
    const r = compararFormatos(entrada, formatos, config, [], "promedio");
    expect(r).toHaveLength(3);
    const [a, ...otros] = r;
    for (const o of otros) {
      expect(o.total < a.total && o.desperdicioPct < a.desperdicioPct).toBe(false);
    }
  });

  it("sin criterio usa la política guardada en la configuración", () => {
    const entrada = corte([[100, 110, 2]]);
    const porConfig = compararFormatos(entrada, formatos, { ...config, sugerencia: { politica: "tamano" } });
    expect(porConfig.map((c) => c.formato.codigo)).toEqual(
      compararFormatos(entrada, formatos, config, [], "tamano").map((c) => c.formato.codigo),
    );
  });

  it("el formato donde una pieza no cabe va al final, con su motivo", () => {
    const r = compararFormatos(corte([[200, 150, 1]]), formatos, config);
    expect(r[0].formato.codigo).toBe("F20E030");
    expect(r[0].problema).toBeNull();
    expect(r.at(-1)!.problema).toMatch(/1 pieza no cabe/);
    expect(r.at(-1)!.noCaben).toEqual([{ ancho: 200, alto: 150, cantidad: 1 }]);
  });

  it("un material que no se gira respeta la orientación", () => {
    const f: FormatoCorte = { codigo: "X", ancho: 100, alto: 50, precio: 100 };
    expect(calcularCorte(corte([[40, 90, 1]]), f, config).problema).toBeNull();
    expect(calcularCorte(corte([[40, 90, 1]], { rotable: false }), f, config).problema).toMatch(/no cabe/);
  });
});

describe("bordes", () => {
  it("sin piezas o con demasiadas, lo dice", () => {
    expect(calcularCorte(corte([]), F20, config).problema).toMatch(/al menos una pieza/);
    expect(calcularCorte(corte([[10, 10, 5000]]), F20, config).problema).toMatch(/demasiadas/);
  });

  it("cada panel sabe de qué fila del pedido es", () => {
    const r = calcularCorte(corte([[60, 80, 2], [30, 30, 1]]), F20, config);
    const filas = r.planchas.flatMap((p) => p.paneles.filter((x) => !x.libre).map((x) => filaDe(x.piezaId!)));
    expect(filas.sort()).toEqual([1, 1, 2]);
  });
});

describe("configuración", () => {
  it("lo que falta o no sirve cae a su defecto, grupo por grupo", () => {
    expect(leerConfigCortes(null)).toEqual(config);
    expect(leerConfigCortes("basura")).toEqual(config);

    const c = leerConfigCortes({
      cobro: { fracciones: config.cobro.fracciones, redondearAlSol: false },
      laser: { tabla: [] },
      manual: { tarifas: [{ hastaMm: 4, solesPorMetro: 7 }, { hastaMm: 2, solesPorMetro: 3 }] },
    });
    expect(c.cobro.redondearAlSol).toBe(false);
    expect(c.laser).toEqual(config.laser);
    // Ordenada por espesor.
    expect(c.manual.tarifas).toEqual([{ hastaMm: 2, solesPorMetro: 3 }, { hastaMm: 4, solesPorMetro: 7 }]);
    expect(c.servicios).toEqual({ laser: "SRV002", manual: "SRV001" });
  });

  it("la configuración de antes: el recargo único y el precio por pieza", () => {
    const sinRecargo = config.cobro.fracciones.map((f) => ({ nombre: f.nombre, factor: f.factor, formas: f.formas }));
    const c = leerConfigCortes({
      cobro: {
        recargoPct: 25,
        fracciones: [...sinRecargo, { nombre: "tira", factor: 0.3, formas: [[1, 0.3]] }],
        redondearAlSol: false,
      },
      manual: { precios: [{ mm: 3, precio: 3 }] },
    });
    // Las estándar toman su recargo nuevo; una hecha a medida, el único de antes.
    expect(c.cobro.fracciones.map((f) => [f.nombre, f.recargoPct])).toEqual([
      ["1/4", 10],
      ["tira", 25],
      ["1/2", 10],
    ]);
    expect(c.cobro.redondearAlSol).toBe(false);
    // Un precio por pieza no se lee como si fuera por metro.
    expect(c.manual).toEqual(config.manual);
  });
});

describe("con sobrantes del almacén (piloto)", () => {
  const F7: FormatoCorte = { codigo: "F7E024", ancho: 122, alto: 183, precio: 200 };

  it("usa primero el sobrante donde caben las piezas, sin cambiar el precio", () => {
    const entrada = corte([[60, 80, 2]]);
    const sin = calcularCorte(entrada, F7, config);
    const con = calcularCorte(entrada, F7, config, [{ id: "SOB-00012", ancho: 61, alto: 183 }]);

    expect(con.planchas).toHaveLength(1);
    expect(con.planchas[0].origen).toEqual({ tipo: "sobrante", id: "SOB-00012" });
    expect(con.total).toBe(sin.total);
    expect(con.material).toBe(sin.material);
    expect(con.desglose).toEqual(sin.desglose);
  });

  it("si las piezas no caben en el sobrante, abre planchas nuevas como siempre", () => {
    const r = calcularCorte(corte([[100, 100, 1]]), F7, config, [{ id: "SOB-1", ancho: 61, alto: 183 }]);
    expect(r.planchas.map((p) => p.origen.tipo)).toEqual(["plancha"]);
  });

  it("reparte: lo que entra en el sobrante sale de ahí y el resto de planchas nuevas", () => {
    const r = calcularCorte(corte([[60, 80, 6]]), F7, config, [{ id: "SOB-1", ancho: 61, alto: 183 }]);
    expect(r.planchas.map((p) => p.origen.tipo).sort()).toEqual(["plancha", "sobrante"]);
    expect(r.planchas.reduce((s, p) => s + p.piezas, 0)).toBe(6);
  });
});

describe("plancha o sobrante elegidos a mano", () => {
  const F7: FormatoCorte = { codigo: "F7E024", ancho: 122, alto: 183, precio: 200 };
  const SOB = { id: "SOB-1", ancho: 61, alto: 183 };

  it("un formato elegido usa solo planchas nuevas, aunque haya sobrantes", () => {
    const r = calcularEleccion(corte([[60, 80, 2]]), [F7, F20], config, [SOB], { tipo: "formato", codigo: "F20E001" });
    expect(r?.formato.codigo).toBe("F20E001");
    expect(r?.planchas.every((p) => p.origen.tipo === "plancha")).toBe(true);
  });

  it("un sobrante elegido se usa, y lo que no entra va a planchas nuevas del formato que sirve", () => {
    const r = calcularEleccion(corte([[60, 80, 6]]), [F7, F20], config, [SOB], { tipo: "sobrante", codigo: "SOB-1" }, "tamano");
    expect(r?.formato.codigo).toBe("F7E024");
    expect(piezasEnSobrante(r!, "SOB-1")).toBeGreaterThan(0);
    expect(r?.planchas.reduce((s, p) => s + p.piezas, 0)).toBe(6);
    expect(r?.problema).toBeNull();
  });

  it("lo elegido que ya no existe devuelve null", () => {
    expect(calcularEleccion(corte([[60, 80, 1]]), [F7], config, [], { tipo: "sobrante", codigo: "SOB-9" })).toBeNull();
    expect(calcularEleccion(corte([[60, 80, 1]]), [F7], config, [], { tipo: "formato", codigo: "X" })).toBeNull();
  });

  it("si ninguna pieza entra en el sobrante, lo dice", () => {
    const r = calcularConSobrante(corte([[100, 100, 1]]), F7, config, SOB);
    expect(r.problema).toMatch(/SOB-1/);
  });

  it("el desperdicio físico cuenta el área del sobrante y no la de una plancha nueva", () => {
    const r = calcularConSobrante(corte([[60, 80, 2]]), F7, config, SOB);
    const area = 61 * 183;
    expect(desperdicioFisicoPct(r)).toBeCloseTo((1 - (2 * 60 * 80) / area) * 100, 5);
  });
});

describe("combinar formatos en un corte", () => {
  // El pedido P2611-002: piezas largas (137 a 187 cm) en acrílico de 4 mm.
  const F9: FormatoCorte = { codigo: "F9", ancho: 122, alto: 244, precio: 300 };
  const F7c: FormatoCorte = { codigo: "F7", ancho: 122, alto: 183, precio: 230 };
  const pedido = corte(
    [
      [138.5, 62.5, 1], [137, 14, 1], [137.2, 60.2, 1], [137.5, 14, 2], [178, 25, 1], [186.5, 61, 1],
      [176.5, 25, 1], [176.5, 32.5, 1], [187, 61, 1], [137.5, 14, 2], [137.5, 65, 1],
    ],
    { espesorMm: 4 },
  );

  it("mezcla formatos cuando baja el precio y la merma", () => {
    const solo = calcularCorte(pedido, F9, config);
    const mezcla = calcularMezcla(pedido, F9, [F9, F7c], config)!;
    expect(mezcla).not.toBeNull();
    expect(mezcla.problema).toBeNull();
    expect(mezcla.formatos.map((f) => f.codigo).sort()).toEqual(["F7", "F9"]);
    expect(mezcla.material).toBeLessThan(solo.material);
    expect(mezcla.desperdicioPct).toBeLessThan(solo.desperdicioPct);
    expect(mezcla.mezclaDesde).toBe("F9");
    // Las piezas de más de 183 cm siguen en planchas de 244.
    for (const p of mezcla.planchas) {
      const largo = Math.max(...p.paneles.filter((x) => !x.libre).map((x) => Math.max(x.x2 - x.x1, x.y2 - x.y1)));
      expect(largo).toBeLessThanOrEqual(Math.max(p.ancho, p.alto) + EPS);
    }
    // Cada plancha cobra al precio de su formato.
    const precios = { F9: 300, F7: 230 } as Record<string, number>;
    for (const p of mezcla.planchas) {
      expect(p.origen.tipo === "plancha" && p.origen.formato).toBeTruthy();
      const codigo = (p.origen as { formato: string }).formato;
      expect(p.cobro.monto).toBeLessThanOrEqual(precios[codigo] + EPS);
    }
    // No se pierde ninguna pieza.
    expect(mezcla.planchas.reduce((s, p) => s + p.piezas, 0)).toBe(13);
  });

  it("es determinista: el servidor llega a lo mismo", () => {
    const a = calcularMezcla(pedido, F9, [F9, F7c], config)!;
    const b = calcularMezcla(pedido, F9, [F9, F7c], config)!;
    expect(b.total).toBe(a.total);
    expect(b.planchas.map((p) => p.origen)).toEqual(a.planchas.map((p) => p.origen));
  });

  it("sin otro formato, o si no mejora, no hay mezcla", () => {
    expect(calcularMezcla(pedido, F9, [F9], config)).toBeNull();
    // Una plancha más chica y más cara no conviene.
    const cara = { ...F7c, precio: 900 };
    expect(calcularMezcla(pedido, F9, [F9, cara], config)).toBeNull();
  });

  it("compararFormatos la ofrece solo si se pide, y la pone primero si es la más barata", () => {
    expect(compararFormatos(pedido, [F9, F7c], config).every((c) => c.formatos.length === 1)).toBe(true);
    const con = compararFormatos(pedido, [F9, F7c], config, [], "precio", true);
    expect(con[0].formatos.length).toBe(2);
    // Con sobrantes del almacén (el piloto) no se mezcla.
    const conSobrantes = compararFormatos(pedido, [F9, F7c], config, [{ id: "S1", ancho: 50, alto: 50 }], "precio", true);
    expect(conSobrantes.every((c) => c.formatos.length === 1)).toBe(true);
  });

  it("con la política de merma también decide la merma", () => {
    const mezcla = calcularMezcla(pedido, F9, [F9, F7c], config, "merma")!;
    expect(mezcla.desperdicioPct).toBeLessThan(calcularCorte(pedido, F9, config).desperdicioPct);
  });
});

describe("formatos elegidos para optimizar", () => {
  const F9: FormatoCorte = { codigo: "F9", ancho: 122, alto: 244, precio: 300 };
  const F8: FormatoCorte = { codigo: "F8", ancho: 158, alto: 249, precio: 380 };
  const F7c: FormatoCorte = { codigo: "F7", ancho: 122, alto: 183, precio: 230 };
  const pedido = corte(
    [
      [138.5, 62.5, 1], [137, 14, 1], [137.2, 60.2, 1], [137.5, 14, 2], [178, 25, 1], [186.5, 61, 1],
      [176.5, 25, 1], [176.5, 32.5, 1], [187, 61, 1], [137.5, 14, 2], [137.5, 65, 1],
    ],
    { espesorMm: 4 },
  );

  it("solo se calcula y se combina con los formatos que se pasan", () => {
    const todos = compararFormatos(pedido, [F9, F8, F7c], config, [], "precio", true);
    const soloDos = compararFormatos(pedido, [F9, F8], config, [], "precio", true);
    expect(todos.length).toBeGreaterThan(soloDos.length);
    for (const c of soloDos) {
      for (const f of c.formatos) expect(["F9", "F8"]).toContain(f.codigo);
    }
    // La mezcla del servidor, rehecha con los mismos formatos, da lo mismo.
    const mezcla = soloDos.find((c) => c.formatos.length > 1);
    if (mezcla) {
      const deNuevo = calcularMezcla(pedido, [F9, F8].find((f) => f.codigo === mezcla.mezclaDesde)!, [F9, F8], config);
      expect(deNuevo?.total).toBe(mezcla.total);
    }
  });
});
