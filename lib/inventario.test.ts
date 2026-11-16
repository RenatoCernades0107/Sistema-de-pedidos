import { describe, expect, it } from "vitest";
import { esquemaIngreso, esquemaNuevoProducto, filasDePlanchas, nombreDePlancha, valoresDe } from "./inventario";

const ALMACEN = "11111111-2222-4333-8444-555555555555";

describe("nombreDePlancha", () => {
  it("como los nombres de la lista de la empresa: sin tildes, en mayúsculas y la medida en metros", () => {
    expect(
      nombreDePlancha({ material: "Acrílico ECO", variante: "Colores", detalle: "Rojo", espesorMm: 3, anchoCm: 122, largoCm: 183 }),
    ).toBe("ACRILICO ECO COLORES ROJO 3MM 1.22X1.83");
    expect(nombreDePlancha({ material: "MDF", variante: "", detalle: "", espesorMm: 5.5, anchoCm: 122, largoCm: 244 })).toBe(
      "MDF 5.5MM 1.22X2.44",
    );
  });
});

describe("filasDePlanchas", () => {
  it("una fila por formato, con su grupo", () => {
    const filas = filasDePlanchas([
      {
        id: "g",
        material: "Acrílico ECO",
        variante: "Blanco",
        detalle: "Lechoso",
        espesorMm: 3,
        rotable: true,
        sobrantesActivo: true,
        formatos: [
          { id: "f1", codigo: "F7E072", anchoCm: 122, largoCm: 183, porVerificar: false, nota: null, activo: true },
          { id: "f2", codigo: "F9E001", anchoCm: 122, largoCm: 244, porVerificar: false, nota: null, activo: false },
        ],
      },
    ]);
    expect(filas).toEqual([
      expect.objectContaining({ grupoId: "g", formatoId: "f1", color: "Blanco lechoso", formato: "122×183", activo: true }),
      expect.objectContaining({ formatoId: "f2", formato: "122×244", activo: false }),
    ]);
    expect(valoresDe(filas, "material")).toEqual(["Acrílico ECO"]);
  });
});

describe("esquemaIngreso", () => {
  const compra = {
    tipo: "compra",
    almacenId: ALMACEN,
    proveedorId: 2,
    proveedorNombre: "Proveedor SAC",
    documento: "F001-123",
    nota: "",
    lineas: [{ productoId: 20, cantidad: 4, costo: 150 }],
  };

  it("una compra con proveedor, unidades enteras y costo", () => {
    const r = esquemaIngreso.safeParse(compra);
    expect(r.success).toBe(true);
    expect(r.data?.nota).toBeNull();
  });

  it("una compra necesita proveedor y el costo de cada producto", () => {
    expect(esquemaIngreso.safeParse({ ...compra, proveedorId: null }).error?.issues[0].message).toMatch(/proveedor/);
    expect(
      esquemaIngreso.safeParse({ ...compra, lineas: [{ productoId: 20, cantidad: 4, costo: null }] }).error?.issues[0].message,
    ).toMatch(/costo/);
  });

  it("siempre por unidades, y un producto una sola vez", () => {
    expect(esquemaIngreso.safeParse({ ...compra, lineas: [{ productoId: 20, cantidad: 1.5, costo: 1 }] }).success).toBe(false);
    expect(
      esquemaIngreso.safeParse({
        ...compra,
        lineas: [
          { productoId: 20, cantidad: 1, costo: 1 },
          { productoId: 20, cantidad: 2, costo: 1 },
        ],
      }).success,
    ).toBe(false);
  });

  it("un ajuste no lleva proveedor, y puede dejar en cero", () => {
    const r = esquemaIngreso.safeParse({
      ...compra,
      tipo: "ajuste",
      proveedorId: null,
      lineas: [{ productoId: 20, cantidad: 0, costo: null }],
    });
    expect(r.success).toBe(true);
  });
});

describe("esquemaNuevoProducto", () => {
  it("una plancha o un accesorio", () => {
    expect(
      esquemaNuevoProducto.safeParse({
        tipo: "plancha",
        material: "Acrílico ECO",
        variante: "Colores",
        detalle: "Rojo",
        espesorMm: 3,
        anchoCm: 122,
        largoCm: 183,
        rotable: true,
        precio: null,
      }).success,
    ).toBe(true);
    expect(esquemaNuevoProducto.safeParse({ tipo: "accesorio", categoriaId: ALMACEN, nombre: "Bisagra 30mm", precio: 8 }).success).toBe(true);
    expect(esquemaNuevoProducto.safeParse({ tipo: "accesorio", categoriaId: ALMACEN, nombre: "x", precio: 8 }).success).toBe(false);
  });
});
