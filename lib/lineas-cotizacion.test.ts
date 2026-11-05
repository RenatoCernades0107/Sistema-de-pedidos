import { describe, expect, it } from "vitest";
import {
  actualizarLinea,
  agregarProducto,
  cambiarCantidad,
  problemaDeLineas,
  quitarLinea,
  redondear2,
  subtotalDe,
  totalReferencial,
  type LineaCotizacion,
  type ProductoElegible,
} from "./lineas-cotizacion";

const plancha: ProductoElegible = { id: 10, nombre: "ACRILICO F8 CRISTAL 3MM", codigo: "AC-003", unidad: "Unidades", precio: 120 };
const corte: ProductoElegible = { id: 14, nombre: "SERVICIO CORTE LASER", codigo: "SRV-CL", unidad: "Minutos", precio: 1.5 };

let n = 0;
const clave = () => `k${++n}`;

describe("agregar productos", () => {
  it("una línea nueva arranca en 1 al precio de Odoo", () => {
    const r = agregarProducto([], plancha, clave);
    expect(r.sumada).toBe(false);
    expect(r.lineas).toEqual([
      expect.objectContaining({ productoId: 10, cantidad: 1, precioUnitario: 120, descripcion: "", codigo: "AC-003" }),
    ]);
    expect(r.lineas[0].clave).toBe(r.clave);
  });

  it("repetir el producto suma uno a su línea", () => {
    const a = agregarProducto([], plancha, clave);
    const b = agregarProducto(a.lineas, plancha, clave);
    expect(b.sumada).toBe(true);
    expect(b.clave).toBe(a.clave);
    expect(b.lineas).toHaveLength(1);
    expect(b.lineas[0].cantidad).toBe(2);
  });

  it("si la línea ya tiene detalle (medidas), el mismo producto va en otra línea", () => {
    const a = agregarProducto([], plancha, clave);
    const conDetalle = actualizarLinea(a.lineas, a.clave, { descripcion: "corte 30x50" });
    const b = agregarProducto(conDetalle, plancha, clave);
    expect(b.sumada).toBe(false);
    expect(b.lineas).toHaveLength(2);
    expect(b.lineas.map((l) => l.cantidad)).toEqual([1, 1]);
  });

  it("los ± no bajan de 1 ni dejan decimales sucios", () => {
    const a = agregarProducto([], plancha, clave);
    let ls = actualizarLinea(a.lineas, a.clave, { cantidad: 0.1 + 0.2 });
    ls = cambiarCantidad(ls, a.clave, 1);
    expect(ls[0].cantidad).toBe(1.3);
    ls = cambiarCantidad(ls, a.clave, -5);
    expect(ls[0].cantidad).toBe(1);
  });

  it("quitar una línea deja las demás", () => {
    const a = agregarProducto([], plancha, clave);
    const b = agregarProducto(a.lineas, corte, clave);
    expect(quitarLinea(b.lineas, a.clave).map((l) => l.productoId)).toEqual([14]);
  });
});

describe("totales", () => {
  it("redondea a céntimos sin el error de coma flotante", () => {
    expect(redondear2(1.005)).toBe(1.01);
    expect(subtotalDe({ cantidad: 3, precioUnitario: 0.1 })).toBe(0.3);
  });

  it("suma las líneas, con decimales en cantidad y precio", () => {
    const lineas = [
      { cantidad: 2.5, precioUnitario: 120 },
      { cantidad: 45, precioUnitario: 1.5 },
    ] as LineaCotizacion[];
    expect(totalReferencial(lineas)).toBe(367.5);
  });
});

describe("qué falta para crear", () => {
  it("sin líneas no se puede", () => {
    expect(problemaDeLineas([])).toMatch(/al menos un producto/);
  });

  it("una cantidad en cero o un precio negativo se nombran", () => {
    const a = agregarProducto([], plancha, clave);
    expect(problemaDeLineas(actualizarLinea(a.lineas, a.clave, { cantidad: 0 }))).toMatch(/cantidad de ACRILICO/);
    expect(problemaDeLineas(actualizarLinea(a.lineas, a.clave, { precioUnitario: -1 }))).toMatch(/precio de ACRILICO/);
    expect(problemaDeLineas(a.lineas)).toBeNull();
  });
});
