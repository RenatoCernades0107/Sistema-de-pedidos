import { describe, expect, it } from "vitest";
import {
  Buscador,
  analizarConsulta,
  compactar,
  distancia,
  normalizarTexto,
  resaltar,
  resaltarCodigo,
  rucValido,
  tipoDeDocumento,
} from "./busqueda-inteligente";
import { camposCliente, camposProducto } from "./odoo/catalogos";
import type { ClienteOdoo, ProductoOdoo } from "./odoo/tipos";

const producto = (id: number, codigo: string | null, nombre: string, extra: Partial<ProductoOdoo> = {}): ProductoOdoo => ({
  id,
  codigo,
  nombre,
  barcode: null,
  precio: 100,
  unidad: "Unidades",
  categoria: "Acrílicos",
  ...extra,
});

const PRODUCTOS: ProductoOdoo[] = [
  producto(10, "AC-003", "ACRILICO F8 CRISTAL 3MM", { barcode: "7750000000031" }),
  producto(11, "AC-005", "ACRILICO F8 CRISTAL 5MM"),
  producto(12, "AC-103", "ACRILICO BRONCE 3MM"),
  producto(13, "PVC-010", "PVC ESPUMADO BLANCO 10MM", { categoria: "PVC" }),
  producto(14, "SRV-CL", "SERVICIO CORTE LASER", { categoria: "Servicios" }),
  // Un código que es también una palabra que aparece en otros nombres.
  producto(20, "BLANCO", "LÁMINA OPAL"),
  producto(21, null, "ACRILICO ESPEJO PLATA 3MM"),
];

const cliente = (id: number, nombre: string, extra: Partial<ClienteOdoo> = {}): ClienteOdoo => ({
  id,
  nombre,
  documento: null,
  telefono: null,
  email: null,
  ciudad: null,
  esEmpresa: false,
  empresa: null,
  ...extra,
});

const CLIENTES: ClienteOdoo[] = [
  cliente(1, "José Pérez Quispe", { documento: "45678912", telefono: "987 654 321", ciudad: "Lima" }),
  cliente(2, "Corporación Andina SAC", { documento: "20123456786", email: "compras@andina.test" }),
  cliente(3, "Ñuñez Talleres EIRL", { documento: "20601234565", ciudad: "Arequipa" }),
  cliente(4, "Josefina Ramos", { telefono: "999 111 222" }),
];

const productos = new Buscador(PRODUCTOS, camposProducto);
const clientes = new Buscador(CLIENTES, camposCliente);
const ids = (r: { item: { id: number } }[]) => r.map((e) => e.item.id);

describe("normalización", () => {
  it("separa números de letras y quita tildes y signos", () => {
    expect(normalizarTexto("3mm")).toBe("3 mm");
    expect(normalizarTexto("30x50cm")).toBe("30 x 50 cm");
    expect(normalizarTexto("Acrílico_F8 (cristal)")).toBe("acrilico f 8 cristal");
  });

  it("compacta los códigos: sin espacios, guiones ni puntos", () => {
    expect(compactar("AC-003")).toBe("ac003");
    expect(compactar("ac 003")).toBe("ac003");
    expect(compactar("Ac.0-03")).toBe("ac003");
  });

  it("reconoce cuándo la consulta parece un código", () => {
    expect(analizarConsulta("AC003").pareceCodigo).toBe(true);
    expect(analizarConsulta("ac-0").pareceCodigo).toBe(true);
    expect(analizarConsulta("acrilico 3mm").pareceCodigo).toBe(false);
    expect(analizarConsulta("cristal").pareceCodigo).toBe(false);
  });

  it("cuenta los errores de tipeo, con intercambios de letras vecinas", () => {
    expect(distancia("acrlico", "acrilico")).toBe(1);
    expect(distancia("acirlico", "acrilico")).toBe(1);
    expect(distancia("bronze", "bronce")).toBe(1);
    expect(distancia("vidrio", "acrilico")).toBeGreaterThan(2);
  });
});

describe("búsqueda de productos por código", () => {
  it.each(["AC003", "ac-003", "ac 003", "AC-003", " ac003 "])(
    "«%s» encuentra AC-003 primero, por código exacto",
    (q) => {
      const r = productos.buscar(q);
      expect(r[0].item.id).toBe(10);
      expect(r[0].porCodigo).toBe("exacto");
    },
  );

  it("un prefijo de código lista los que empiezan así, el más corto primero", () => {
    const r = productos.buscar("ac0");
    expect(ids(r).slice(0, 2)).toEqual([10, 11]);
    expect(r[0].porCodigo).toBe("prefijo");
    // AC-103 no empieza por "ac0".
    expect(ids(r)).not.toContain(12);
  });

  it("el código de barras exacto gana", () => {
    const r = productos.buscar("7750000000031");
    expect(r[0].item.id).toBe(10);
    expect(r[0].porCodigo).toBe("exacto");
  });

  it("un código exacto le gana a un nombre que contiene esa palabra", () => {
    const r = productos.buscar("blanco");
    expect(r[0].item.id).toBe(20);
    expect(r[0].porCodigo).toBe("exacto");
    expect(ids(r)).toContain(13);
  });

  it("los códigos también se buscan como palabras junto al nombre", () => {
    expect(productos.buscar("acrilico ac 103")[0].item.id).toBe(12);
  });

  it("solo exactos, para el lector de códigos de barras", () => {
    expect(ids(productos.buscar("ac-003", { soloCodigoExacto: true }))).toEqual([10]);
    expect(productos.buscar("ac0", { soloCodigoExacto: true })).toEqual([]);
    expect(ids(productos.buscar("7750000000031", { soloCodigoExacto: true }))).toEqual([10]);
  });
});

describe("búsqueda de productos por nombre", () => {
  it("palabras sueltas en cualquier orden", () => {
    expect(ids(productos.buscar("acri cristal 3"))).toEqual([10]);
    expect(ids(productos.buscar("3mm cristal"))).toEqual([10]);
  });

  it("«transparente» encuentra «cristal»", () => {
    expect(productos.buscar("acrilico transparente 3mm")[0].item.id).toBe(10);
    // También a medio escribir.
    expect(productos.buscar("transpa 5")[0].item.id).toBe(11);
  });

  it("perdona errores de tipeo", () => {
    const r = ids(productos.buscar("acrlico bronze"));
    expect(r).toEqual([12]);
  });

  it("todas las palabras tienen que aparecer", () => {
    expect(productos.buscar("acrilico vidrio")).toEqual([]);
  });

  it("busca también en la categoría", () => {
    expect(ids(productos.buscar("servicios"))).toEqual([14]);
  });

  it("a igualdad, desempata lo que más se cotiza", () => {
    const sin = ids(productos.buscar("acrilico 3mm"));
    const con = ids(productos.buscar("acrilico 3mm", { popularidad: (p) => (p.id === 21 ? 20 : 0) }));
    expect(con[0]).toBe(21);
    expect(new Set(con)).toEqual(new Set(sin));
  });

  it("respeta el límite", () => {
    expect(productos.buscar("a", { limite: 2 })).toHaveLength(2);
  });

  it("sin consulta no devuelve nada", () => {
    expect(productos.buscar("   ")).toEqual([]);
  });
});

describe("búsqueda de clientes", () => {
  it("sin tildes encuentra con tildes", () => {
    expect(clientes.buscar("jose perez")[0].item.id).toBe(1);
    expect(clientes.buscar("nunez")[0].item.id).toBe(3);
  });

  it("un RUC o DNI exacto va primero", () => {
    const r = clientes.buscar("20123456786");
    expect(r[0].item.id).toBe(2);
    expect(r[0].porCodigo).toBe("exacto");
    expect(clientes.buscar("45678912")[0].item.id).toBe(1);
  });

  it("parte del RUC lo encuentra por prefijo", () => {
    expect(clientes.buscar("2012345")[0].item.id).toBe(2);
  });

  it("encuentra por teléfono, escrito con o sin espacios", () => {
    expect(clientes.buscar("987654321")[0].item.id).toBe(1);
    expect(clientes.buscar("987 654")[0].item.id).toBe(1);
  });

  it("encuentra por correo y por ciudad", () => {
    expect(clientes.buscar("andina.test")[0].item.id).toBe(2);
    expect(clientes.buscar("arequipa")[0].item.id).toBe(3);
  });

  it("el nombre que coincide entero va antes que el que solo empieza igual", () => {
    expect(ids(clientes.buscar("jose")).slice(0, 2)).toEqual([1, 4]);
  });
});

describe("resaltado", () => {
  it("marca lo que coincide sin perder las tildes del original", () => {
    expect(resaltar("José Pérez", "jose")).toEqual([
      { texto: "José", marcado: true },
      { texto: " Pérez", marcado: false },
    ]);
  });

  it("una sola cifra se marca solo al inicio de una palabra", () => {
    expect(resaltar("CRISTAL 3MM", "3")).toEqual([
      { texto: "CRISTAL ", marcado: false },
      { texto: "3", marcado: true },
      { texto: "MM", marcado: false },
    ]);
  });

  it("marca el sinónimo que trajo el resultado", () => {
    const marcados = resaltar("ACRILICO F8 CRISTAL 3MM", "transparente")
      .filter((t) => t.marcado)
      .map((t) => t.texto);
    expect(marcados).toEqual(["CRISTAL"]);
  });

  it("en un código salta los guiones como la búsqueda", () => {
    expect(resaltarCodigo("AC-003", "ac0")).toEqual([
      { texto: "AC-0", marcado: true },
      { texto: "03", marcado: false },
    ]);
    expect(resaltarCodigo("AC-003", "zz")).toEqual([{ texto: "AC-003", marcado: false }]);
  });
});

describe("documentos peruanos", () => {
  it("valida el dígito verificador del RUC", () => {
    expect(rucValido("20123456786")).toBe(true);
    expect(rucValido("20601234565")).toBe(true);
    expect(rucValido("20123456789")).toBe(false);
    // Prefijo que no existe.
    expect(rucValido("30123456786")).toBe(false);
  });

  it("distingue RUC de DNI por el largo", () => {
    expect(tipoDeDocumento("20123456786")).toBe("RUC");
    expect(tipoDeDocumento("45678912")).toBe("DNI");
    expect(tipoDeDocumento("4567891")).toBeNull();
    expect(tipoDeDocumento("Juan")).toBeNull();
  });
});
