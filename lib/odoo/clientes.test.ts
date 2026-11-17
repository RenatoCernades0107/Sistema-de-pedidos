import { beforeEach, describe, expect, it, vi } from "vitest";

const ejecutar = vi.fn();
const modeloExiste = vi.fn();

vi.mock("./rpc", async (original) => ({
  ...(await original<typeof import("./rpc")>()),
  ejecutar: (...a: unknown[]) => ejecutar(...a),
  modeloExiste: (...a: unknown[]) => modeloExiste(...a),
  camposExistentes: async (_m: string, deseados: string[]) => deseados,
}));

import { crearCliente } from "./clientes";

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
