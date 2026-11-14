import { describe, expect, it } from "vitest";
import { calcularCorte, compararFormatos, filaDe, type EntradaCorte, type FormatoCorte } from "./calcular";
import { CONFIG_CORTES_DEFECTO, leerConfigCortes, type ConfigCortes } from "./config";
import { parametrosLaser, tiempoLaser } from "./laser";
import { precioManual } from "./manual";
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
    // 480 / 2 × 1.20
    expect(r.material).toBe(288);
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
    // 480 / 4 × 1.20
    expect(r.material).toBe(144);
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
    // 200 + 200 + 200/2 × 1.20
    expect(r.material).toBe(520);
    expect(r.piezas).toBe(10);
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

  it("manual: piezas por el precio de ese espesor", () => {
    // 5 piezas de 4 mm a S/ 4 la pieza.
    const r = calcularCorte(corte([[30, 30, 5]], { modalidad: "manual", espesorMm: 4 }), F20, config);
    expect(r.servicio).toBe(20);
    expect(r.minutosLaser).toBeNull();
    expect(r.problema).toBeNull();
  });

  it("manual a un espesor que no está en la tabla: se dice, no se inventa un precio", () => {
    expect(precioManual(config.manual.precios, 10)).toBeNull();
    const r = calcularCorte(corte([[30, 30, 5]], { modalidad: "manual", espesorMm: 10 }), F20, config);
    expect(r.problema).toMatch(/No hay precio de corte manual para 10 mm/);
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
      cobro: { recargoPct: 10, fracciones: config.cobro.fracciones, redondearAlSol: false },
      laser: { tabla: [] },
      manual: { precios: [{ mm: 4, precio: 7 }, { mm: 2, precio: 3 }] },
    });
    expect(c.cobro.recargoPct).toBe(10);
    expect(c.laser).toEqual(config.laser);
    // Ordenada por espesor.
    expect(c.manual.precios).toEqual([{ mm: 2, precio: 3 }, { mm: 4, precio: 7 }]);
    expect(c.servicios).toEqual({ laser: "SRV002", manual: "SRV001" });
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
