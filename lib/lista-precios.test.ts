import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { armarLista, materialesConPrecio, medidaEnMetros, separarRef, tramosDePrecio, type PlanchaParaLista } from "./lista-precios";
import { CONFIG_LISTA_PRECIOS_DEFECTO, leerConfigListaPrecios, notasDe } from "./lista-precios-config";
import { generarPdfListaPrecios, precioLista } from "./pdf-lista-precios";

const plancha = (p: Partial<PlanchaParaLista>): PlanchaParaLista => ({
  material: "Superficie sólida de acrílico",
  color: "White (KS-003)",
  espesorMm: 12,
  anchoCm: 76,
  largoCm: 368,
  codigo: "SS001",
  precio: 1195,
  activo: true,
  ...p,
});

const planchas = [
  plancha({ color: "Mocha (KP-301)", codigo: "SS013", precio: 1270 }),
  plancha({}),
  plancha({ color: "Sahara (KM-103)", codigo: "SS006", precio: 1270 }),
  plancha({ codigo: "SS002", espesorMm: 6, anchoCm: 122, largoCm: 244, precio: 870 }),
  plancha({ material: "Acrílico ECO", color: "Cristal", codigo: "F7E024", espesorMm: 3, anchoCm: 122, largoCm: 183, precio: 180 }),
  plancha({ material: "Acrílico ECO", color: "Negro", codigo: "F7E029", espesorMm: 3, anchoCm: 122, largoCm: 183, precio: null }),
  plancha({ material: "Acrílico espejo", codigo: "X1", activo: false }),
];
const accesorios = [
  { categoriaId: "c1", nombre: "Mixer 50ML (cánulas)", codigo: "MX1", precio: 7, activo: true },
  { categoriaId: "c1", nombre: "Adhesivo 50ML", codigo: "AD1", precio: 49, activo: true },
  { categoriaId: "c2", nombre: "Tornillo", codigo: "T1", precio: null, activo: true },
];
const categorias = [
  { id: "c2", nombre: "Tornillería", orden: 2 },
  { id: "c1", nombre: "Adhesivos", orden: 1 },
];
const datos = { planchas, accesorios, categorias };
const todo = { materiales: null, categorias: null };

describe("armarLista", () => {
  it("separa la referencia del proveedor del color", () => {
    expect(separarRef("White Moon (KP-460)")).toEqual({ color: "WHITE MOON", ref: "KP-460" });
    expect(separarRef("Blanco lechoso")).toEqual({ color: "BLANCO LECHOSO", ref: null });
  });

  it("agrupa por material, medida y espesor, y ordena por precio", () => {
    const lista = armarLista(datos, todo, CONFIG_LISTA_PRECIOS_DEFECTO, "2026-11-21");
    const [ss, eco, adh] = lista.secciones;
    expect(lista.secciones.map((s) => s.titulo)).toEqual(["Superficie sólida de acrílico", "Acrílico ECO", "Adhesivos"]);
    if (ss.tipo !== "planchas" || eco.tipo !== "planchas" || adh.tipo !== "accesorios") throw new Error("tipos");
    expect(ss.conRef).toBe(true);
    expect(eco.conRef).toBe(false);
    expect(ss.bloques.map((b) => [b.medida, b.espesor])).toEqual([
      ["0.76 × 3.68 m", "12 mm"],
      ["1.22 × 2.44 m", "6 mm"],
    ]);
    expect(ss.bloques[0].filas.map((f) => f.codigo)).toEqual(["SS001", "SS013", "SS006"]);
    // Sin precio o inactivo no entra.
    expect(eco.bloques[0].filas.map((f) => f.codigo)).toEqual(["F7E024"]);
    expect(adh.filas.map((f) => f.nombre)).toEqual(["Adhesivo 50ML", "Mixer 50ML (cánulas)"]);
  });

  it("respeta lo elegido y la configuración", () => {
    const config = leerConfigListaPrecios({
      telefonos: "266-0505",
      secciones: { "mat:Acrílico ECO": { titulo: "Acrílico económico", nota: "Termoformable\n\n10 años de garantía " } },
    });
    const lista = armarLista(datos, { materiales: ["Acrílico ECO"], categorias: [] }, config, "2026-11-21");
    expect(lista.secciones).toHaveLength(1);
    expect(lista.secciones[0].titulo).toBe("Acrílico económico");
    expect(lista.secciones[0].notas).toEqual(["Termoformable", "10 años de garantía"]);
    expect(lista.telefonos).toBe("266-0505");
    expect(lista.notaPie).toBe("Los precios incluyen IGV.");
  });

  it("une los precios iguales y formatea", () => {
    expect(tramosDePrecio([{ precio: 1 }, { precio: 2 }, { precio: 2 }, { precio: 3 }])).toEqual([[0, 1], [1, 2], [3, 1]]);
    expect(materialesConPrecio(planchas)).toEqual(["Superficie sólida de acrílico", "Acrílico ECO"]);
    expect(medidaEnMetros(122, 244)).toBe("1.22 × 2.44 m");
    expect(precioLista(1195)).toBe("1,195");
    expect(precioLista(49.5)).toBe("49.50");
    expect(notasDe(undefined)).toEqual([]);
  });

  it("lo que no se entiende de la configuración vuelve a los defectos", () => {
    expect(leerConfigListaPrecios("basura")).toEqual(CONFIG_LISTA_PRECIOS_DEFECTO);
    expect(leerConfigListaPrecios(null)).toEqual(CONFIG_LISTA_PRECIOS_DEFECTO);
  });
});

describe("generarPdfListaPrecios", () => {
  const logo = new Uint8Array(readFileSync("public/logo-plexiacril.png"));
  // Muchas filas, para que haga falta más de una hoja.
  const muchas = Array.from({ length: 140 }, (_, i) =>
    plancha({ material: "Acrílico ECO", color: `Color ñandú ${i}`, codigo: `E${i}`, espesorMm: 2 + (i % 7), anchoCm: 122, largoCm: 183, precio: 100 + (i % 3) }),
  );
  const lista = armarLista({ planchas: [...planchas, ...muchas], accesorios, categorias }, todo, leerConfigListaPrecios({ telefonos: "266-0505" }), "2026-11-21");

  for (const diseno of ["clasico", "moderno", "compacto"] as const) {
    it(`arma un PDF válido (${diseno}), con y sin logo`, async () => {
      for (const l of [logo, null]) {
        const bytes = await generarPdfListaPrecios(lista, diseno, l);
        const pdf = await PDFDocument.load(bytes);
        expect(pdf.getPageCount()).toBeGreaterThan(1);
        expect(pdf.getTitle()).toContain("Lista de precios");
      }
    });
  }
});
