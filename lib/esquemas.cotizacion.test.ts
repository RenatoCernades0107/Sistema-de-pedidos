import { describe, expect, it } from "vitest";
import {
  esquemaEdicionCotizacion,
  esquemaNuevaCotizacion,
  esquemaNuevoClienteOdoo,
  esquemaNuevoContacto,
} from "./esquemas";

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
    expect(r).toEqual({ nombre: "Corporación Andina SAC", documento: null, direccion: null, telefono: null, email: null });
  });

  it("la dirección es opcional: se recorta y lo vacío llega como null", () => {
    expect(esquemaNuevoClienteOdoo.parse({ ...cliente, direccion: "  JR. CENTENARIO 156  " }).direccion).toBe("JR. CENTENARIO 156");
    expect(esquemaNuevoClienteOdoo.parse({ ...cliente, direccion: "" }).direccion).toBeNull();
    expect(esquemaNuevoClienteOdoo.safeParse({ ...cliente, direccion: "x".repeat(201) }).success).toBe(false);
  });

  it("acepta un DNI de 8 y un RUC de 11 válido, aunque traigan espacios o guiones", () => {
    expect(esquemaNuevoClienteOdoo.parse({ ...cliente, documento: "4567 8912" }).documento).toBe("45678912");
    expect(esquemaNuevoClienteOdoo.parse({ ...cliente, documento: "20-123456786" }).documento).toBe("20123456786");
  });

  it("rechaza un RUC con el dígito verificador mal y un largo que no es ni DNI ni RUC", () => {
    expect(mensaje(esquemaNuevoClienteOdoo.safeParse({ ...cliente, documento: "20123456789" }))).toMatch(/RUC no es válido/);
    expect(mensaje(esquemaNuevoClienteOdoo.safeParse({ ...cliente, documento: "1234567" }))).toMatch(/DNI \(8 dígitos\) o un RUC/);
  });

  it("valida lo tecleado, no su resultado: el formulario debe mandar los valores crudos", () => {
    // Regresión: se mandaba la salida del esquema (vacíos → null) y el servidor,
    // que vuelve a validar, respondía "Invalid input" al dejar el correo vacío.
    const crudo = { nombre: "pepe", documento: "71737658", telefono: "983097220", email: "" };
    expect(esquemaNuevoClienteOdoo.safeParse(crudo).success).toBe(true);
    const yaTransformado = esquemaNuevoClienteOdoo.parse(crudo);
    expect(esquemaNuevoClienteOdoo.safeParse(yaTransformado).success).toBe(false);
  });

  it("pide el nombre y un correo bien escrito", () => {
    expect(mensaje(esquemaNuevoClienteOdoo.safeParse({ ...cliente, nombre: " " }))).toMatch(/nombre/);
    expect(mensaje(esquemaNuevoClienteOdoo.safeParse({ ...cliente, email: "no-es-correo" }))).toMatch(/correo/);
  });
});

describe("esquemaNuevoClienteOdoo: contacto", () => {
  const empresa = { nombre: "Corporación Andina SAC", documento: "20123456786", telefono: "", email: "" };
  const vacio = { nombre: "", cargo: "", telefono: "", email: "" };

  it("sin contacto, o con todo vacío, llega sin contacto", () => {
    expect(esquemaNuevoClienteOdoo.parse(empresa).contacto).toBeUndefined();
    expect(esquemaNuevoClienteOdoo.parse({ ...empresa, contacto: vacio }).contacto).toBeNull();
  });

  it("recorta y deja en null lo que falta", () => {
    const r = esquemaNuevoClienteOdoo.parse({ ...empresa, contacto: { ...vacio, nombre: " María Ruiz ", telefono: "987654321" } });
    expect(r.contacto).toEqual({ nombre: "María Ruiz", cargo: null, telefono: "987654321", email: null });
  });

  it("un teléfono o correo sin nombre no se acepta: ¿de quién sería?", () => {
    expect(mensaje(esquemaNuevoClienteOdoo.safeParse({ ...empresa, contacto: { ...vacio, telefono: "987654321" } }))).toMatch(/nombre del contacto/);
  });

  it("el correo del contacto tiene que estar bien escrito", () => {
    expect(mensaje(esquemaNuevoClienteOdoo.safeParse({ ...empresa, contacto: { ...vacio, nombre: "Ana", email: "no-es-correo" } }))).toMatch(/correo/);
  });
});

describe("contactoId en la cotización", () => {
  const base = {
    canal: "tienda",
    clienteId: 2,
    lineas: [{ productoId: 10, cantidad: 1, precioUnitario: 100, descripcion: "" }],
    notas: null,
  };

  it("es opcional y tiene que ser un id de Odoo", () => {
    expect(esquemaNuevaCotizacion.safeParse(base).success).toBe(true);
    expect(esquemaNuevaCotizacion.safeParse({ ...base, contactoId: null }).success).toBe(true);
    expect(esquemaNuevaCotizacion.safeParse({ ...base, contactoId: 7 }).success).toBe(true);
    expect(esquemaNuevaCotizacion.safeParse({ ...base, contactoId: 0 }).success).toBe(false);
  });
});

describe("esquemaNuevoContacto", () => {
  const contacto = { empresaId: 2, nombre: " María Ruiz ", cargo: "", telefono: "987654321", email: "" };

  it("recorta y deja en null lo que falta", () => {
    expect(esquemaNuevoContacto.parse(contacto)).toEqual({
      empresaId: 2, nombre: "María Ruiz", cargo: null, telefono: "987654321", email: null,
    });
  });

  it("pide la empresa y el nombre, y un correo bien escrito", () => {
    expect(esquemaNuevoContacto.safeParse({ ...contacto, empresaId: 0 }).success).toBe(false);
    expect(mensaje(esquemaNuevoContacto.safeParse({ ...contacto, nombre: " " }))).toMatch(/nombre del contacto/);
    expect(mensaje(esquemaNuevoContacto.safeParse({ ...contacto, email: "no-es-correo" }))).toMatch(/correo/);
  });
});

describe("esquemaEdicionCotizacion", () => {
  it("acepta lo mismo que una cotización nueva", () => {
    expect(esquemaEdicionCotizacion.safeParse(valida).success).toBe(true);
  });

  it("deja conservar una línea ya guardada, solo por su posición", () => {
    const r = esquemaEdicionCotizacion.parse({
      ...valida,
      lineas: [{ tipo: "conservar", posicion: 2 }, valida.lineas[0]],
    });
    expect(r.lineas[0]).toEqual({ tipo: "conservar", posicion: 2 });
  });

  it("una línea conservada necesita una posición válida", () => {
    const con = (l: object) => esquemaEdicionCotizacion.safeParse({ ...valida, lineas: [l] }).success;
    expect(con({ tipo: "conservar" })).toBe(false);
    expect(con({ tipo: "conservar", posicion: 0 })).toBe(false);
    expect(con({ tipo: "conservar", posicion: 1.5 })).toBe(false);
  });

  it("la cotización nueva NO acepta líneas conservadas: no hay qué conservar", () => {
    expect(
      esquemaNuevaCotizacion.safeParse({ ...valida, lineas: [{ tipo: "conservar", posicion: 1 }] }).success,
    ).toBe(false);
  });

  it("sigue exigiendo cliente y al menos una línea", () => {
    expect(mensaje(esquemaEdicionCotizacion.safeParse({ ...valida, clienteId: 0 }))).toBe("Elige el cliente");
    expect(mensaje(esquemaEdicionCotizacion.safeParse({ ...valida, lineas: [] }))).toBe("Agrega al menos un producto");
  });
});
