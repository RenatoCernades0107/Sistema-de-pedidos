import { describe, expect, it } from "vitest";
import { detalleDesdeLineas, type LineaGuardada } from "./cotizaciones";

const linea = (l: Partial<LineaGuardada>): LineaGuardada => ({
  posicion: 1,
  productoId: 10,
  nombre: "ACRILICO F8 CRISTAL 3MM",
  codigo: "AC-003",
  descripcion: null,
  cantidad: 1,
  precioUnitario: 120,
  ...l,
});

describe("detalleDesdeLineas", () => {
  it("una línea por producto, con cantidad, código y medidas", () => {
    expect(
      detalleDesdeLineas([
        linea({ cantidad: 2, descripcion: "corte\n30x50 cm" }),
        linea({ posicion: 2, cantidad: 0.5, codigo: null, nombre: "SERVICIO CORTE LASER" }),
      ]),
    ).toBe("2 × [AC-003] ACRILICO F8 CRISTAL 3MM — corte 30x50 cm\n0.5 × SERVICIO CORTE LASER");
  });

  it("no arrastra decimales de más", () => {
    expect(detalleDesdeLineas([linea({ cantidad: 2.5 })])).toBe("2.5 × [AC-003] ACRILICO F8 CRISTAL 3MM");
  });
});
