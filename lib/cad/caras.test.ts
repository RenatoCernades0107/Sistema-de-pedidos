import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  describirCara,
  esquemaReferencias,
  ladoDe,
  mensajeConReferencias,
  referenciasATexto,
  segmentarCaras,
  type ReferenciaCara,
} from "./caras";

/** Como llegan del motor: triángulos sueltos, sin índice. */
const suelta = (g: THREE.BufferGeometry) => (g.index ? g.toNonIndexed() : g);
const posiciones = (g: THREE.BufferGeometry) => g.getAttribute("position").array;

function describirTodas(g: THREE.BufferGeometry, nombre = "Base") {
  const { caras } = segmentarCaras(posiciones(g), g.index?.array);
  return caras.map((c) => describirCara(c, posiciones(g), g.index?.array, { id: "base", nombre, copia: 1, de: 1 }));
}

describe("segmentarCaras", () => {
  it("una plancha horizontal tiene 2 caras y 4 cantos", () => {
    // glTF: Y arriba. 200 de ancho, 3 de espesor, 150 de fondo.
    const g = suelta(new THREE.BoxGeometry(200, 3, 150));
    const refs = describirTodas(g);
    expect(refs).toHaveLength(6);
    expect(refs.filter((r) => r.tipo === "cara")).toHaveLength(2);
    expect(refs.filter((r) => r.tipo === "canto")).toHaveLength(4);

    const arriba = refs.find((r) => r.lado === "arriba")!;
    expect(arriba.tipo).toBe("cara");
    expect(arriba.etiqueta).toBe("Base · cara superior");
    expect([arriba.ancho_mm, arriba.alto_mm]).toEqual([200, 150]);
    expect(arriba.centro).toEqual([0, 0, 1.5]);
    expect(arriba.area_mm2).toBe(30000);

    // glTF +Z es el frente del producto (−Y).
    const frente = refs.find((r) => r.lado === "frente")!;
    expect(frente.tipo).toBe("canto");
    expect(frente.etiqueta).toBe("Base · canto frontal");
    expect(frente.centro).toEqual([0, -75, 0]);
    expect([frente.ancho_mm, frente.alto_mm]).toEqual([200, 3]);
  });

  it("también con geometría indexada", () => {
    const g = new THREE.BoxGeometry(100, 100, 3);
    expect(g.index).not.toBeNull();
    const refs = describirTodas(g);
    expect(refs).toHaveLength(6);
    // Plancha vertical mirando al frente.
    expect(refs.find((r) => r.lado === "frente")?.tipo).toBe("cara");
    expect(refs.find((r) => r.lado === "arriba")?.tipo).toBe("canto");
  });

  it("una plancha con agujero sigue teniendo una sola cara por lado", () => {
    const forma = new THREE.Shape();
    forma.moveTo(0, 0).lineTo(100, 0).lineTo(100, 60).lineTo(0, 60).lineTo(0, 0);
    const agujero = new THREE.Path();
    agujero.absarc(50, 30, 10, 0, Math.PI * 2, true);
    forma.holes.push(agujero);
    const g = suelta(new THREE.ExtrudeGeometry(forma, { depth: 3, bevelEnabled: false, curveSegments: 24 }));
    const refs = describirTodas(g);
    const caras = refs.filter((r) => r.tipo === "cara");
    expect(caras).toHaveLength(2);
    // 4 cantos rectos + el del agujero, en uno solo.
    const cantos = refs.filter((r) => r.tipo === "canto");
    expect(cantos).toHaveLength(5);
    expect(cantos.filter((r) => r.curva)).toHaveLength(1);
    expect(cantos.find((r) => r.curva)?.etiqueta).toBe("Base · canto curvo");
  });

  it("un lado recto tangente a un redondeo no se junta con el arco", () => {
    const forma = new THREE.Shape();
    const r = 5;
    forma.moveTo(r, 0);
    forma.lineTo(100 - r, 0);
    forma.absarc(100 - r, r, r, -Math.PI / 2, 0, false);
    forma.lineTo(100, 60);
    forma.lineTo(0, 60);
    forma.lineTo(0, r);
    forma.absarc(r, r, r, Math.PI, Math.PI * 1.5, false);
    const g = suelta(new THREE.ExtrudeGeometry(forma, { depth: 3, bevelEnabled: false, curveSegments: 12 }));
    const cantos = describirTodas(g).filter((x) => x.tipo === "canto");
    expect(cantos.filter((x) => x.curva)).toHaveLength(2);
    expect(cantos.filter((x) => !x.curva)).toHaveLength(4);
  });

  it("cada triángulo sabe a qué cara pertenece", () => {
    const g = suelta(new THREE.BoxGeometry(10, 10, 10));
    const { caras, caraDeTriangulo } = segmentarCaras(posiciones(g));
    expect(caraDeTriangulo).toHaveLength(12);
    caras.forEach((c, i) => c.triangulos.forEach((t) => expect(caraDeTriangulo[t]).toBe(i)));
  });
});

describe("ladoDe", () => {
  it("nombra el eje dominante o nada si está inclinada", () => {
    expect(ladoDe([0, 0, 1])).toBe("arriba");
    expect(ladoDe([0, 0, -1])).toBe("abajo");
    expect(ladoDe([1, 0, 0])).toBe("derecha");
    expect(ladoDe([0, -1, 0])).toBe("frente");
    expect(ladoDe([0, 1, 0])).toBe("fondo");
    expect(ladoDe([0, Math.SQRT1_2, Math.SQRT1_2])).toBeNull();
  });
});

describe("referencias al chat", () => {
  const ref: ReferenciaCara = {
    clave: "lateral#2:cara:100,0,50",
    pieza: "lateral",
    nombrePieza: "Lateral",
    copia: 2,
    de: 2,
    tipo: "cara",
    curva: false,
    lado: "derecha",
    normal: [1, 0, 0],
    centro: [100, 0, 50],
    ancho_mm: 150,
    alto_mm: 100,
    area_mm2: 15000,
    etiqueta: "Lateral (2 de 2) · cara derecha",
  };

  it("valida con el esquema", () => {
    expect(esquemaReferencias.safeParse([ref]).success).toBe(true);
    expect(esquemaReferencias.safeParse([{ ...ref, normal: [1, 0] }]).success).toBe(false);
  });

  it("se describe al modelo con medidas, centro y normal", () => {
    const texto = referenciasATexto([ref]);
    expect(texto).toContain("Caras señaladas");
    expect(texto).toContain("1. Lateral (2 de 2) · cara derecha (pieza `lateral`, copia 2 de 2)");
    expect(texto).toContain("150 × 100 mm");
    expect(texto).toContain("centro (100, 0, 50)");
    expect(texto).toContain("normal (1, 0, 0)");
  });

  it("sin referencias el mensaje queda igual", () => {
    expect(mensajeConReferencias("hola", [])).toBe("hola");
    expect(mensajeConReferencias("hola", null)).toBe("hola");
    expect(mensajeConReferencias("hola", [ref])).toMatch(/^hola\n\n\[Caras señaladas/);
  });
});
