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
import { calcularCorte, calcularMezcla, type FormatoCorte, type PiezaPedida } from "./calcular";
import { CONFIG_CORTES_DEFECTO } from "./config";
import {
  fraccionEnPalabras,
  guardarCorte,
  leerCorte,
  lugarDeCorte,
  materialDeCorte,
  planchasPorCobro,
  planchasPorFormato,
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
  lugar: "taller",
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
    expect(corte.montoMaterial).toBe(510);
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
    // De antes de los almacenes: se cortó en el taller.
    expect(leerCorte(viejo)?.lugar).toBe("taller");
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
      { nombre: "1", monto: 200, cantidad: 2, formato: F7 },
      { nombre: "1/2", monto: 110, cantidad: 1, formato: F7 },
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
      [20, 1, 110],
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

  it("con el piloto de sobrantes va igual: planchas a su precio y el servicio, nada en m²", () => {
    const piloto = { ...guardada, corte: { ...corte, sobrantes: true } };
    expect(lineasParaOdoo(piloto).map((l) => [l.productoId, l.cantidad, l.precioUnitario])).toEqual([
      [20, 2, 200],
      [20, 1, 110],
      [31, 1, corte.montoServicio],
    ]);
  });

  it("una pieza del almacén va como producto Pieza, cantidad 1 al precio que se cobró", () => {
    const [primera, ...resto] = corte.planchas;
    const conPieza = {
      ...guardada,
      corte: {
        ...corte,
        sobrantes: true,
        planchas: [{ ...primera, origen: { tipo: "sobrante" as const, id: "SOB-00042" }, ancho: 100, alto: 90 }, ...resto],
      },
    };
    const pieza = { productoId: 77, nombre: "PIEZA ACRILICO ECO CRISTAL 3MM", codigo: "SOB-F7E024" };
    const lineas = lineasParaOdoo(conPieza, pieza);
    expect(lineas.map((l) => [l.productoId, l.cantidad, l.precioUnitario])).toEqual([
      [20, 1, 200],
      [20, 1, 110],
      [77, 1, primera.cobro.monto],
      [31, 1, corte.montoServicio],
    ]);
    expect(lineas[2].descripcion).toBe("Pieza SOB-00042 de 100×90 cm. Para cortar: 10 × 60×80 cm");
    expect(lineas.reduce((s, l) => s + l.cantidad * l.precioUnitario, 0)).toBeCloseTo(corte.total, 2);
    // Sin el producto Pieza no se puede cotizar.
    expect(() => lineasParaOdoo(conPieza)).toThrow();
  });

  it("si al reservar cambió lo cobrado por plancha, el servicio absorbe la diferencia", () => {
    const [primera, ...resto] = corte.planchas;
    const otro = { ...guardada, corte: { ...corte, sobrantes: true, planchas: [{ ...primera, cobro: { ...primera.cobro, monto: 190 } }, ...resto] } };
    const lineas = lineasParaOdoo(otro);
    expect(lineas.at(-1)?.precioUnitario).toBeCloseTo(corte.montoServicio + 10, 2);
    expect(lineas.reduce((s, l) => s + l.cantidad * l.precioUnitario, 0)).toBeCloseTo(corte.total, 2);
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
    lugar: "taller",
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

describe("lugarDeCorte", () => {
  it("el láser va siempre al taller; un manual, donde se diga", () => {
    expect(lugarDeCorte({ modalidad: "laser", lugar: "tienda" })).toBe("taller");
    expect(lugarDeCorte({ modalidad: "manual", lugar: "tienda" })).toBe("tienda");
    expect(lugarDeCorte({ modalidad: "manual" })).toBe("taller");
  });

  it("un láser guardado en la tienda se lee en el taller", () => {
    const corte = JSON.parse(JSON.stringify(guardarCorte(datos, calculo)));
    expect(leerCorte({ ...corte, lugar: "tienda" })?.lugar).toBe("taller");
    expect(leerCorte({ ...corte, modalidad: "manual", lugar: "tienda" })?.lugar).toBe("tienda");
  });
});

describe("un corte que mezcla formatos", () => {
  // El pedido P2611-002: piezas largas en 122×244, y la última plancha casi vacía.
  const F9: FormatoCorte = { codigo: "F9", ancho: 122, alto: 244, precio: 300 };
  const F7b: FormatoCorte = { ...F7, precio: 230 };
  const medidas: [number, number, number][] = [
    [138.5, 62.5, 1], [137, 14, 1], [137.2, 60.2, 1], [137.5, 14, 2], [178, 25, 1], [186.5, 61, 1],
    [176.5, 25, 1], [176.5, 32.5, 1], [187, 61, 1], [137.5, 14, 2], [137.5, 65, 1],
  ];
  const entrada = {
    piezas: medidas.map(([ancho, alto, cantidad]) => ({ ancho, alto, cantidad })),
    espesorMm: 4,
    modalidad: "laser" as const,
    rotable: true,
  };
  const mezcla = calcularMezcla(entrada, F9, [F9, F7b], CONFIG_CORTES_DEFECTO)!;
  const guardado = guardarCorte({ ...datos, piezas: entrada.piezas }, mezcla);
  // Lo que pone el servidor: el producto de Odoo de cada formato.
  guardado.formatos = guardado.formatos!.map((f) => ({ ...f, productoId: f.codigo === "F9" ? 90 : 70, nombre: `PLANCHA ${f.codigo}` }));

  it("guarda sus formatos y cada plancha dice el suyo", () => {
    expect(guardado.formatos!.map((f) => f.codigo).sort()).toEqual(["F7E024", "F9"]);
    expect(guardado.planchas.every((p) => p.origen.tipo === "plancha" && p.origen.formato)).toBe(true);
    expect(leerCorte(JSON.parse(JSON.stringify(guardado)))).toEqual(guardado);
  });

  it("un corte de un solo formato no guarda `formatos`, como antes", () => {
    expect(corte.formatos).toBeUndefined();
    expect(planchasPorFormato(corte)).toEqual([{ formato: F7, cantidad: 3 }]);
  });

  it("se dice en palabras con cada formato", () => {
    const porFormato = planchasPorFormato(guardado);
    expect(porFormato.reduce((s, f) => s + f.cantidad, 0)).toBe(guardado.planchas.length);
    const [a, b] = porFormato;
    expect(planchasTexto(guardado)).toBe(
      `${a.cantidad} ${a.cantidad === 1 ? "plancha" : "planchas"} de ${a.formato.ancho}×${a.formato.alto} + ` +
        `${b.cantidad} de ${b.formato.ancho}×${b.formato.alto}`,
    );
  });

  it("a Odoo va cada formato con su producto, y suma lo cotizado", () => {
    const lineas = lineasParaOdoo({ ...guardada, productoId: 90, codigo: "F9", corte: guardado, importe: guardado.total });
    const deFormato = (id: number) => lineas.filter((l) => l.productoId === id).reduce((s, l) => s + l.cantidad, 0);
    const cuenta = Object.fromEntries(planchasPorFormato(guardado).map((f) => [f.formato.codigo, f.cantidad]));
    expect(deFormato(90)).toBe(cuenta.F9);
    expect(deFormato(70)).toBe(cuenta.F7E024);
    expect(lineas.reduce((s, l) => s + l.cantidad * l.precioUnitario, 0)).toBeCloseTo(guardado.total, 2);
  });
});
