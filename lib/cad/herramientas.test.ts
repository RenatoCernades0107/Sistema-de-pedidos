import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HERRAMIENTAS_CAD,
  HERRAMIENTAS_LIBRE,
  MAX_INTENTOS_LIBRE,
  MAX_PLANCHAS,
  NOMBRES_HERRAMIENTA,
  NOMBRES_HERRAMIENTA_LIBRE,
  ejecutarHerramienta,
  herramientasDisponibles,
  type DependenciasCad,
  type DependenciasLibre,
  type DisenoActual,
  type PlanchaCatalogo,
} from "./herramientas";
import { CONFIG_CORTES_DEFECTO } from "@/lib/cortes/config";
import type {
  ErrorCodigoLibre,
  MaterialDiseno,
  ParametrosCad,
  PlantillaCad,
  ResultadoGeneracion,
  ResultadoLibre,
} from "./tipos";

/* ── Apoyo ─────────────────────────────────────────────────────────────────── */

const CAJA: PlantillaCad = {
  codigo: "caja",
  nombre: "Caja",
  familia: "cajas",
  version: 2,
  descripcion: "Caja rectangular de piezas planas pegadas.",
  esquema: {
    type: "object",
    properties: {
      largo: { type: "number", title: "Largo", default: 200, minimum: 20, maximum: 1200 },
      con_tapa: { type: "boolean", title: "Con tapa", default: false },
    },
    required: [],
  },
};

const GLB = "Z2xURg".repeat(500);

function generado(parcial: Partial<ResultadoGeneracion> = {}): ResultadoGeneracion {
  return {
    plantilla: "caja",
    version_plantilla: 2,
    parametros: { largo: 200, ancho: 150, alto: 100, espesor: 3, con_tapa: true },
    dimensiones: { x: 200, y: 150, z: 100 },
    glb_base64: GLB,
    piezas: [
      { id: "base", nombre: "Base", cantidad: 1, espesor_mm: 3, ancho_mm: 200, alto_mm: 150, area_mm2: 30000, perimetro_mm: 700 },
      { id: "lado", nombre: "Lado", cantidad: 2, espesor_mm: 3, ancho_mm: 200, alto_mm: 97, area_mm2: 19400, perimetro_mm: 594 },
    ],
    validaciones: [],
    ...parcial,
  };
}

/** Lo que lanza `lib/cad/motor.ts`, con su misma forma. */
class ErrorMotorFalso extends Error {
  constructor(
    mensaje: string,
    public codigo: string,
    public estado: number,
    public errores?: { campo: string; mensaje: string }[],
  ) {
    super(mensaje);
  }
}

/** Un grupo del catálogo con formatos activos y sin código compartido entre colores. */
function grupo(
  id: string,
  material: string,
  variante: string,
  detalle: string,
  espesorMm: number,
  formatos: { codigo: string; anchoCm: number; largoCm: number; skuCompartido?: boolean }[],
): PlanchaCatalogo {
  return {
    id,
    material,
    variante,
    detalle,
    espesorMm,
    rotable: true,
    sobrantesActivo: false,
    formatos: formatos.map((f) => ({
      id: `${id}-${f.codigo}`,
      codigo: f.codigo,
      anchoCm: f.anchoCm,
      largoCm: f.largoCm,
      skuCompartido: f.skuCompartido ?? false,
      porVerificar: false,
      nota: null,
      activo: true,
    })),
  };
}

const PLANCHAS: PlanchaCatalogo[] = [
  grupo("eco-cristal-3", "Acrílico ECO", "Cristal", "", 3, [
    { codigo: "F7E024", anchoCm: 122, largoCm: 183 },
    { codigo: "F7E099", anchoCm: 60.5, largoCm: 91.25 },
  ]),
  grupo("eco-blanco-3", "Acrílico ECO", "Blanco", "Lechoso", 3, [{ codigo: "F7E072", anchoCm: 122, largoCm: 183 }]),
  grupo("eco-cristal-5", "Acrílico ECO", "Cristal", "", 5, [{ codigo: "F7E030", anchoCm: 122, largoCm: 244 }]),
  grupo("mdf-3", "MDF", "", "", 3, [{ codigo: "MDF3", anchoCm: 122, largoCm: 244 }]),
  grupo("eco-negro-3", "Acrílico ECO", "Colores", "Negro", 3, []),
  grupo("eco-colores-3", "Acrílico ECO", "Varios colores", "", 3, [
    { codigo: "F7E0CC", anchoCm: 122, largoCm: 183, skuCompartido: true },
  ]),
];

function dependencias(parcial: Partial<DependenciasCad> = {}) {
  return {
    listarPlantillas: vi.fn(async () => [CAJA]),
    obtenerPlantilla: vi.fn(async (codigo: string) => (codigo === "caja" ? CAJA : null)),
    generarDiseno: vi.fn(async () => generado()),
    guardarVersion: vi.fn(async () => ({ version: 4 })),
    obtenerDisenoActual: vi.fn(async (): Promise<DisenoActual | null> => null),
    obtenerMaterial: vi.fn(async (): Promise<MaterialDiseno | null> => null),
    cargarPlanchas: vi.fn(async () => PLANCHAS),
    cargarConfigCortes: vi.fn(async () => CONFIG_CORTES_DEFECTO),
    ...parcial,
  } satisfies DependenciasCad;
}

const leer = (contenido: string) => JSON.parse(contenido);

beforeEach(() => {
  // Los fallos inesperados se anotan en el log: aquí se provocan a propósito.
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

/* ── Definiciones ──────────────────────────────────────────────────────────── */

describe("definiciones", () => {
  it("hay una por cada herramienta que el ejecutor conoce, con esquema de objeto", () => {
    expect(HERRAMIENTAS_CAD.map((h) => h.nombre).sort()).toEqual([...NOMBRES_HERRAMIENTA].sort());
    for (const h of HERRAMIENTAS_CAD) {
      expect(h.descripcion.length).toBeGreaterThan(20);
      expect(h.parametros.type).toBe("object");
    }
  });
});

/* ── Plantillas ────────────────────────────────────────────────────────────── */

describe("listar_plantillas y ver_plantilla", () => {
  it("lista sin los esquemas, que son lo que pesa", async () => {
    const r = await ejecutarHerramienta("listar_plantillas", {}, dependencias());
    expect(r.ok).toBe(true);
    expect(r.resumen).toBe("1 plantilla");
    expect(leer(r.contenido)).toEqual({
      plantillas: [
        { codigo: "caja", nombre: "Caja", familia: "cajas", descripcion: CAJA.descripcion },
      ],
    });
  });

  it("ver_plantilla devuelve el esquema de parámetros en mm", async () => {
    const deps = dependencias();
    const r = await ejecutarHerramienta("ver_plantilla", { codigo: " caja " }, deps);
    expect(deps.obtenerPlantilla).toHaveBeenCalledWith("caja");
    expect(r.ok).toBe(true);
    const datos = leer(r.contenido);
    expect(datos.unidades).toBe("mm");
    expect(datos.parametros.largo).toEqual(CAJA.esquema.properties.largo);
    expect(datos.version).toBe(2);
  });

  it("una plantilla que no existe se le dice al modelo, no se lanza", async () => {
    const r = await ejecutarHerramienta("ver_plantilla", { codigo: "barco" }, dependencias());
    expect(r.ok).toBe(false);
    expect(leer(r.contenido).error.codigo).toBe("plantilla_desconocida");
  });

  it("sin código, argumentos inválidos y no se llama al motor", async () => {
    const deps = dependencias();
    const r = await ejecutarHerramienta("ver_plantilla", {}, deps);
    expect(r.ok).toBe(false);
    expect(leer(r.contenido).error.codigo).toBe("argumentos_invalidos");
    expect(deps.obtenerPlantilla).not.toHaveBeenCalled();
  });
});

/* ── generar_diseno ────────────────────────────────────────────────────────── */

describe("generar_diseno", () => {
  it("genera, guarda lo normalizado como versión y avisa al visor", async () => {
    const deps = dependencias();
    const r = await ejecutarHerramienta(
      "generar_diseno",
      { plantilla: "caja", parametros: { largo: 200, con_tapa: true } },
      deps,
    );

    expect(deps.generarDiseno).toHaveBeenCalledWith("caja", { largo: 200, con_tapa: true });
    // Se guarda lo que devolvió el motor, no lo que mandó el modelo.
    expect(deps.guardarVersion).toHaveBeenCalledWith({
      plantilla: "caja",
      parametros: generado().parametros,
      versionPlantilla: 2,
    });

    expect(r.ok).toBe(true);
    expect(r.diseno).toEqual({ plantilla: "caja", parametros: generado().parametros });
    expect(r.resumen).toBe("200 × 150 × 100 mm · versión 4");

    const datos = leer(r.contenido);
    expect(datos.dimensiones_mm).toEqual({ x: 200, y: 150, z: 100 });
    expect(datos.version_guardada).toBe(4);
    expect(datos.total_piezas).toBe(3);
    expect(datos.piezas[1]).toEqual({
      id: "lado",
      nombre: "Lado",
      cantidad: 2,
      espesor_mm: 3,
      ancho_mm: 200,
      alto_mm: 97,
      nodos: ["lado_1", "lado_2"],
    });
    expect(datos.exportable).toBe(true);
  });

  it("NUNCA le devuelve el GLB al modelo", async () => {
    const r = await ejecutarHerramienta("generar_diseno", { plantilla: "caja", parametros: {} }, dependencias());
    expect(r.contenido).not.toContain("glb");
    expect(r.contenido).not.toContain(GLB.slice(0, 40));
    expect(r.contenido.length).toBeLessThan(2000);
    expect(JSON.stringify(r.diseno)).not.toContain(GLB.slice(0, 40));
  });

  it("pone los errores de validación delante de los avisos y lo dice en el resumen", async () => {
    const deps = dependencias({
      generarDiseno: vi.fn(async () =>
        generado({
          validaciones: [
            { nivel: "aviso", codigo: "pared_delgada", mensaje: "Pared delgada", pieza: "base" },
            { nivel: "error", codigo: "no_cabe", mensaje: "La base no cabe en ninguna plancha" },
            { nivel: "aviso", codigo: "otra", mensaje: "Otra" },
          ],
        }),
      ),
    });
    const r = await ejecutarHerramienta("generar_diseno", { plantilla: "caja", parametros: {} }, deps);

    // Se genera y se guarda igual: el visor lo tiene que mostrar con su error.
    expect(r.ok).toBe(true);
    expect(deps.guardarVersion).toHaveBeenCalled();
    const datos = leer(r.contenido);
    expect(datos.validaciones.map((v: { codigo: string }) => v.codigo)).toEqual(["no_cabe", "pared_delgada", "otra"]);
    expect(datos.exportable).toBe(false);
    expect(r.resumen).toContain("1 error");
  });

  it("un 422 del motor vuelve como resultado, con los campos, y no se guarda nada", async () => {
    const deps = dependencias({
      generarDiseno: vi.fn(async () => {
        throw new ErrorMotorFalso("Hay parámetros que no son válidos.", "parametros_invalidos", 422, [
          { campo: "largo", mensaje: "Debe ser mayor o igual que 20" },
        ]);
      }),
    });
    const r = await ejecutarHerramienta("generar_diseno", { plantilla: "caja", parametros: { largo: 2 } }, deps);

    expect(r.ok).toBe(false);
    expect(r.diseno).toBeUndefined();
    expect(deps.guardarVersion).not.toHaveBeenCalled();
    expect(leer(r.contenido).error).toEqual({
      codigo: "parametros_invalidos",
      estado: 422,
      mensaje: "Hay parámetros que no son válidos.",
      errores: [{ campo: "largo", mensaje: "Debe ser mayor o igual que 20" }],
    });
    expect(r.resumen).toContain("largo");
  });

  it("un 404 o un 500 del motor también vuelven como resultado", async () => {
    for (const [codigo, estado] of [["plantilla_desconocida", 404], ["geometria", 500]] as const) {
      const deps = dependencias({
        generarDiseno: vi.fn(async () => {
          throw new ErrorMotorFalso("Falló", codigo, estado);
        }),
      });
      const r = await ejecutarHerramienta("generar_diseno", { plantilla: "x", parametros: {} }, deps);
      expect(r.ok).toBe(false);
      expect(leer(r.contenido).error).toEqual({ codigo, estado, mensaje: "Falló" });
    }
  });

  it("si no se puede guardar, lo dice y el visor no cambia", async () => {
    const deps = dependencias({
      guardarVersion: vi.fn(async () => {
        throw new Error("permission denied for table cad_disenos");
      }),
    });
    const r = await ejecutarHerramienta("generar_diseno", { plantilla: "caja", parametros: {} }, deps);
    expect(r.ok).toBe(false);
    expect(r.diseno).toBeUndefined();
    expect(leer(r.contenido).error.codigo).toBe("no_guardado");
    // El detalle de la base no es para el modelo.
    expect(r.contenido).not.toContain("permission denied");
  });

  it("rechaza parámetros anidados y la falta de plantilla sin llamar al motor", async () => {
    const deps = dependencias();
    const anidado = await ejecutarHerramienta(
      "generar_diseno",
      { plantilla: "caja", parametros: { tapa: { alto: 10 } } },
      deps,
    );
    const sinPlantilla = await ejecutarHerramienta("generar_diseno", { parametros: {} }, deps);
    const sinNada = await ejecutarHerramienta("generar_diseno", undefined, deps);

    for (const r of [anidado, sinPlantilla, sinNada]) {
      expect(r.ok).toBe(false);
      expect(leer(r.contenido).error.codigo).toBe("argumentos_invalidos");
    }
    expect(leer(anidado.contenido).error.errores[0].campo).toBe("parametros.tapa");
    expect(deps.generarDiseno).not.toHaveBeenCalled();
  });

  it("sin parámetros genera con los valores por defecto", async () => {
    const deps = dependencias();
    const r = await ejecutarHerramienta("generar_diseno", { plantilla: "caja" }, deps);
    expect(r.ok).toBe(true);
    expect(deps.generarDiseno).toHaveBeenCalledWith("caja", {});
  });
});

/* ── ver_diseno_actual ─────────────────────────────────────────────────────── */

describe("ver_diseno_actual", () => {
  it("un diseño sin versiones está vacío, y no se llama al motor", async () => {
    const deps = dependencias();
    const r = await ejecutarHerramienta("ver_diseno_actual", {}, deps);
    expect(r.ok).toBe(true);
    expect(leer(r.contenido).diseno).toBeNull();
    expect(deps.generarDiseno).not.toHaveBeenCalled();
  });

  it("devuelve lo vigente con sus medidas, sin guardar una versión nueva", async () => {
    const deps = dependencias({
      obtenerDisenoActual: vi.fn(async () => ({
        plantilla: "caja",
        parametros: { largo: 250 },
        version: 7,
        origen: "formulario" as const,
      })),
    });
    const r = await ejecutarHerramienta("ver_diseno_actual", {}, deps);

    expect(deps.generarDiseno).toHaveBeenCalledWith("caja", { largo: 250 });
    expect(deps.guardarVersion).not.toHaveBeenCalled();
    expect(r.diseno).toBeUndefined();
    const datos = leer(r.contenido);
    expect(datos.version_guardada).toBe(7);
    expect(datos.ultimo_cambio_desde).toBe("formulario");
    expect(datos.dimensiones_mm).toEqual({ x: 200, y: 150, z: 100 });
    expect(r.contenido).not.toContain(GLB.slice(0, 40));
  });

  it("si el motor no contesta, al menos da la plantilla y los parámetros", async () => {
    const deps = dependencias({
      obtenerDisenoActual: vi.fn(async () => ({
        plantilla: "caja",
        parametros: { largo: 250 },
        version: 7,
        origen: "chat" as const,
      })),
      generarDiseno: vi.fn(async () => {
        throw new ErrorMotorFalso("No se pudo conectar con el motor CAD.", "sin_conexion", 503);
      }),
    });
    const r = await ejecutarHerramienta("ver_diseno_actual", {}, deps);
    expect(r.ok).toBe(true);
    const datos = leer(r.contenido);
    expect(datos.parametros).toEqual({ largo: 250 });
    expect(datos.aviso).toContain("No se pudo conectar");
  });
});

/* ── buscar_planchas ───────────────────────────────────────────────────────── */

describe("buscar_planchas", () => {
  it("convierte los centímetros del catálogo a milímetros", async () => {
    const r = await ejecutarHerramienta("buscar_planchas", { material: "eco", color: "cristal", espesor_mm: 3 }, dependencias());
    expect(r.ok).toBe(true);
    expect(leer(r.contenido)).toEqual({
      total: 1,
      planchas: [
        {
          material: "Acrílico ECO",
          color: "Cristal",
          espesor_mm: 3,
          formatos: [
            { codigo: "F7E024", ancho_mm: 1220, largo_mm: 1830 },
            { codigo: "F7E099", ancho_mm: 605, largo_mm: 912.5 },
          ],
        },
      ],
    });
    expect(r.resumen).toBe("1 plancha");
  });

  it("busca sin tildes ni mayúsculas, por material, color y espesor", async () => {
    const deps = dependencias();
    const total = async (args: unknown) => leer((await ejecutarHerramienta("buscar_planchas", args, deps)).contenido).total;

    expect(await total({ material: "ACRILICO" })).toBe(4);
    expect(await total({ color: "blanco lech" })).toBe(1);
    expect(await total({ espesor_mm: 3 })).toBe(4);
    expect(await total({ espesor_mm: 5 })).toBe(1);
    expect(await total({ material: "mdf", color: "cristal" })).toBe(0);
    // Sin filtros, todo lo que tiene algún formato.
    expect(await total({})).toBe(5);
    expect(await total(undefined)).toBe(5);
  });

  it("recorta los resultados y avisa de cuántos había", async () => {
    const muchas = Array.from({ length: MAX_PLANCHAS + 5 }, (_, i) =>
      grupo(`g${i}`, "Acrílico", `Color ${i}`, "", 3, [{ codigo: `C${i}`, anchoCm: 122, largoCm: 244 }]),
    );
    const r = await ejecutarHerramienta("buscar_planchas", {}, dependencias({ cargarPlanchas: vi.fn(async () => muchas) }));
    const datos = leer(r.contenido);
    expect(datos.total).toBe(MAX_PLANCHAS + 5);
    expect(datos.planchas).toHaveLength(MAX_PLANCHAS);
    expect(datos.aviso).toContain(String(MAX_PLANCHAS + 5));
  });

  it("un espesor que no es número es un argumento inválido", async () => {
    const r = await ejecutarHerramienta("buscar_planchas", { espesor_mm: "3 mm" }, dependencias());
    expect(r.ok).toBe(false);
    expect(leer(r.contenido).error.codigo).toBe("argumentos_invalidos");
  });
});

/* ── elegir_material y ver_costo ───────────────────────────────────────────── */

const CAJA_CON_ESPESOR: PlantillaCad = {
  ...CAJA,
  esquema: {
    ...CAJA.esquema,
    properties: { ...CAJA.esquema.properties, espesor: { type: "number", title: "Espesor", default: 3 } },
  },
};

const ACTUAL_CAJA: DisenoActual = {
  plantilla: "caja",
  parametros: { largo: 200, ancho: 150, alto: 100, espesor: 5, con_tapa: true },
  version: 3,
  origen: "formulario",
};

/** El motor de verdad devuelve las piezas con el espesor pedido. */
const motorConEspesor = () =>
  vi.fn(async (_plantilla: string, ps: ParametrosCad) => {
    const e = typeof ps.espesor === "number" ? ps.espesor : 3;
    const base = generado();
    return generado({
      parametros: { ...base.parametros, ...ps },
      piezas: base.piezas.map((p) => ({ ...p, espesor_mm: e })),
    });
  });

describe("elegir_material", () => {
  it("fija el espesor de la plancha, regenera y guarda la versión con material y acomodo", async () => {
    const deps = dependencias({
      obtenerDisenoActual: vi.fn(async () => ACTUAL_CAJA),
      obtenerPlantilla: vi.fn(async () => CAJA_CON_ESPESOR),
      generarDiseno: motorConEspesor(),
    });
    const r = await ejecutarHerramienta(
      "elegir_material",
      { material: "acrilico eco", color: "cristal", espesor_mm: 3 },
      deps,
    );
    expect(r.ok).toBe(true);
    expect(deps.generarDiseno).toHaveBeenCalledWith("caja", { ...ACTUAL_CAJA.parametros, espesor: 3 });

    const guardado = vi.mocked(deps.guardarVersion).mock.calls[0][0];
    expect(guardado.material).toEqual({ grupoPlanchaId: "eco-cristal-3", color: null });
    expect(guardado.parametros.espesor).toBe(3);
    expect(guardado.acomodo?.kerfMm).toBe(CONFIG_CORTES_DEFECTO.corte.kerfLaser * 10);
    expect(guardado.acomodo?.version).toBe(2);
    expect(guardado.acomodo?.grupos[0].planchas.length).toBeGreaterThan(0);

    const datos = leer(r.contenido);
    expect(datos.material).toBe("Acrílico ECO · Cristal · 3 mm");
    expect(datos.planchas).toBe(1);
    expect(datos.formato.codigo).toMatch(/^F7E0/);
    expect(typeof datos.merma_pct).toBe("number");
    expect(datos.piezas_que_no_entran).toEqual([]);
    expect(datos.problemas).toEqual([]);
    expect(datos.version_guardada).toBe(4);
    expect(r.diseno).toEqual({ plantilla: "caja", parametros: guardado.parametros, material: { grupoPlanchaId: "eco-cristal-3", color: null } });
    expect(r.resumen).toContain("1 plancha");
  });

  it("sin parámetro de espesor no lo toca y avisa si las piezas no coinciden con la plancha", async () => {
    const deps = dependencias({
      obtenerDisenoActual: vi.fn(async () => ACTUAL_CAJA),
      generarDiseno: motorConEspesor(),
    });
    const r = await ejecutarHerramienta("elegir_material", { material: "mdf", espesor_mm: 3 }, deps);
    expect(deps.generarDiseno).toHaveBeenCalledWith("caja", ACTUAL_CAJA.parametros);
    const datos = leer(r.contenido);
    expect(datos.problemas.join(" ")).toContain("5 mm");
    expect(r.resumen).toContain("espesor");
  });

  it("avisa de las piezas que no entran en ninguna plancha", async () => {
    const enorme = generado();
    enorme.piezas = [{ ...enorme.piezas[0], id: "panel", nombre: "Panel", ancho_mm: 3000, alto_mm: 2000 }];
    const deps = dependencias({
      obtenerDisenoActual: vi.fn(async () => ACTUAL_CAJA),
      generarDiseno: vi.fn(async () => enorme),
    });
    const r = await ejecutarHerramienta(
      "elegir_material",
      { material: "eco", color: "cristal", espesor_mm: 3 },
      deps,
    );
    expect(r.ok).toBe(true);
    const datos = leer(r.contenido);
    expect(datos.piezas_que_no_entran).toEqual([{ id: "panel", nombre: "Panel", copias: 1 }]);
    expect(datos.problemas.join(" ")).toContain("«Panel»");
    expect(datos.aviso).toContain("no entran");
    expect(r.resumen).toContain("no entra");
  });

  it("si el material es ambiguo devuelve las opciones y no guarda nada", async () => {
    const deps = dependencias({ obtenerDisenoActual: vi.fn(async () => ACTUAL_CAJA) });
    const r = await ejecutarHerramienta("elegir_material", { material: "acrílico", espesor_mm: 3 }, deps);
    expect(r.ok).toBe(false);
    const { error } = leer(r.contenido);
    expect(error.codigo).toBe("material_ambiguo");
    // El negro no tiene formatos: no es una opción.
    expect(error.opciones.map((o: { color: string }) => o.color)).toEqual([
      "Cristal",
      "Blanco lechoso",
      "Varios colores",
    ]);
    expect(deps.guardarVersion).not.toHaveBeenCalled();
  });

  it("un color suelto vale en el grupo de código compartido, y se guarda", async () => {
    const deps = dependencias({ obtenerDisenoActual: vi.fn(async () => ACTUAL_CAJA) });
    const r = await ejecutarHerramienta(
      "elegir_material",
      { material: "eco", color: "Rojo", espesor_mm: 3 },
      deps,
    );
    expect(r.ok).toBe(true);
    expect(vi.mocked(deps.guardarVersion).mock.calls[0][0].material).toEqual({ grupoPlanchaId: "eco-colores-3", color: "Rojo" });
  });

  it("un material que no existe o un diseño vacío se le dicen al modelo", async () => {
    const vacio = await ejecutarHerramienta("elegir_material", { material: "mdf", espesor_mm: 3 }, dependencias());
    expect(leer(vacio.contenido).error.codigo).toBe("sin_diseno");

    const deps = dependencias({ obtenerDisenoActual: vi.fn(async () => ACTUAL_CAJA) });
    const r = await ejecutarHerramienta("elegir_material", { material: "vidrio", espesor_mm: 4 }, deps);
    expect(leer(r.contenido).error.codigo).toBe("material_no_encontrado");
    expect(deps.generarDiseno).not.toHaveBeenCalled();

    const sinEspesor = await ejecutarHerramienta("elegir_material", { material: "mdf" }, deps);
    expect(leer(sinEspesor.contenido).error.codigo).toBe("argumentos_invalidos");
  });

  it("en un diseño libre, sin la persistencia con material, dice que no está disponible", async () => {
    const libreDeps = depsLibre();
    const deps = dependencias({
      obtenerDisenoActual: vi.fn(async () => ({ ...ACTUAL_CAJA, plantilla: "libre", parametros: {}, codigo: CODIGO })),
      libre: libreDeps,
    });
    const r = await ejecutarHerramienta("elegir_material", { material: "mdf", espesor_mm: 3 }, deps);
    expect(r.ok).toBe(false);
    expect(leer(r.contenido).error.codigo).toBe("material_libre_no_disponible");
    expect(libreDeps.ejecutarCodigo).not.toHaveBeenCalled();
    expect(deps.guardarVersion).not.toHaveBeenCalled();
  });

  it("en un diseño libre con la persistencia, ejecuta el código y guarda material y acomodo", async () => {
    const guardarVersionLibreConMaterial = vi.fn(async () => ({ version: 8 }));
    const deps = dependencias({
      obtenerDisenoActual: vi.fn(async () => ({ ...ACTUAL_CAJA, plantilla: "libre", parametros: {}, codigo: CODIGO })),
      libre: depsLibre({ guardarVersionLibreConMaterial }),
    });
    const r = await ejecutarHerramienta("elegir_material", { material: "mdf", espesor_mm: 3 }, deps);
    expect(r.ok).toBe(true);
    const [codigo, material, acomodo] = guardarVersionLibreConMaterial.mock.calls[0] as unknown as [
      string,
      MaterialDiseno,
      { grupos: { planchas: unknown[] }[] },
    ];
    expect(codigo).toBe(CODIGO);
    expect(material).toEqual({ grupoPlanchaId: "mdf-3", color: null });
    expect(acomodo.grupos[0].planchas).toHaveLength(1);
    expect(r.diseno).toEqual({ plantilla: "libre", parametros: {}, material: { grupoPlanchaId: "mdf-3", color: null } });
    expect(deps.generarDiseno).not.toHaveBeenCalled();
  });
});

describe("ver_costo", () => {
  const conMaterial = (parcial: Partial<DependenciasCad> = {}) =>
    dependencias({
      obtenerDisenoActual: vi.fn(async () => ({ ...ACTUAL_CAJA, parametros: { ...ACTUAL_CAJA.parametros, espesor: 3 } })),
      obtenerMaterial: vi.fn(async () => ({ grupoPlanchaId: "eco-cristal-3", color: null })),
      ...parcial,
    });

  it("sin material pide elegirlo primero", async () => {
    const deps = dependencias({ obtenerDisenoActual: vi.fn(async () => ACTUAL_CAJA) });
    const r = await ejecutarHerramienta("ver_costo", {}, deps);
    expect(r.ok).toBe(false);
    expect(leer(r.contenido).error.codigo).toBe("sin_material");
    expect(deps.generarDiseno).not.toHaveBeenCalled();
  });

  it("a Administración le da los montos", async () => {
    const cargarPrecios = vi.fn(async () => ({ F7E024: 300, F7E099: 90 }));
    const r = await ejecutarHerramienta("ver_costo", {}, conMaterial({ cargarPrecios }));
    expect(r.ok).toBe(true);
    expect(cargarPrecios).toHaveBeenCalledWith(["F7E024", "F7E099"]);
    const datos = leer(r.contenido);
    expect(datos.total).toBeGreaterThan(0);
    expect(datos.costo_material).toBeGreaterThan(0);
    expect(datos.minutos_laser).toBeGreaterThan(0);
    expect(datos.problemas).toEqual([]);
    expect(r.resumen).toMatch(/^S\/ /);
  });

  it("a los demás solo planchas y minutos, sin montos", async () => {
    const r = await ejecutarHerramienta("ver_costo", {}, conMaterial());
    expect(r.ok).toBe(true);
    const datos = leer(r.contenido);
    expect(datos.planchas).toBeGreaterThan(0);
    expect(datos.minutos_laser).toBeGreaterThan(0);
    for (const clave of ["total", "costo_material", "servicio_corte"]) expect(datos).not.toHaveProperty(clave);
    expect(datos.montos).toContain("Administración");
    // Sin precios no hay queja de precios que faltan.
    expect(datos.problemas).toEqual([]);
    expect(r.resumen).not.toContain("S/");
  });

  it("si Odoo falla, avisa y sigue", async () => {
    const r = await ejecutarHerramienta(
      "ver_costo",
      {},
      conMaterial({
        cargarPrecios: vi.fn(async () => {
          throw new Error("Odoo caído");
        }),
      }),
    );
    expect(r.ok).toBe(true);
    expect(leer(r.contenido).avisos.join(" ")).toContain("Odoo");
  });
});

/* ── El ejecutor ───────────────────────────────────────────────────────────── */

describe("ejecutarHerramienta", () => {
  it("una herramienta que no existe se le dice al modelo", async () => {
    const r = await ejecutarHerramienta("borrar_todo", {}, dependencias());
    expect(r.ok).toBe(false);
    const { error } = leer(r.contenido);
    expect(error.codigo).toBe("herramienta_desconocida");
    expect(error.mensaje).toContain("generar_diseno");
  });

  it("un fallo inesperado no se lanza ni le cuenta los detalles al modelo", async () => {
    const deps = dependencias({
      listarPlantillas: vi.fn(async () => {
        throw new Error("ECONNRESET 10.0.0.3:5432");
      }),
    });
    const r = await ejecutarHerramienta("listar_plantillas", {}, deps);
    expect(r.ok).toBe(false);
    expect(leer(r.contenido).error.codigo).toBe("interno");
    expect(r.contenido).not.toContain("ECONNRESET");
    expect(console.error).toHaveBeenCalled();
  });
});

/* ── Diseño libre ──────────────────────────────────────────────────────────── */

const CODIGO = 'from diseno import pieza, rectangulo\npiezas = [pieza("a", "A", rectangulo(10, 10), 3)]\n';

function libre(): ResultadoLibre {
  return {
    codigo: CODIGO,
    nombre: "Soporte",
    dimensiones: { x: 80, y: 100, z: 110 },
    glb_base64: GLB,
    piezas: [
      { id: "base", nombre: "Base", cantidad: 1, espesor_mm: 3, ancho_mm: 80, alto_mm: 100, area_mm2: 8000, perimetro_mm: 360 },
    ],
    validaciones: [{ nivel: "aviso", codigo: "pared_delgada", mensaje: "Fina" }],
  };
}

/** Lo que lanza `lib/cad/sandbox.ts` cuando el código falla. */
class ErrorSandboxFalso extends Error {
  codigo = "codigo_invalido";
  estado = 422;
  constructor(public errorCodigo: ErrorCodigoLibre) {
    super(errorCodigo.mensaje);
  }
}

function depsLibre(parcial: Partial<DependenciasLibre> = {}) {
  return {
    ejecutarCodigo: vi.fn(async () => libre()),
    guardarVersionLibre: vi.fn(async () => ({ version: 7 })),
    renderizarActual: vi.fn(async () => "data:image/png;base64,iVBOR"),
    listarReferencias: vi.fn(async () => [{ nombre: "plugins/build123d/skills/build123d/references/quick-reference.md", bytes: 10 }]),
    leerReferencia: vi.fn(async (n: string) => (n === "quick-reference.md" ? "# build123d" : null)),
    intentos: { n: 0 },
    ...parcial,
  } satisfies DependenciasLibre;
}

describe("diseño libre", () => {
  it("sin diseño libre activo no se ofrecen sus herramientas y no se ejecutan", async () => {
    expect(herramientasDisponibles(false)).toBe(HERRAMIENTAS_CAD);
    expect(herramientasDisponibles(true).map((h) => h.nombre)).toEqual([
      ...NOMBRES_HERRAMIENTA,
      ...NOMBRES_HERRAMIENTA_LIBRE,
    ]);
    expect(HERRAMIENTAS_LIBRE.map((h) => h.nombre).sort()).toEqual([...NOMBRES_HERRAMIENTA_LIBRE].sort());
    const r = await ejecutarHerramienta("ejecutar_build123d", { codigo: CODIGO }, dependencias());
    expect(r.ok).toBe(false);
    expect(leer(r.contenido).error.codigo).toBe("diseno_libre_no_disponible");
  });

  it("ejecuta, guarda en borrador y le pide al visor el diseño libre", async () => {
    const l = depsLibre();
    const r = await ejecutarHerramienta("ejecutar_build123d", { codigo: CODIGO }, dependencias({ libre: l }));
    expect(r.ok).toBe(true);
    expect(l.ejecutarCodigo).toHaveBeenCalledWith(CODIGO);
    expect(l.guardarVersionLibre).toHaveBeenCalledWith(CODIGO);
    expect(r.diseno).toEqual({ plantilla: "libre", parametros: {} });
    const datos = leer(r.contenido);
    expect(datos.estado).toBe("borrador");
    expect(datos.version_guardada).toBe(7);
    expect(datos.aviso).toMatch(/aprob/);
    expect(r.contenido).not.toContain(GLB);
    expect(r.resumen).toContain("borrador");
  });

  it("un error del código vuelve estructurado, con pista, y no se guarda", async () => {
    const l = depsLibre({
      ejecutarCodigo: vi.fn(async () => {
        throw new ErrorSandboxFalso({ tipo: "ejecucion", mensaje: "NameError: x", linea: 4, traza: "diseno_libre.py, línea 4" });
      }),
    });
    const r = await ejecutarHerramienta("ejecutar_build123d", { codigo: CODIGO }, dependencias({ libre: l }));
    expect(r.ok).toBe(false);
    const { error } = leer(r.contenido);
    expect(error).toMatchObject({ codigo: "codigo_invalido", tipo: "ejecucion", linea: 4, mensaje: "NameError: x" });
    expect(error.pista).toBeTruthy();
    expect(error.intentos_restantes).toBe(MAX_INTENTOS_LIBRE - 1);
    expect(l.guardarVersionLibre).not.toHaveBeenCalled();
    expect(r.resumen).toBe("Error de ejecucion (línea 4)");
  });

  it("corta tras el máximo de intentos del turno", async () => {
    const l = depsLibre({ intentos: { n: MAX_INTENTOS_LIBRE } });
    const r = await ejecutarHerramienta("ejecutar_build123d", { codigo: CODIGO }, dependencias({ libre: l }));
    expect(leer(r.contenido).error.codigo).toBe("demasiados_intentos");
    expect(l.ejecutarCodigo).not.toHaveBeenCalled();
  });

  it("ver_render devuelve la imagen aparte del texto", async () => {
    const l = depsLibre();
    const deps = dependencias({
      libre: l,
      obtenerDisenoActual: vi.fn(async () => ({ plantilla: "libre", parametros: {}, version: 7, origen: "chat" as const, codigo: CODIGO })),
    });
    const r = await ejecutarHerramienta("ver_render", {}, deps);
    expect(r.ok).toBe(true);
    expect(r.imagenes).toEqual(["data:image/png;base64,iVBOR"]);
    expect(r.contenido).not.toContain("iVBOR");
  });

  it("leer_referencia_cad lee una y, si no existe, lista las que hay", async () => {
    const deps = dependencias({ libre: depsLibre() });
    const r = await ejecutarHerramienta("leer_referencia_cad", { nombre: "quick-reference.md" }, deps);
    expect(leer(r.contenido).contenido).toBe("# build123d");
    const otra = await ejecutarHerramienta("leer_referencia_cad", { nombre: "../../etc/passwd" }, deps);
    expect(otra.ok).toBe(true);
    expect(leer(otra.contenido).referencias).toHaveLength(1);
    expect(leer(otra.contenido).aviso).toContain("No existe");
  });

  it("ver_diseno_actual de un diseño libre lo vuelve a ejecutar, sin pasar por el motor", async () => {
    const l = depsLibre();
    const deps = dependencias({
      libre: l,
      obtenerDisenoActual: vi.fn(async () => ({
        plantilla: "libre",
        parametros: {},
        version: 7,
        origen: "chat" as const,
        codigo: CODIGO,
        estado: "borrador" as const,
      })),
    });
    const r = await ejecutarHerramienta("ver_diseno_actual", {}, deps);
    expect(deps.generarDiseno).not.toHaveBeenCalled();
    expect(l.ejecutarCodigo).toHaveBeenCalledWith(CODIGO);
    const datos = leer(r.contenido);
    expect(datos).toMatchObject({ plantilla: "libre", estado: "borrador", codigo: CODIGO, dimensiones_mm: { x: 80, y: 100, z: 110 } });
  });
});

/* ── Espesor y material por copia ──────────────────────────────────────────── */

describe("espesor y material por copia", () => {
  const ACTUAL: DisenoActual = {
    plantilla: "caja",
    parametros: { largo: 200, espesor: 3, "espesor@lado_2": 5 },
    version: 3,
    origen: "formulario",
  };

  it("generar_diseno conserva los espesores propios en la misma plantilla", async () => {
    const deps = dependencias({ obtenerDisenoActual: vi.fn(async () => ACTUAL) });
    await ejecutarHerramienta("generar_diseno", { plantilla: "caja", parametros: { largo: 300 } }, deps);
    expect(deps.generarDiseno).toHaveBeenCalledWith("caja", { largo: 300, "espesor@lado_2": 5 });
  });

  it("cambiar_piezas con espesor regenera con la clave por nodo y guarda", async () => {
    const deps = dependencias({ obtenerDisenoActual: vi.fn(async () => ({ ...ACTUAL, parametros: { largo: 200 } })) });
    const r = await ejecutarHerramienta("cambiar_piezas", { nodos: ["lado_1"], espesor_mm: 6 }, deps);
    expect(r.ok).toBe(true);
    expect(deps.generarDiseno).toHaveBeenCalledWith("caja", { largo: 200, "espesor@lado_1": 6 });
    expect(deps.guardarVersion).toHaveBeenCalled();
  });

  it("cambiar_piezas con material lo guarda por copia, sin tocar el espesor", async () => {
    const deps = dependencias({
      obtenerDisenoActual: vi.fn(async () => ({ ...ACTUAL, parametros: { largo: 200 } })),
      obtenerMaterial: vi.fn(async () => ({ grupoPlanchaId: "eco-cristal-3", color: null })),
      obtenerMaterialesPorCopia: vi.fn(async () => ({})),
    });
    const r = await ejecutarHerramienta(
      "cambiar_piezas",
      { nodos: ["lado_2"], material: { material: "eco", color: "blanco lechoso" } },
      deps,
    );
    expect(r.ok).toBe(true);
    expect(deps.generarDiseno).toHaveBeenCalledWith("caja", { largo: 200 });
    const guardado = vi.mocked(deps.guardarVersion).mock.calls[0][0];
    expect(guardado.materiales).toEqual({
      lado_2: { material: "Acrílico ECO", variante: "Blanco", detalle: "Lechoso", color: null },
    });
    // Dos planchas: cristal 3 mm para la base y un lado, blanco 3 mm para el otro lado.
    expect(guardado.acomodo?.grupos.map((g) => g.grupoPlanchaId)).toEqual(["eco-cristal-3", "eco-blanco-3"]);
    expect(r.diseno?.materiales).toEqual(guardado.materiales);
  });

  it("cambiar_piezas rechaza nodos que no existen", async () => {
    const deps = dependencias({ obtenerDisenoActual: vi.fn(async () => ACTUAL) });
    const r = await ejecutarHerramienta("cambiar_piezas", { nodos: ["tapa"], espesor_mm: 4 }, deps);
    expect(r.ok).toBe(false);
    expect(leer(r.contenido).error.codigo).toBe("nodo_desconocido");
    expect(deps.guardarVersion).not.toHaveBeenCalled();
  });

  it("cambiar_piezas pide algo que cambiar", async () => {
    const r = await ejecutarHerramienta("cambiar_piezas", { nodos: ["base"] }, dependencias());
    expect(leer(r.contenido).error.codigo).toBe("nada_que_cambiar");
  });
});
