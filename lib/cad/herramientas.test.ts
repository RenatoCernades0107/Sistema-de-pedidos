import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HERRAMIENTAS_CAD,
  MAX_PLANCHAS,
  NOMBRES_HERRAMIENTA,
  ejecutarHerramienta,
  type DependenciasCad,
  type PlanchaCatalogo,
} from "./herramientas";
import type { PlantillaCad, ResultadoGeneracion } from "./tipos";

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

const PLANCHAS: PlanchaCatalogo[] = [
  {
    material: "Acrílico ECO",
    variante: "Cristal",
    detalle: "",
    espesorMm: 3,
    formatos: [
      { codigo: "F7E024", anchoCm: 122, largoCm: 183 },
      { codigo: "F7E099", anchoCm: 60.5, largoCm: 91.25 },
    ],
  },
  { material: "Acrílico ECO", variante: "Blanco", detalle: "Lechoso", espesorMm: 3, formatos: [{ codigo: "F7E072", anchoCm: 122, largoCm: 183 }] },
  { material: "Acrílico ECO", variante: "Cristal", detalle: "", espesorMm: 5, formatos: [{ codigo: "F7E030", anchoCm: 122, largoCm: 244 }] },
  { material: "MDF", variante: "", detalle: "", espesorMm: 3, formatos: [{ codigo: "MDF3", anchoCm: 122, largoCm: 244 }] },
  { material: "Acrílico ECO", variante: "Colores", detalle: "Negro", espesorMm: 3, formatos: [] },
];

function dependencias(parcial: Partial<DependenciasCad> = {}) {
  return {
    listarPlantillas: vi.fn(async () => [CAJA]),
    obtenerPlantilla: vi.fn(async (codigo: string) => (codigo === "caja" ? CAJA : null)),
    generarDiseno: vi.fn(async () => generado()),
    guardarVersion: vi.fn(async () => ({ version: 4 })),
    obtenerDisenoActual: vi.fn(async () => null),
    cargarPlanchas: vi.fn(async () => PLANCHAS),
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
    expect(datos.piezas[1]).toEqual({ id: "lado", nombre: "Lado", cantidad: 2, espesor_mm: 3, ancho_mm: 200, alto_mm: 97 });
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

    expect(await total({ material: "ACRILICO" })).toBe(3);
    expect(await total({ color: "blanco lech" })).toBe(1);
    expect(await total({ espesor_mm: 3 })).toBe(3);
    expect(await total({ espesor_mm: 5 })).toBe(1);
    expect(await total({ material: "mdf", color: "cristal" })).toBe(0);
    // Sin filtros, todo lo que tiene algún formato.
    expect(await total({})).toBe(4);
    expect(await total(undefined)).toBe(4);
  });

  it("recorta los resultados y avisa de cuántos había", async () => {
    const muchas = Array.from({ length: MAX_PLANCHAS + 5 }, (_, i) => ({
      material: "Acrílico",
      variante: `Color ${i}`,
      detalle: "",
      espesorMm: 3,
      formatos: [{ codigo: `C${i}`, anchoCm: 122, largoCm: 244 }],
    }));
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
