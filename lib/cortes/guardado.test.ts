import { describe, expect, it } from "vitest";
import { detalleDesdeLineas, sumaLineas, type LineaGuardada } from "../cotizaciones";
import { lineasParaOdoo } from "../cotizaciones-servidor";
import {
  agregarProducto,
  importeDe,
  ponerCorte,
  problemaDeLineas,
  quitarLinea,
  totalReferencial,
  type Linea,
  type LineaCorte,
} from "../lineas-cotizacion";
import { calcularCorte, type FormatoCorte, type PiezaPedida } from "./calcular";
import { CONFIG_CORTES_DEFECTO } from "./config";
import {
  fraccionEnPalabras,
  guardarCorte,
  leerCorte,
  materialDeCorte,
  planchasPorCobro,
  planchasTexto,
  resumenPiezas,
  tituloCorte,
  type DatosCorte,
} from "./guardado";

const F7: FormatoCorte = { codigo: "F7E024", ancho: 122, alto: 183, precio: 200 };
const piezas: PiezaPedida[] = [{ ancho: 60, alto: 80, cantidad: 10 }];

const datos: DatosCorte = {
  grupoId: "11111111-2222-3333-4444-555555555555",
  material: "Acrílico ECO",
  color: "Cristal",
  espesorMm: 3,
  modalidad: "laser",
  rotable: true,
  piezas,
  servicio: { productoId: 31, codigo: "SRV002", nombre: "SERVICIO DE CORTE LASER" },
  sobrantes: false,
};

const calculo = calcularCorte({ piezas, espesorMm: 3, modalidad: "laser", rotable: true }, F7, CONFIG_CORTES_DEFECTO);
const corte = guardarCorte(datos, calculo);

describe("el corte que se guarda", () => {
  it("conserva el cálculo entero: planchas, cobros, montos y desglose", () => {
    expect(corte.planchas).toHaveLength(3);
    expect(corte.planchas.map((p) => p.cobro.nombre).sort()).toEqual(["1", "1", "1/2"]);
    expect(corte.montoMaterial).toBe(520);
    expect(corte.montoMaterial + corte.montoServicio).toBeCloseTo(corte.total, 2);
    expect(corte.desglose.at(-1)).toMatchObject({ esTotal: true, monto: corte.total });
  });

  it("pasa por JSON y vuelve igual: es lo que hace la base", () => {
    expect(leerCorte(JSON.parse(JSON.stringify(corte)))).toEqual(corte);
  });

  it("lo que no es un corte se lee como null, sin lanzar", () => {
    expect(leerCorte(null)).toBeNull();
    expect(leerCorte({ version: 2 })).toBeNull();
    expect(leerCorte({ ...corte, planchas: "tres" })).toBeNull();
  });

  it("un corte guardado antes de los sobrantes se lee con el piloto apagado", () => {
    const viejo = JSON.parse(JSON.stringify(corte));
    delete viejo.sobrantes;
    expect(leerCorte(viejo)?.sobrantes).toBe(false);
  });

  it("se dice en palabras", () => {
    expect(resumenPiezas([...piezas, { ancho: 30.5, alto: 30, cantidad: 4 }])).toBe("10 × 60×80 cm, 4 × 30.5×30 cm");
    expect(materialDeCorte(corte)).toBe("Acrílico ECO · Cristal · 3 mm");
    expect(tituloCorte(corte)).toBe("Corte láser · Acrílico ECO · Cristal · 3 mm");
    expect(planchasTexto(corte)).toBe("3 planchas de 122×183");
    expect(fraccionEnPalabras("1/2")).toBe("media plancha");
    expect(fraccionEnPalabras("1/4")).toBe("un cuarto de plancha");
    expect(fraccionEnPalabras("1/8")).toBe("un octavo de plancha");
    expect(fraccionEnPalabras("3/4")).toBe("tres cuartos de plancha");
    expect(fraccionEnPalabras("1")).toBe("plancha completa");
  });

  it("agrupa las planchas por lo que se cobra de cada una, las completas primero", () => {
    expect(planchasPorCobro(corte)).toEqual([
      { nombre: "1", monto: 200, cantidad: 2 },
      { nombre: "1/2", monto: 120, cantidad: 1 },
    ]);
  });
});

const guardada: LineaGuardada = {
  terminado: null,
  posicion: 1,
  productoId: 20,
  nombre: "ACRILICO ECO CRISTAL 3MM 1.22X1.83",
  codigo: "F7E024",
  descripcion: "Corte láser · Acrílico ECO · Cristal · 3 mm: 10 × 60×80 cm",
  cantidad: 3,
  precioUnitario: 173.33,
  corte,
  importe: corte.total,
};

describe("un corte en la cotización guardada", () => {
  it("suma su importe, no cantidad × precio (que no cuadra al céntimo)", () => {
    const producto: LineaGuardada = { ...guardada, posicion: 2, corte: null, cantidad: 2, precioUnitario: 15, importe: 30 };
    expect(sumaLineas([guardada, producto])).toBe(corte.total + 30);
  });

  it("a Odoo va como planchas por precio y el servicio; las planchas son las que se descuentan", () => {
    const lineas = lineasParaOdoo(guardada);
    expect(lineas.map((l) => [l.productoId, l.cantidad, l.precioUnitario])).toEqual([
      [20, 2, 200],
      [20, 1, 120],
      [31, 1, corte.montoServicio],
    ]);
    expect(lineas[0].descripcion).toBe("Para cortar: 10 × 60×80 cm");
    expect(lineas[1].descripcion).toBe("Se cobra media plancha. Para cortar: 10 × 60×80 cm");
    expect(lineas[2].descripcion).toBe("10 piezas en Acrílico ECO · Cristal · 3 mm");
    // Lo que suma Odoo es lo que se cotizó.
    expect(lineas.reduce((s, l) => s + l.cantidad * l.precioUnitario, 0)).toBeCloseTo(corte.total, 2);
    // Tantas planchas como se abren.
    expect(lineas.filter((l) => l.productoId === 20).reduce((s, l) => s + l.cantidad, 0)).toBe(3);
  });

  it("en el detalle del pedido se describe como trabajo, no como producto", () => {
    expect(detalleDesdeLineas([guardada])).toBe(
      "Corte láser · Acrílico ECO · Cristal · 3 mm: 10 piezas (10 × 60×80 cm) — 3 planchas de 122×183",
    );
  });
});

describe("un corte mientras se arma la cotización", () => {
  const nuevo: Omit<LineaCorte, "tipo" | "clave"> = {
    grupoId: datos.grupoId,
    material: datos.material,
    color: datos.color,
    espesorMm: 3,
    rotable: true,
    modalidad: "laser",
    piezas,
    calculo,
  };
  let n = 0;
  const clave = () => `c${++n}`;

  it("se agrega al final y suma su total", () => {
    const conProducto = agregarProducto([] as Linea[], { id: 10, nombre: "X", codigo: null, unidad: null, precio: 50 }, clave);
    const r = ponerCorte(conProducto.lineas, nuevo, clave);
    expect(r.lineas).toHaveLength(2);
    expect(importeDe(r.lineas[1])).toBe(calculo.total);
    expect(totalReferencial(r.lineas)).toBe(50 + calculo.total);
    expect(problemaDeLineas(r.lineas)).toBeNull();
  });

  it("editarlo lo reemplaza en su sitio", () => {
    const a = ponerCorte([], nuevo, clave);
    const b = agregarProducto(a.lineas, { id: 10, nombre: "X", codigo: null, unidad: null, precio: 50 }, clave);
    const editado = ponerCorte(b.lineas, { ...nuevo, modalidad: "manual", clave: a.clave }, clave);
    expect(editado.clave).toBe(a.clave);
    expect(editado.lineas).toHaveLength(2);
    expect(editado.lineas[0]).toMatchObject({ tipo: "corte", modalidad: "manual" });
  });

  it("agregar un producto no toca los cortes, y quitar un corte lo saca", () => {
    const a = ponerCorte([], nuevo, clave);
    const b = agregarProducto(a.lineas, { id: 20, nombre: "PLANCHA", codigo: "F7E024", unidad: null, precio: 200 }, clave);
    expect(b.sumada).toBe(false);
    expect(b.lineas).toHaveLength(2);
    expect(quitarLinea(b.lineas, a.clave)).toHaveLength(1);
  });

  it("un corte con un problema no deja crear, y dice cuál", () => {
    const malo = calcularCorte(
      { piezas: [{ ancho: 300, alto: 300, cantidad: 1 }], espesorMm: 3, modalidad: "laser", rotable: true },
      F7,
      CONFIG_CORTES_DEFECTO,
    );
    const r = ponerCorte([], { ...nuevo, calculo: malo }, clave);
    expect(problemaDeLineas(r.lineas)).toMatch(/no cabe/);
  });
});
