import { describe, expect, it } from "vitest";
import { almacenDeLugar, lugarDeLinea, tipoDeDespacho } from "./almacenes";

const laser = { corte: { modalidad: "laser" as const, lugar: "tienda" as const } };
const manualTienda = { corte: { modalidad: "manual" as const, lugar: "tienda" as const } };
const manualTaller = { corte: { modalidad: "manual" as const, lugar: "taller" as const } };
const terminado = { terminado: { nombre: "Caja" } };
const plancha = { corte: null, terminado: null };

describe("dónde se produce una línea", () => {
  it("el láser y los productos terminados, en el taller; un manual, donde se diga", () => {
    expect(lugarDeLinea(laser)).toBe("taller");
    expect(lugarDeLinea(terminado)).toBe("taller");
    expect(lugarDeLinea(manualTienda)).toBe("tienda");
    expect(lugarDeLinea(manualTaller)).toBe("taller");
    expect(lugarDeLinea(plancha)).toBeNull();
  });
});

describe("de qué almacén sale la venta", () => {
  it("si algo se produce en el taller, del taller", () => {
    expect(tipoDeDespacho([plancha, laser])).toBe("taller");
    expect(tipoDeDespacho([manualTienda, terminado])).toBe("taller");
  });

  it("si no, de la tienda: planchas sueltas, accesorios o cortes manuales en tienda", () => {
    expect(tipoDeDespacho([plancha])).toBe("tienda");
    expect(tipoDeDespacho([manualTienda, plancha])).toBe("tienda");
    expect(tipoDeDespacho([])).toBe("tienda");
  });
});

describe("almacenDeLugar", () => {
  it("encuentra el taller y la tienda por su papel", () => {
    const almacenes = [
      { id: "a", tipo: "tienda" as const },
      { id: "c", tipo: "taller" as const },
      { id: "e", tipo: "deposito" as const },
    ];
    expect(almacenDeLugar(almacenes, "taller")?.id).toBe("c");
    expect(almacenDeLugar(almacenes, "tienda")?.id).toBe("a");
    expect(almacenDeLugar([{ id: "e", tipo: "deposito" as const }], "taller")).toBeNull();
  });
});
