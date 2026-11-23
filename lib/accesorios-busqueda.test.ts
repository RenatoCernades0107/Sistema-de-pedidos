import { describe, expect, it } from "vitest";
import { categoriasConAccesorios } from "./accesorios-busqueda";

const categorias = [
  { id: "c1", nombre: "Bisagras" },
  { id: "c2", nombre: "Imanes" },
  { id: "c3", nombre: "Tornillos" },
];

describe("categoriasConAccesorios", () => {
  it("junta los activos en su categoría, sin repetir y en el orden del Almacén", () => {
    const r = categoriasConAccesorios(categorias, [
      { codigo_odoo: "ACC002", categoria_id: "c2", activo: true },
      { codigo_odoo: "ACC001", categoria_id: "c1", activo: true },
      { codigo_odoo: "ACC003", categoria_id: "c1", activo: true },
      { codigo_odoo: "ACC003", categoria_id: "c1", activo: true },
    ]);
    expect(r).toEqual([
      { id: "c1", nombre: "Bisagras", codigos: ["ACC001", "ACC003"] },
      { id: "c2", nombre: "Imanes", codigos: ["ACC002"] },
    ]);
  });

  it("deja fuera los inactivos y las categorías que se quedan vacías", () => {
    const r = categoriasConAccesorios(categorias, [
      { codigo_odoo: "ACC009", categoria_id: "c3", activo: false },
      { codigo_odoo: "ACC001", categoria_id: "c1", activo: true },
    ]);
    expect(r.map((c) => c.id)).toEqual(["c1"]);
  });
});
