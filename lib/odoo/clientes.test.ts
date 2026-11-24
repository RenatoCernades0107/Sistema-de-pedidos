import { beforeEach, describe, expect, it, vi } from "vitest";

const ejecutar = vi.fn();
const modeloExiste = vi.fn();

vi.mock("./rpc", async (original) => ({
  ...(await original<typeof import("./rpc")>()),
  ejecutar: (...a: unknown[]) => ejecutar(...a),
  modeloExiste: (...a: unknown[]) => modeloExiste(...a),
  camposExistentes: async (_m: string, deseados: string[]) => deseados,
}));

import { contactosDeEmpresa, crearCliente, crearContacto } from "./clientes";

const fila = { id: 99, name: "renato", vat: "71737658" };

beforeEach(() => {
  ejecutar.mockReset();
  modeloExiste.mockReset();
  ejecutar.mockImplementation(async (modelo: string, metodo: string) => {
    if (modelo === "res.country") return [173];
    if (metodo === "create") return 99;
    return metodo === "read" ? [fila] : [];
  });
});

const crear = () => ejecutar.mock.calls.find(([, metodo]) => metodo === "create")!;

describe("crearCliente sin la localización latinoamericana", () => {
  beforeEach(() => modeloExiste.mockResolvedValue(false));

  it("un DNI se crea sin que Odoo lo valide como RUC", async () => {
    await crearCliente({ nombre: "renato", documento: "71737658", telefono: null, email: null });
    expect(crear()[3]).toEqual({ context: { no_vat_validation: true } });
  });

  it("un RUC se valida como siempre", async () => {
    await crearCliente({ nombre: "Empresa", documento: "20512345671", telefono: null, email: null });
    expect(crear()[3]).toEqual({});
  });
});

describe("crearCliente con la localización", () => {
  it("un DNI usa su tipo de documento y no se salta la validación", async () => {
    modeloExiste.mockResolvedValue(true);
    ejecutar.mockImplementation(async (modelo: string, metodo: string) => {
      if (modelo === "res.country") return [173];
      if (modelo === "l10n_latam.identification.type") return [{ id: 5, name: "DNI", l10n_pe_vat_code: "1" }];
      if (metodo === "create") return 99;
      return metodo === "read" ? [fila] : [];
    });
    await crearCliente({ nombre: "renato", documento: "71737658", telefono: null, email: null });
    expect(crear()[2][0]).toMatchObject({ l10n_latam_identification_type_id: 5 });
    expect(crear()[3]).toEqual({});
  });
});

const creaciones = () => ejecutar.mock.calls.filter(([, metodo]) => metodo === "create");
const maria = { nombre: "María Ruiz", cargo: "Compras", telefono: "987654321", email: "maria@andina.test" };

describe("crearCliente con contacto", () => {
  beforeEach(() => modeloExiste.mockResolvedValue(false));

  it("una empresa con contacto: el teléfono y el correo son de la persona, no de la empresa", async () => {
    const r = await crearCliente({ nombre: "Andina SAC", documento: "20512345671", telefono: null, email: null, contacto: maria });
    const [empresa, persona] = creaciones().map((c) => c[2][0]);
    expect(empresa).not.toHaveProperty("phone");
    expect(empresa).not.toHaveProperty("email");
    expect(persona).toMatchObject({
      name: "María Ruiz", parent_id: 99, type: "contact", is_company: false, function: "Compras",
      phone: "987654321", email: "maria@andina.test",
    });
    expect(r.contacto).toMatchObject({ empresaId: 99 });
  });

  it("sin contacto, una empresa conserva el teléfono como hasta ahora", async () => {
    await crearCliente({ nombre: "Andina SAC", documento: "20512345671", telefono: "999888777", email: null });
    expect(creaciones()).toHaveLength(1);
    expect(crear()[2][0]).toMatchObject({ phone: "999888777" });
  });

  it("un cliente persona no lleva contacto aunque se lo den", async () => {
    await crearCliente({ nombre: "renato", documento: "71737658", telefono: "999888777", email: null, contacto: maria });
    expect(creaciones()).toHaveLength(1);
    expect(crear()[2][0]).toMatchObject({ phone: "999888777" });
  });

  it("si el contacto falla, la empresa queda creada y se avisa", async () => {
    ejecutar.mockImplementation(async (modelo: string, metodo: string, args: unknown[][]) => {
      if (modelo === "res.country") return [173];
      if (metodo === "create") {
        if ((args[0] as { parent_id?: number }).parent_id) throw new Error("Odoo no acepta el contacto");
        return 99;
      }
      return metodo === "read" ? [fila] : [];
    });
    const r = await crearCliente({ nombre: "Andina SAC", documento: "20512345671", telefono: null, email: null, contacto: maria });
    expect(r).toMatchObject({ existia: false, contacto: null, errorContacto: "Odoo no acepta el contacto" });
  });

  it("si la empresa ya existía, no se le agrega el contacto", async () => {
    ejecutar.mockImplementation(async (_m: string, metodo: string) =>
      metodo === "search_read" ? [{ id: 7, name: "Andina SAC", vat: "20512345671" }] : [],
    );
    const r = await crearCliente({ nombre: "Andina SAC", documento: "20512345671", telefono: null, email: null, contacto: maria });
    expect(r).toMatchObject({ existia: true });
    expect(creaciones()).toHaveLength(0);
  });
});

describe("contactos de una empresa", () => {
  it("se piden los hijos de tipo contacto y se leen en el idioma de la app", async () => {
    ejecutar.mockResolvedValue([
      { id: 5, name: "María Ruiz", function: "Compras", phone: false, mobile: "987654321", email: "m@a.test", parent_id: [2, "Andina"] },
      { id: 6, name: "Luis Soto", function: false, phone: "01 555 1234", email: false, parent_id: [2, "Andina"] },
    ]);
    const r = await contactosDeEmpresa(2);
    expect(ejecutar.mock.calls[0][2][0]).toEqual([["parent_id", "=", 2], ["type", "=", "contact"]]);
    expect(r).toEqual([
      { id: 5, empresaId: 2, nombre: "María Ruiz", cargo: "Compras", telefono: "987654321", email: "m@a.test" },
      { id: 6, empresaId: 2, nombre: "Luis Soto", cargo: null, telefono: "01 555 1234", email: null },
    ]);
  });

  it("agregar uno solo manda lo que se dio", async () => {
    ejecutar.mockImplementation(async (_m: string, metodo: string) =>
      metodo === "create" ? 8 : [{ id: 8, name: "Ana", parent_id: [2, "Andina"] }],
    );
    const c = await crearContacto(2, { nombre: " Ana ", telefono: null, email: null });
    expect(crear()[2][0]).toEqual({ name: "Ana", parent_id: 2, type: "contact", is_company: false });
    expect(c).toMatchObject({ id: 8, empresaId: 2, nombre: "Ana", telefono: null });
  });
});
