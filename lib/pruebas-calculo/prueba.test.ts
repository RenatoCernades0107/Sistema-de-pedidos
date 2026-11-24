import { describe, expect, it } from "vitest";
import { CONFIG_CORTES_DEFECTO } from "@/lib/cortes/config";
import type { GrupoPlancha } from "@/lib/cortes/catalogo";
import { costoDiseno } from "@/lib/cad/costo";
import { acomodar, formatosDeGrupo } from "@/lib/cad/acomodo";
import type { PiezaCad, ResultadoGeneracion } from "@/lib/cad/tipos";
import type { CatalogoTerminados, ProductoEstandar } from "@/lib/terminados/catalogo";
import { compararResultados, estadoDe } from "./comparar";
import {
  armarResultado,
  casoPorDefecto,
  leerPruebasGuardadas,
  resolverCaso,
  type CasoPrueba,
  type ResultadoPrueba,
} from "./prueba";

const config = CONFIG_CORTES_DEFECTO;

const grupo = (id: string, espesorMm: number, codigo: string, activo = true): GrupoPlancha => ({
  id,
  material: "Acrílico",
  variante: "Cristal",
  detalle: "",
  espesorMm,
  rotable: true,
  sobrantesActivo: false,
  formatos: [{ id: `${id}-f`, codigo, anchoCm: 122, largoCm: 183, porVerificar: false, nota: null, activo }],
});

const grupos = [grupo("g2", 2, "PL2"), grupo("g3", 3, "PL3"), grupo("g5", 5, "PL5")];

const producto = (codigo: string, plantilla: string | null, espesores: [number, number][] = [[3, 3]]): ProductoEstandar => ({
  codigo,
  tipo: codigo.slice(0, 3),
  nombre: `Producto ${codigo}`,
  usos: null,
  aMedida: false,
  contactoAlimentario: null,
  imagenUrl: null,
  miniatura: null,
  notas: null,
  geometria: "caja_cerrada",
  activo: true,
  plantillaCad: plantilla,
  parametrosCad: plantilla ? { espesor: 3, tapa: true } : null,
  medidas: [
    { id: `${codigo}-m2`, orden: 2, m1: 40, m2: 30, m3: 20, diametro: null, altura: null, alturaMax: null, formato: null, estimado: false, nota: null },
    { id: `${codigo}-m1`, orden: 1, m1: 20, m2: 15, m3: 10, diametro: null, altura: null, alturaMax: null, formato: null, estimado: false, nota: null },
  ],
  espesores: espesores.map(([minMm, maxMm], i) => ({ id: `e${i}`, orden: i, minMm, maxMm, aplicacion: null, material: null, estimado: false, nota: null })),
  colores: [],
  opciones: [],
  materiales: [],
});

const catalogo: Pick<CatalogoTerminados, "productos" | "tipos"> = {
  tipos: [{ codigo: "CAJ", nombre: "Cajas", orden: 1, factor: 2.5 }],
  productos: [producto("CAJ-002", "caja"), producto("CAJ-001", "caja", [[5, 6]]), producto("ANF-001", "anfora")],
};

const pieza = (id: string, ancho: number, alto: number, cantidad: number): PiezaCad => ({
  id,
  nombre: id,
  cantidad,
  espesor_mm: 5,
  ancho_mm: ancho,
  alto_mm: alto,
  area_mm2: ancho * alto,
  perimetro_mm: 2 * (ancho + alto),
});

const piezasCaja = [pieza("base", 200, 150, 2), pieza("frente", 200, 100, 2), pieza("lado", 150, 100, 2)];

const generacion = (piezas = piezasCaja): ResultadoGeneracion => ({
  plantilla: "caja",
  version_plantilla: 3,
  parametros: { largo: 200, ancho: 150, alto: 100, espesor: 5, tapa: true },
  dimensiones: { x: 200, y: 150, z: 100 },
  glb_base64: "",
  piezas,
  validaciones: [],
});

const caso: CasoPrueba = {
  tipo: "caja",
  productoCodigo: "CAJ-001",
  medidaId: "CAJ-001-m1",
  grupoPlanchaId: "g5",
  texto: "",
  unidades: 1,
};

function resultado(cambios: { precios?: Record<string, number>; piezas?: PiezaCad[]; unidades?: number } = {}): ResultadoPrueba {
  const c = { ...caso, unidades: cambios.unidades ?? 1 };
  const r = resolverCaso(c, catalogo, grupos);
  if (!r.ok) throw new Error(r.error);
  return armarResultado({
    caso: c,
    resuelto: r.resuelto,
    generacion: generacion(cambios.piezas),
    catalogo: grupos,
    config,
    precios: cambios.precios ?? { PL5: 300 },
    ahora: new Date("2026-11-24T12:00:00Z"),
  });
}

describe("casoPorDefecto", () => {
  it("toma el primer producto por código, su primera medida y una plancha de espesor recomendado", () => {
    expect(casoPorDefecto("caja", catalogo, grupos)).toEqual({
      tipo: "caja",
      productoCodigo: "CAJ-001",
      medidaId: "CAJ-001-m1",
      grupoPlanchaId: "g5",
      texto: "",
      unidades: 1,
    });
  });

  it("letras y letreros llevan un texto; sin producto de la plantilla, no hay caso", () => {
    const conLetras = { productos: [producto("LET-001", "letras")] };
    expect(casoPorDefecto("letras", conLetras, grupos)?.texto).toBe("ACRILICO");
    expect(casoPorDefecto("letrero", catalogo, grupos)).toBeNull();
  });

  it("no elige planchas sin formatos activos", () => {
    const soloInactivas = [grupo("g5", 5, "PL5", false), grupo("g3", 3, "PL3")];
    expect(casoPorDefecto("caja", catalogo, soloInactivas)?.grupoPlanchaId).toBe("g3");
  });
});

describe("resolverCaso", () => {
  it("manda al motor la medida en mm y el espesor de la plancha", () => {
    const r = resolverCaso(caso, catalogo, grupos);
    expect(r.ok && r.resuelto.parametros).toEqual({ espesor: 5, tapa: true, largo: 200, ancho: 150, alto: 100 });
    expect(r.ok && r.resuelto.factor).toBe(2.5);
  });

  it("dice qué falta si el producto, la medida o la plancha ya no están", () => {
    expect(resolverCaso({ ...caso, productoCodigo: "CAJ-999" }, catalogo, grupos)).toMatchObject({ ok: false });
    expect(resolverCaso({ ...caso, medidaId: "x" }, catalogo, grupos)).toMatchObject({ ok: false });
    expect(resolverCaso({ ...caso, grupoPlanchaId: "x" }, catalogo, grupos)).toMatchObject({ ok: false });
    expect(resolverCaso({ ...caso, productoCodigo: "ANF-001" }, catalogo, grupos)).toMatchObject({ ok: false });
  });
});

describe("armarResultado", () => {
  it("da el mismo costo que la pantalla de diseño (costoDiseno sobre el mismo acomodo)", () => {
    const r = resultado();
    const g = grupos[2];
    const acomodo = acomodar(piezasCaja, formatosDeGrupo(g), {
      rotable: true,
      kerfMm: config.corte.kerfLaser * 10,
      margenMm: config.corte.margen * 10,
    });
    const esperado = costoDiseno({ piezas: piezasCaja, grupo: g, acomodo, precios: { PL5: 300 }, config })!;
    expect(r.totales?.total).toBeCloseTo(esperado.total, 2);
    expect(r.totales?.material).toBeCloseTo(esperado.material, 2);
    expect(r.totales?.costoUnidad).toBeCloseTo(esperado.total, 2);
    expect(r.totales?.sugeridoUnidad).toBeCloseTo(Math.round(esperado.total * 2.5 * 100) / 100, 2);
    expect(r.grupos[0].formato).toBe("PL5 (122 × 183 cm)");
    expect(r.entradas.precios).toEqual([{ codigo: "PL5", medida: "122 × 183 cm", precio: 300 }]);
    expect(r.problemas).toEqual([]);
  });

  it("con varias unidades, el costo por unidad es el del lote repartido", () => {
    const r = resultado({ unidades: 4 });
    expect(r.totales!.costoUnidad).toBeCloseTo(r.totales!.total / 4, 2);
  });

  it("sin precio en Odoo lo dice", () => {
    const r = resultado({ precios: {} });
    expect(r.entradas.precios[0].precio).toBeNull();
    expect(r.problemas.join(" ")).toMatch(/no tiene precio en Odoo/);
  });
});

describe("compararResultados", () => {
  it("el mismo resultado coincide, aunque se haya ejecutado en otro momento", () => {
    const a = resultado();
    const b = { ...resultado(), ejecutadoEn: "2027-01-01T00:00:00Z" };
    expect(compararResultados(a, b)).toEqual([]);
    expect(estadoDe(compararResultados(a, b))).toBe("coincide");
    expect(estadoDe(null)).toBe("sin_aprobar");
  });

  it("un precio de Odoo distinto es un cambio de datos, y arrastra el costo", () => {
    const d = compararResultados(resultado(), resultado({ precios: { PL5: 360 } }));
    expect(estadoDe(d)).toBe("cambio_datos");
    expect(d[0]).toMatchObject({ ruta: "precios.PL5", clase: "entrada", antes: "S/ 300.00", ahora: "S/ 360.00" });
    expect(d.some((x) => x.ruta === "totales.total" && x.clase === "calculo")).toBe(true);
  });

  it("una pieza distinta sin cambiar los datos es un cambio del cálculo", () => {
    const otras = piezasCaja.map((p) => (p.id === "lado" ? { ...p, perimetro_mm: p.perimetro_mm + 40 } : p));
    const d = compararResultados(resultado(), resultado({ piezas: otras }));
    expect(estadoDe(d)).toBe("cambio_calculo");
    expect(d.map((x) => x.ruta)).toContain("piezas.lado.perimetro");
  });

  it("ignora diferencias de redondeo dentro de la tolerancia", () => {
    const a = resultado();
    const b = structuredClone(a);
    b.piezas[0].perimetroMm += 0.05;
    b.totales!.total += 0.004;
    expect(compararResultados(a, b)).toEqual([]);
  });

  it("una pieza que aparece o desaparece se lista", () => {
    const d = compararResultados(resultado(), resultado({ piezas: [...piezasCaja, pieza("tapa", 50, 50, 1)] }));
    expect(d.find((x) => x.ruta === "piezas.tapa.cantidad")).toMatchObject({ antes: null, ahora: "1" });
  });
});

describe("leerPruebasGuardadas", () => {
  it("lee lo bueno e ignora lo que no sirve", () => {
    const bueno = { caso, resultado: resultado(), aprobadoEn: "2026-11-24T12:00:00Z", aprobadoPor: "Ana" };
    expect(leerPruebasGuardadas({ caja: bueno, letras: { caso: 1 }, otro: bueno })).toEqual({ caja: bueno });
    expect(leerPruebasGuardadas(null)).toEqual({});
    // El caso de otro tipo guardado bajo «letrero» no vale.
    expect(leerPruebasGuardadas({ letrero: bueno })).toEqual({});
  });
});
