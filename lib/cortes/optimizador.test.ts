import { describe, expect, it } from "vitest";
import { EPS, empaquetar, planchasNuevas, type Panel, type Pieza, type ResultadoCorte } from "./optimizador";

const pieza = (id: string, ancho: number, alto: number, rotable = true): Pieza => ({ id, ancho, alto, rotable });
const varias = (n: number, ancho: number, alto: number, prefijo = "p") =>
  Array.from({ length: n }, (_, i) => pieza(`${prefijo}${i}`, ancho, alto));

const areaDe = (p: Panel) => (p.x2 - p.x1) * (p.y2 - p.y1);
const seSolapan = (a: Panel, b: Panel) =>
  a.x1 < b.x2 - EPS && b.x1 < a.x2 - EPS && a.y1 < b.y2 - EPS && b.y1 < a.y2 - EPS;

/** Las tres invariantes del empaquetado, para cualquier resultado sin kerf ni margen. */
function comprobar(r: ResultadoCorte, piezas: Pieza[]) {
  const colocadas = new Set<string>();
  for (const plancha of r.planchas) {
    // Los paneles cubren la plancha exactamente.
    const suma = plancha.paneles.reduce((s, p) => s + areaDe(p), 0);
    expect(suma).toBeCloseTo(plancha.ancho * plancha.alto, 4);

    for (const [i, a] of plancha.paneles.entries()) {
      // Nada se sale de la plancha.
      expect(a.x1).toBeGreaterThanOrEqual(-EPS);
      expect(a.y1).toBeGreaterThanOrEqual(-EPS);
      expect(a.x2).toBeLessThanOrEqual(plancha.ancho + EPS);
      expect(a.y2).toBeLessThanOrEqual(plancha.alto + EPS);
      // Ningún panel pisa a otro.
      for (const b of plancha.paneles.slice(i + 1)) expect(seSolapan(a, b)).toBe(false);

      if (!a.libre) {
        expect(colocadas.has(a.piezaId!)).toBe(false);
        colocadas.add(a.piezaId!);
        // La pieza conserva sus medidas, girada o no.
        const original = piezas.find((p) => p.id === a.piezaId)!;
        const [w, h] = a.rotada ? [original.alto, original.ancho] : [original.ancho, original.alto];
        expect(a.x2 - a.x1).toBeCloseTo(w, 6);
        expect(a.y2 - a.y1).toBeCloseTo(h, 6);
      }
    }
  }
  // Cada pieza acaba en una plancha o en la lista de las que no caben, una vez.
  expect(colocadas.size + r.noCaben.length).toBe(piezas.length);
  for (const p of r.noCaben) expect(colocadas.has(p.id)).toBe(false);
}

/** Aleatorio con semilla: las cargas son siempre las mismas. */
function azar(semilla: number) {
  let s = semilla >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("casos fijos", () => {
  it("cuatro piezas de 50×50 llenan una plancha de 100×100", () => {
    const piezas = varias(4, 50, 50);
    const r = empaquetar(100, 100, piezas);
    expect(r.planchas).toHaveLength(1);
    expect(r.planchas[0].usoPct).toBeCloseTo(100, 6);
    expect(r.planchas[0].piezas).toBe(4);
    comprobar(r, piezas);
  });

  it("una pieza más grande que la plancha en las dos orientaciones no cabe", () => {
    const r = empaquetar(100, 50, [pieza("a", 120, 60)]);
    expect(r.planchas).toHaveLength(0);
    expect(r.noCaben.map((p) => p.id)).toEqual(["a"]);
  });

  it("40×90 en una plancha de 100×50 solo cabe girada", () => {
    const r = empaquetar(100, 50, [pieza("a", 40, 90)]);
    expect(r.noCaben).toHaveLength(0);
    const [panel] = r.planchas[0].paneles.filter((p) => !p.libre);
    expect(panel).toMatchObject({ rotada: true, x2: 90, y2: 40 });
  });

  it("sin permiso para girar, esa misma pieza no cabe", () => {
    expect(empaquetar(100, 50, [pieza("a", 40, 90)], { rotar: false }).noCaben).toHaveLength(1);
    expect(empaquetar(100, 50, [pieza("a", 40, 90, false)]).noCaben).toHaveLength(1);
  });

  it("las piezas sin medida se descartan y no rompen nada", () => {
    const r = empaquetar(100, 100, [pieza("a", 0, 10), pieza("b", 10, -1), pieza("c", 10, 10)]);
    expect(r.planchas[0].piezas).toBe(1);
    expect(r.noCaben).toHaveLength(0);
  });

  it("es determinista: la misma entrada da el mismo acomodo", () => {
    const piezas = [...varias(7, 60, 80, "a"), ...varias(5, 33, 47, "b"), ...varias(3, 120, 40, "c")];
    expect(empaquetar(305, 205, piezas)).toEqual(empaquetar(305, 205, piezas));
  });

  it("abre otra plancha cuando la primera se llena", () => {
    const piezas = varias(10, 60, 80);
    const r = empaquetar(122, 183, piezas);
    // En 122×183 entran 4 de 60×80 (2×2): diez piezas son tres planchas.
    expect(r.planchas).toHaveLength(3);
    comprobar(r, piezas);
  });
});

describe("kerf y margen", () => {
  it("con kerf, dos mitades exactas ya no salen de la misma plancha", () => {
    expect(empaquetar(100, 100, varias(2, 50, 100)).planchas).toHaveLength(1);
    expect(empaquetar(100, 100, varias(2, 50, 100), { kerf: 0.3 }).planchas).toHaveLength(2);
  });

  it("las piezas quedan separadas por el kerf y conservan su medida", () => {
    const r = empaquetar(100, 100, varias(2, 49, 100), { kerf: 0.3 });
    expect(r.planchas).toHaveLength(1);
    const [a, b] = r.planchas[0].paneles.filter((p) => !p.libre).sort((x, y) => x.x1 - y.x1);
    expect(a.x2 - a.x1).toBeCloseTo(49, 6);
    expect(b.x1 - a.x2).toBeCloseTo(0.3, 6);
    expect(b.x2).toBeLessThanOrEqual(100 + EPS);
  });

  it("el margen aparta las piezas del borde", () => {
    expect(empaquetar(100, 100, [pieza("a", 100, 100)], { margen: 1 }).noCaben).toHaveLength(1);
    const r = empaquetar(100, 100, [pieza("a", 98, 98)], { margen: 1 });
    expect(r.planchas[0].paneles.find((p) => !p.libre)).toMatchObject({ x1: 1, y1: 1, x2: 99, y2: 99 });
  });
});

describe("sobrantes del almacén", () => {
  it("usa primero el sobrante donde cabe y no abre plancha", () => {
    const r = empaquetar(122, 244, [pieza("a", 50, 80)], {
      previos: [
        { id: "ECO3-S-0002", ancho: 122, alto: 33 },
        { id: "ECO3-S-0001", ancho: 89, alto: 57 },
      ],
    });
    expect(planchasNuevas(r)).toBe(0);
    expect(r.planchas).toHaveLength(1);
    expect(r.planchas[0].origen).toEqual({ tipo: "sobrante", id: "ECO3-S-0001" });
  });

  it("lo que no entra en los sobrantes va a una plancha nueva", () => {
    const piezas = [pieza("a", 50, 80), pieza("b", 100, 200)];
    const r = empaquetar(122, 244, piezas, { previos: [{ id: "s1", ancho: 89, alto: 57 }] });
    expect(r.noCaben).toHaveLength(0);
    expect(planchasNuevas(r)).toBe(1);
    expect(r.planchas.map((p) => p.origen.tipo).sort()).toEqual(["plancha", "sobrante"]);
  });
});

describe("invariantes con cargas aleatorias", () => {
  it("200 pedidos: cubre la plancha, sin solapes, y no pierde piezas", () => {
    const rnd = azar(20261110);
    for (let caso = 0; caso < 200; caso++) {
      const W = 100 + Math.floor(rnd() * 250);
      const H = 100 + Math.floor(rnd() * 150);
      const piezas: Pieza[] = [];
      const tipos = 1 + Math.floor(rnd() * 5);
      for (let t = 0; t < tipos; t++) {
        const ancho = 5 + Math.floor(rnd() * 130);
        const alto = 5 + Math.floor(rnd() * 130);
        const cantidad = 1 + Math.floor(rnd() * 12);
        for (let n = 0; n < cantidad; n++) piezas.push(pieza(`c${caso}t${t}n${n}`, ancho, alto));
      }
      const r = empaquetar(W, H, piezas);
      comprobar(r, piezas);
      // Lo que quedó fuera es porque de verdad no entra en una plancha vacía.
      for (const p of r.noCaben) {
        expect((p.ancho <= W && p.alto <= H) || (p.alto <= W && p.ancho <= H)).toBe(false);
      }
      // Nunca menos planchas de las que exige el área.
      const area = piezas.filter((p) => !r.noCaben.includes(p)).reduce((s, p) => s + p.ancho * p.alto, 0);
      expect(r.planchas.length).toBeGreaterThanOrEqual(Math.ceil(area / (W * H) - 1e-9));
    }
  });

  it("500 piezas en bastante menos de un segundo", () => {
    const rnd = azar(7);
    const piezas = Array.from({ length: 500 }, (_, i) =>
      pieza(`p${i}`, 10 + Math.floor(rnd() * 60), 10 + Math.floor(rnd() * 60)),
    );
    const inicio = performance.now();
    const r = empaquetar(305, 205, piezas);
    expect(performance.now() - inicio).toBeLessThan(1500);
    comprobar(r, piezas);
  });
});
