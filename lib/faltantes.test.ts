import { describe, expect, it } from "vitest";
import type { CorteGuardado } from "./cortes/guardado";
import { elegirDespacho, faltantesDe, necesidadesDeLineas, productosDeLineas, type LineaConMaterial, type StockLibre } from "./faltantes";
import { cantidadesParaDescontar, type LineaDePedido } from "./pedido-lineas";

const almacenes = [
  { id: "and", nombre: "Andahuaylas", tipo: "tienda" as const, activo: true, orden: 1 },
  { id: "cat", nombre: "Católica", tipo: "taller" as const, activo: true, orden: 2 },
  { id: "esm", nombre: "Esmeraldas", tipo: "deposito" as const, activo: true, orden: 3 },
];

/** Un corte que abre `nuevas` planchas y usa `sobrantes` del almacén. */
const corte = (modalidad: "laser" | "manual", lugar: "taller" | "tienda", nuevas: number, sobrantes = 0) =>
  ({
    modalidad,
    lugar,
    sobrantes: true,
    planchas: [
      ...Array.from({ length: nuevas }, () => ({ origen: { tipo: "plancha" } })),
      ...Array.from({ length: sobrantes }, (_, i) => ({ origen: { tipo: "sobrante", id: `SOB-${i}` } })),
    ],
  }) as unknown as CorteGuardado;

const linea = (productoId: number, cantidad: number, extra: Partial<LineaConMaterial> = {}): LineaConMaterial => ({
  productoId,
  codigo: `P${productoId}`,
  nombre: `Producto ${productoId}`,
  cantidad,
  corte: null,
  terminado: null,
  ...extra,
});

const material = (productoId: number, cantidad: number) => ({
  productoId,
  codigo: `P${productoId}`,
  nombre: `Producto ${productoId}`,
  unidad: null,
  cantidad,
  precio: 0,
  esPlancha: true,
});

const almacenables = new Set([20, 21, 30]);
const stock = (filas: Record<number, Record<string, number>>): StockLibre => new Map(Object.entries(filas).map(([k, v]) => [Number(k), v]));

describe("lo que necesita un pedido", () => {
  it("un corte pide sus planchas nuevas donde se corta; un terminado, su material en el taller; lo suelto, en el despacho", () => {
    const lineas = [
      linea(20, 3, { corte: corte("laser", "tienda", 2, 1) }),
      linea(20, 1, { corte: corte("manual", "tienda", 1) }),
      linea(99, 1, { terminado: { materiales: [material(21, 0.5), material(30, 4)] } }),
      linea(30, 2),
      linea(500, 1), // un servicio: no lleva stock
    ];
    expect(necesidadesDeLineas(lineas, "and", almacenes, almacenables)).toEqual([
      expect.objectContaining({ productoId: 20, cantidad: 2, almacenId: "cat", motivo: "corte" }),
      expect.objectContaining({ productoId: 20, cantidad: 1, almacenId: "and", motivo: "corte" }),
      expect.objectContaining({ productoId: 21, cantidad: 0.5, almacenId: "cat", motivo: "terminado" }),
      expect.objectContaining({ productoId: 30, cantidad: 4, almacenId: "cat", motivo: "terminado" }),
      expect.objectContaining({ productoId: 30, cantidad: 2, almacenId: "and", motivo: "despacho" }),
    ]);
  });

  it("el mismo producto en el mismo almacén se suma", () => {
    const lineas = [linea(20, 2, { corte: corte("laser", "taller", 2) }), linea(20, 1, { corte: corte("manual", "taller", 1) })];
    expect(necesidadesDeLineas(lineas, "and", almacenes, almacenables)).toEqual([
      expect.objectContaining({ productoId: 20, cantidad: 3, almacenId: "cat" }),
    ]);
  });

  it("un corte que mezcla formatos pide las planchas de cada uno", () => {
    const mezcla = {
      modalidad: "laser",
      lugar: "taller",
      sobrantes: false,
      formato: { codigo: "P20", ancho: 122, alto: 244, precio: 0 },
      formatos: [
        { codigo: "P20", ancho: 122, alto: 244, precio: 0, productoId: 20, nombre: "Producto 20" },
        { codigo: "P21", ancho: 122, alto: 183, precio: 0, productoId: 21, nombre: "Producto 21" },
      ],
      planchas: [
        { origen: { tipo: "plancha", formato: "P20" } },
        { origen: { tipo: "plancha", formato: "P20" } },
        { origen: { tipo: "plancha", formato: "P21" } },
      ],
    } as unknown as CorteGuardado;
    const lineas = [linea(20, 3, { corte: mezcla })];
    expect(necesidadesDeLineas(lineas, "and", almacenes, almacenables)).toEqual([
      expect.objectContaining({ productoId: 20, cantidad: 2, almacenId: "cat", motivo: "corte" }),
      expect.objectContaining({ productoId: 21, cantidad: 1, almacenId: "cat", motivo: "corte" }),
    ]);
    expect(productosDeLineas(lineas).sort()).toEqual([20, 21]);
  });

  it("los productos a mirar: los de las líneas y los materiales de los terminados", () => {
    const lineas = [linea(20, 1), linea(99, 1, { terminado: { materiales: [material(21, 1)] } })];
    expect(productosDeLineas(lineas).sort()).toEqual([20, 21]);
  });
});

describe("lo que falta y de dónde traerlo", () => {
  const necesidad = (productoId: number, cantidad: number, almacenId: string) => ({
    productoId,
    codigo: null,
    nombre: "x",
    cantidad,
    almacenId,
    motivo: "despacho" as const,
  });

  it("lo que alcanza no es faltante", () => {
    expect(faltantesDe([necesidad(20, 2, "and")], stock({ 20: { and: 2 } }), almacenes)).toEqual([]);
  });

  it("para la tienda, primero el taller; después los depósitos", () => {
    const [f] = faltantesDe([necesidad(20, 3, "and")], stock({ 20: { and: 1, cat: 5, esm: 9 } }), almacenes);
    expect(f).toMatchObject({ falta: 2, hay: 1, origenSugeridoId: "cat", hayEnOrigen: 5 });
    const [g] = faltantesDe([necesidad(20, 3, "and")], stock({ 20: { and: 1, cat: 1, esm: 9 } }), almacenes);
    expect(g).toMatchObject({ falta: 2, origenSugeridoId: "esm" });
  });

  it("si nadie tiene todo, el que más tiene; si nadie tiene nada, hay que comprar", () => {
    const [f] = faltantesDe([necesidad(20, 5, "cat")], stock({ 20: { and: 1, esm: 3 } }), almacenes);
    expect(f).toMatchObject({ falta: 5, origenSugeridoId: "esm", hayEnOrigen: 3 });
    const [g] = faltantesDe([necesidad(21, 1, "cat")], stock({}), almacenes);
    expect(g).toMatchObject({ falta: 1, origenSugeridoId: null, hayEnOrigen: 0 });
  });

  it("lo que una necesidad usa de un almacén no se le ofrece a otra", () => {
    const r = faltantesDe([necesidad(20, 2, "cat"), necesidad(20, 2, "and")], stock({ 20: { and: 2, cat: 0, esm: 2 } }), almacenes);
    // La tienda usa sus 2; al taller ya no se le sugiere la tienda.
    expect(r).toEqual([expect.objectContaining({ almacenId: "cat", falta: 2, origenSugeridoId: "esm" })]);
  });
});

describe("de qué almacén sale la venta", () => {
  it("si algo se produce en el taller, del taller", () => {
    const lineas = [linea(20, 1), linea(20, 1, { corte: corte("laser", "tienda", 1) })];
    expect(elegirDespacho(lineas, stock({ 20: { and: 10 } }), almacenes, almacenables)?.id).toBe("cat");
  });

  it("lo suelto: la tienda si lo tiene; si no, el taller si lo tiene todo", () => {
    const lineas = [linea(20, 2), linea(30, 1)];
    expect(elegirDespacho(lineas, stock({ 20: { and: 2, cat: 5 }, 30: { and: 1, cat: 1 } }), almacenes, almacenables)?.id).toBe("and");
    expect(elegirDespacho(lineas, stock({ 20: { and: 1, cat: 5 }, 30: { and: 1, cat: 1 } }), almacenes, almacenables)?.id).toBe("cat");
  });

  it("si ninguno tiene todo, el que cubre más (a igualdad, la tienda); un depósito nunca", () => {
    const lineas = [linea(20, 4), linea(30, 4)];
    expect(elegirDespacho(lineas, stock({ 20: { and: 1, cat: 3, esm: 99 }, 30: { esm: 99 } }), almacenes, almacenables)?.id).toBe("cat");
    expect(elegirDespacho(lineas, stock({ 20: { and: 2, cat: 2 }, 30: {} }), almacenes, almacenables)?.id).toBe("and");
    expect(elegirDespacho([linea(500, 1)], stock({}), almacenes, almacenables)?.id).toBe("and");
  });
});

describe("lo que se descuenta de un corte que mezcla formatos", () => {
  const mezcla = {
    modalidad: "laser",
    lugar: "taller",
    sobrantes: false,
    formato: { codigo: "P20", ancho: 122, alto: 244, precio: 0 },
    formatos: [
      { codigo: "P20", ancho: 122, alto: 244, precio: 0, productoId: 20 },
      { codigo: "P21", ancho: 122, alto: 183, precio: 0, productoId: 21 },
    ],
    planchas: [
      { origen: { tipo: "plancha", formato: "P20" } },
      { origen: { tipo: "plancha", formato: "P21" } },
      { origen: { tipo: "plancha", formato: "P21" } },
    ],
  } as unknown as CorteGuardado;
  const base = {
    posicion: 1,
    productoId: 20,
    nombre: "P20",
    codigo: "P20",
    descripcion: null,
    cantidad: 3,
    corte: mezcla,
    planchasUsadas: null,
    terminado: null,
    materialesUsados: null,
    importe: null,
    produccionId: null,
    produccionNombre: null,
    produccionCerrada: false,
  } satisfies LineaDePedido;

  it("sin anotar, lo calculado de cada formato", () => {
    expect([...cantidadesParaDescontar([base])]).toEqual([
      [20, 1],
      [21, 2],
    ]);
  });

  it("anotado, lo de cada formato", () => {
    const anotada = { ...base, planchasUsadas: 4, planchasUsadasPorFormato: { P20: 1, P21: 3 } };
    expect([...cantidadesParaDescontar([anotada])]).toEqual([
      [20, 1],
      [21, 3],
    ]);
  });
});
