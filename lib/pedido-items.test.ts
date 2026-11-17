import { describe, expect, it } from "vitest";
import { calcularCorte } from "./cortes/calcular";
import { CONFIG_CORTES_DEFECTO } from "./cortes/config";
import { guardarCorte } from "./cortes/guardado";
import { resumenItems, textoItem, type ItemPedido } from "./dominio";
import { itemDeLinea } from "./pedido-lineas";

const piezas = [
  { ancho: 60, alto: 80, cantidad: 10 },
  { ancho: 20, alto: 20, cantidad: 2 },
];
const corte = guardarCorte(
  {
    grupoId: "g",
    material: "Acrílico ECO",
    color: "Cristal",
    espesorMm: 3,
    modalidad: "laser",
    rotable: true,
    piezas,
    servicio: { productoId: 31, codigo: "SRV002", nombre: "SERVICIO DE CORTE LASER" },
    sobrantes: false,
  },
  calcularCorte(
    { piezas, espesorMm: 3, modalidad: "laser", rotable: true },
    { codigo: "F7E024", ancho: 122, alto: 183, precio: 200 },
    CONFIG_CORTES_DEFECTO,
  ),
);

describe("una línea del pedido como ítem de la lista", () => {
  it("un corte se nombra por su modalidad y material, y se cuenta en piezas", () => {
    const item = itemDeLinea({
      posicion: 1,
      tipo: "corte",
      producto_nombre: "ACRILICO ECO CRISTAL 3MM 1.22X1.83",
      cantidad: 3,
      corte: JSON.parse(JSON.stringify(corte)),
      terminado: null,
    });
    expect(item).toEqual({ posicion: 1, clase: "corte", nombre: "Corte láser · Acrílico ECO · Cristal · 3 mm", cantidad: 12 });
    expect(textoItem(item)).toBe("12 pzs · Corte láser · Acrílico ECO · Cristal · 3 mm");
  });

  it("un terminado se nombra por su ficha; un producto, por el nombre de Odoo", () => {
    expect(
      itemDeLinea({
        posicion: 2,
        tipo: "terminado",
        producto_nombre: "Caja para rifas",
        cantidad: 3,
        corte: null,
        terminado: { version: 1, nombre: "no es una ficha completa" },
      }),
    ).toEqual({ posicion: 2, clase: "terminado", nombre: "Caja para rifas", cantidad: 3 });

    const producto = itemDeLinea({
      posicion: 3,
      tipo: "producto",
      producto_nombre: "SOPORTES DE ACRILICO 25MM X 40MM CRISTAL",
      cantidad: 1.5,
      corte: null,
      terminado: null,
    });
    expect(producto.clase).toBe("producto");
    expect(textoItem(producto)).toBe("1.5 × SOPORTES DE ACRILICO 25MM X 40MM CRISTAL");
  });

  it("un corte que no se puede leer no se pierde: queda con el producto de Odoo", () => {
    expect(
      itemDeLinea({ posicion: 1, tipo: "corte", producto_nombre: "PLANCHA", cantidad: 2, corte: { version: 9 }, terminado: null }),
    ).toEqual({ posicion: 1, clase: "corte", nombre: "PLANCHA", cantidad: 2 });
  });
});

describe("lo que lleva un pedido en una línea", () => {
  const items: ItemPedido[] = [
    { posicion: 1, clase: "corte", nombre: "Corte manual · Superficie sólida · 6 mm", cantidad: 1 },
    { posicion: 2, clase: "producto", nombre: "ADHESIVO", cantidad: 2 },
    { posicion: 3, clase: "producto", nombre: "TORNILLOS", cantidad: 12 },
  ];

  it("el primer ítem y cuántos más", () => {
    expect(resumenItems(items)).toBe("1 pza · Corte manual · Superficie sólida · 6 mm +2");
    expect(resumenItems(items.slice(1, 2))).toBe("2 × ADHESIVO");
    expect(resumenItems([])).toBe("Sin ítems");
  });
});
