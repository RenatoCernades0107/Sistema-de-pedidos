import { describe, expect, it } from "vitest";
import { detalleDesdeLineas } from "./cotizaciones";
import { indicacionesDe, origenDePlancha, piezasDePlancha } from "./hoja-corte";
import type { LineaDePedido } from "./pedido-lineas";

const producto: LineaDePedido = {
  posicion: 1,
  productoId: 10,
  nombre: "ACRILICO F8 CRISTAL 3MM",
  codigo: "AC-003",
  descripcion: null,
  cantidad: 2,
  corte: null,
  planchasUsadas: null,
  importe: null,
};

describe("indicacionesDe", () => {
  const base = detalleDesdeLineas([{ ...producto, precioUnitario: 0, importe: 0 }]);

  it("quita la lista de productos que el detalle lleva delante", () => {
    expect(indicacionesDe(`${base}\n\nBordes pulidos\nEntregar en caja`, [producto])).toBe(
      "Bordes pulidos\nEntregar en caja",
    );
  });

  it("sin indicaciones no queda nada", () => {
    expect(indicacionesDe(base, [producto])).toBe("");
  });

  it("un detalle editado a mano, o de un pedido sin líneas, se devuelve entero", () => {
    expect(indicacionesDe("2 planchas de cristal, cortar a 60×80", [producto])).toBe(
      "2 planchas de cristal, cortar a 60×80",
    );
    expect(indicacionesDe("Texto libre", [])).toBe("Texto libre");
  });
});

describe("origenDePlancha", () => {
  const formato = { codigo: "F7E024", ancho: 122, alto: 183, precio: 0 };

  it("dice si es una plancha nueva o un sobrante del almacén", () => {
    expect(origenDePlancha({ origen: { tipo: "plancha" }, ancho: 122, alto: 183 }, formato)).toBe(
      "Plancha nueva F7E024 (122×183)",
    );
    expect(origenDePlancha({ origen: { tipo: "sobrante", id: "S-0042" }, ancho: 61, alto: 183 }, formato)).toBe(
      "Sobrante S-0042 del almacén (61×183)",
    );
  });
});

describe("piezasDePlancha", () => {
  it("cuenta las piezas por medida, sin los huecos", () => {
    const pieza = (id: string) => ({ x1: 0, y1: 0, x2: 1, y2: 1, libre: false, piezaId: id });
    expect(
      piezasDePlancha({
        paneles: [pieza("f2#1"), pieza("f1#1"), pieza("f1#2"), { x1: 0, y1: 0, x2: 1, y2: 1, libre: true }],
      }),
    ).toEqual([
      { fila: 1, cantidad: 2 },
      { fila: 2, cantidad: 1 },
    ]);
  });
});
