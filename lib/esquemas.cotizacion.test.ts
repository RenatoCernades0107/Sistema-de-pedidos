import { describe, expect, it } from "vitest";
import { esquemaNuevaCotizacion, esquemaNuevoClienteOdoo } from "./esquemas";

const valida = {
  canal: "tienda",
  clienteId: 2,
  lineas: [{ productoId: 10, cantidad: 2.5, precioUnitario: 120, descripcion: null }],
  notas: null,
};

const mensaje = (r: { success: boolean; error?: { issues: { message: string }[] } }) =>
  r.success ? null : r.error!.issues[0].message;

describe("esquemaNuevaCotizacion", () => {
  it("acepta una cotización completa", () => {
    expect(esquemaNuevaCotizacion.safeParse(valida).success).toBe(true);
    expect(esquemaNuevaCotizacion.safeParse({ ...valida, canal: "whatsapp" }).success).toBe(true);
  });

  it("exige cliente y al menos un producto", () => {
    expect(mensaje(esquemaNuevaCotizacion.safeParse({ ...valida, clienteId: 0 }))).toBe("Elige el cliente");
    expect(mensaje(esquemaNuevaCotizacion.safeParse({ ...valida, lineas: [] }))).toBe("Agrega al menos un producto");
  });

  it("solo conoce los dos canales", () => {
    expect(esquemaNuevaCotizacion.safeParse({ ...valida, canal: "correo" }).success).toBe(false);
  });

  it("cantidad mayor que cero, hasta 3 decimales; precio no negativo, hasta 2", () => {
    const linea = (l: object) => ({ ...valida, lineas: [{ ...valida.lineas[0], ...l }] });
    expect(mensaje(esquemaNuevaCotizacion.safeParse(linea({ cantidad: 0 })))).toMatch(/mayor que cero/);
    expect(mensaje(esquemaNuevaCotizacion.safeParse(linea({ cantidad: 1.2345 })))).toMatch(/3 decimales/);
    expect(mensaje(esquemaNuevaCotizacion.safeParse(linea({ precioUnitario: -1 })))).toMatch(/negativo/);
    expect(mensaje(esquemaNuevaCotizacion.safeParse(linea({ precioUnitario: 1.005 })))).toMatch(/2 decimales/);
    expect(esquemaNuevaCotizacion.safeParse(linea({ precioUnitario: 0 })).success).toBe(true);
  });
});

describe("esquemaNuevoClienteOdoo", () => {
  const cliente = { nombre: "Corporación Andina SAC", documento: "", telefono: "", email: "" };

  it("el documento es opcional y lo vacío llega como null", () => {
    const r = esquemaNuevoClienteOdoo.parse(cliente);
    expect(r).toEqual({ nombre: "Corporación Andina SAC", documento: null, telefono: null, email: null });
  });

  it("acepta un DNI de 8 y un RUC de 11 válido, aunque traigan espacios o guiones", () => {
    expect(esquemaNuevoClienteOdoo.parse({ ...cliente, documento: "4567 8912" }).documento).toBe("45678912");
    expect(esquemaNuevoClienteOdoo.parse({ ...cliente, documento: "20-123456786" }).documento).toBe("20123456786");
  });

  it("rechaza un RUC con el dígito verificador mal y un largo que no es ni DNI ni RUC", () => {
    expect(mensaje(esquemaNuevoClienteOdoo.safeParse({ ...cliente, documento: "20123456789" }))).toMatch(/RUC no es válido/);
    expect(mensaje(esquemaNuevoClienteOdoo.safeParse({ ...cliente, documento: "1234567" }))).toMatch(/DNI \(8 dígitos\) o un RUC/);
  });

  it("pide el nombre y un correo bien escrito", () => {
    expect(mensaje(esquemaNuevoClienteOdoo.safeParse({ ...cliente, nombre: " " }))).toMatch(/nombre/);
    expect(mensaje(esquemaNuevoClienteOdoo.safeParse({ ...cliente, email: "no-es-correo" }))).toMatch(/correo/);
  });
});
