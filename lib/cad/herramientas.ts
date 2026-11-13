/**
 * Las herramientas del asistente de diseños: qué le puede pedir el modelo a la
 * app, y cómo se ejecuta cada pedido.
 *
 * El modelo no dibuja: elige una plantilla del motor CAD y le da parámetros. Por
 * eso todo lo que sabe de geometría sale de aquí —las plantillas, sus
 * esquemas, las medidas resultantes, las validaciones— y nada de su memoria.
 *
 * `ejecutarHerramienta` recibe sus dependencias (el motor, la persistencia, el
 * catálogo) en vez de importarlas: así se prueba sin red ni base, y este
 * archivo no arrastra ni el cliente de Supabase ni el de Odoo. Quien las
 * conecta de verdad es `app/api/disenos/chat/route.ts`.
 *
 * Nunca lanza: lo que salga mal vuelve como resultado, para que el modelo lo
 * lea y se corrija (un 422 del motor dice qué parámetro está mal).
 *
 * Todas las medidas en milímetros. El catálogo de planchas guarda centímetros y
 * se convierte al salir.
 */

import { z } from "zod";
import { palabras } from "@/lib/busqueda-inteligente";
import type { HerramientaLlm } from "@/lib/llm/inferhub";
import type {
  ParametrosCad,
  PiezaCad,
  PlantillaCad,
  ResultadoGeneracion,
  ValidacionCad,
} from "./tipos";

/* ── Lo que necesita para trabajar ─────────────────────────────────────────── */

/** El diseño que se está editando, en su versión vigente. */
export type DisenoActual = {
  plantilla: string;
  parametros: ParametrosCad;
  version: number;
  /** De dónde vino el último cambio. */
  origen: "formulario" | "chat";
};

/** Lo que se lee de un grupo del catálogo de planchas (`lib/cortes/catalogo.ts`). */
export type PlanchaCatalogo = {
  material: string;
  variante: string;
  detalle: string;
  espesorMm: number;
  formatos: { codigo: string; anchoCm: number; largoCm: number }[];
};

export interface DependenciasCad {
  /** `lib/cad/motor.ts`. Lanzan `ErrorMotorCad`. */
  listarPlantillas(): Promise<PlantillaCad[]>;
  obtenerPlantilla(codigo: string): Promise<PlantillaCad | null>;
  generarDiseno(plantilla: string, parametros: ParametrosCad): Promise<ResultadoGeneracion>;
  /** Guarda lo generado como versión nueva del diseño de esta conversación. */
  guardarVersion(entrada: {
    plantilla: string;
    parametros: ParametrosCad;
    versionPlantilla: number;
  }): Promise<{ version: number }>;
  /** `null` si el diseño todavía no tiene ninguna versión. */
  obtenerDisenoActual(): Promise<DisenoActual | null>;
  /** Los grupos con formatos activos. */
  cargarPlanchas(): Promise<PlanchaCatalogo[]>;
}

export type ResultadoHerramienta = {
  ok: boolean;
  /** Lo que lee el modelo: JSON en texto. Nunca lleva el GLB. */
  contenido: string;
  /** Una línea para la ficha del chat. */
  resumen: string;
  /** Solo tras un `generar_diseno` que salió bien: lo que el visor tiene que mostrar. */
  diseno?: { plantilla: string; parametros: ParametrosCad };
};

/* ── Las definiciones que ve el modelo ─────────────────────────────────────── */

export const NOMBRES_HERRAMIENTA = [
  "listar_plantillas",
  "ver_plantilla",
  "generar_diseno",
  "ver_diseno_actual",
  "buscar_planchas",
] as const;

export type NombreHerramienta = (typeof NOMBRES_HERRAMIENTA)[number];

const SIN_ARGUMENTOS = { type: "object", properties: {}, additionalProperties: false };

export const HERRAMIENTAS_CAD: HerramientaLlm[] = [
  {
    nombre: "listar_plantillas",
    descripcion:
      "Lista las plantillas de producto que el motor CAD sabe construir (código, nombre, familia y descripción). " +
      "Úsala para saber qué se puede diseñar antes de proponer nada.",
    parametros: SIN_ARGUMENTOS,
  },
  {
    nombre: "ver_plantilla",
    descripcion:
      "Devuelve los parámetros de una plantilla: nombre, descripción, tipo, valor por defecto, mínimo, máximo y opciones. " +
      "Todas las medidas son en milímetros. Úsala antes de generar con una plantilla que no hayas visto en esta conversación.",
    parametros: {
      type: "object",
      properties: {
        codigo: { type: "string", description: 'El código de la plantilla, por ejemplo "caja".' },
      },
      required: ["codigo"],
      additionalProperties: false,
    },
  },
  {
    nombre: "generar_diseno",
    descripcion:
      "Genera el diseño con una plantilla y sus parámetros, lo guarda como versión nueva y lo muestra en el visor 3D. " +
      "Devuelve los parámetros ya normalizados, las dimensiones totales, el despiece y las validaciones. " +
      "Los parámetros que no envíes toman su valor por defecto. Medidas SIEMPRE en milímetros. " +
      "Si devuelve errores de parámetros, corrígelos y vuelve a llamar.",
    parametros: {
      type: "object",
      properties: {
        plantilla: { type: "string", description: "El código de la plantilla." },
        parametros: {
          type: "object",
          description:
            "Los parámetros de la plantilla, con los nombres exactos que devuelve ver_plantilla. Valores planos: número, booleano o texto.",
          additionalProperties: { type: ["number", "boolean", "string"] },
        },
      },
      required: ["plantilla", "parametros"],
      additionalProperties: false,
    },
  },
  {
    nombre: "ver_diseno_actual",
    descripcion:
      "Devuelve el diseño tal como está ahora en pantalla: plantilla, parámetros, dimensiones, despiece y validaciones. " +
      "La persona puede haberlo cambiado desde el formulario: úsala antes de modificar un diseño existente si tienes dudas de su estado.",
    parametros: SIN_ARGUMENTOS,
  },
  {
    nombre: "buscar_planchas",
    descripcion:
      "Busca en el catálogo de planchas de Plexiacril qué materiales, colores y espesores existen y en qué tamaños de plancha vienen (en milímetros). " +
      "Úsala para comprobar que un espesor o un color existe, o si una pieza cabe en una plancha. No devuelve precios ni stock.",
    parametros: {
      type: "object",
      properties: {
        material: { type: "string", description: 'Parte del nombre del material: "acrílico", "eco", "mdf".' },
        espesor_mm: { type: "number", description: "El espesor exacto, en milímetros." },
        color: { type: "string", description: 'El color o acabado: "cristal", "blanco lechoso", "negro".' },
      },
      additionalProperties: false,
    },
  },
];

/* ── Argumentos ────────────────────────────────────────────────────────────── */

const esquemaVerPlantilla = z.object({ codigo: z.string().trim().min(1).max(80) });

const esquemaGenerar = z.object({
  plantilla: z.string().trim().min(1).max(80),
  parametros: z
    .record(z.string().min(1).max(80), z.union([z.number(), z.boolean(), z.string().max(500)]))
    .default({}),
});

const esquemaBuscarPlanchas = z.object({
  material: z.string().trim().max(80).optional(),
  espesor_mm: z.number().positive().optional(),
  color: z.string().trim().max(80).optional(),
});

/* ── Apoyo ─────────────────────────────────────────────────────────────────── */

/** Hasta cuántos grupos de planchas se le devuelven al modelo de una vez. */
export const MAX_PLANCHAS = 30;

const exito = (datos: unknown, resumen: string, extra?: Pick<ResultadoHerramienta, "diseno">): ResultadoHerramienta => ({
  ok: true,
  contenido: JSON.stringify(datos),
  resumen,
  ...extra,
});

const fallo = (datos: { codigo: string; mensaje: string } & Record<string, unknown>, resumen?: string): ResultadoHerramienta => ({
  ok: false,
  contenido: JSON.stringify({ error: datos }),
  resumen: resumen ?? datos.mensaje,
});

function argumentosInvalidos(error: z.ZodError): ResultadoHerramienta {
  return fallo(
    {
      codigo: "argumentos_invalidos",
      mensaje: "Los argumentos de la herramienta no son válidos.",
      errores: error.issues.map((i) => ({ campo: i.path.join("."), mensaje: i.message })),
    },
    "Argumentos inválidos",
  );
}

/**
 * Un `ErrorMotorCad` (`lib/cad/motor.ts`), reconocido por su forma y no por
 * `instanceof`: así este archivo no importa el transporte del motor.
 */
function errorDeMotor(e: unknown): { codigo: string; estado: number; mensaje: string; errores?: { campo: string; mensaje: string }[] } | null {
  if (!(e instanceof Error)) return null;
  const m = e as Error & { codigo?: unknown; estado?: unknown; errores?: unknown };
  if (typeof m.codigo !== "string" || typeof m.estado !== "number") return null;
  const errores = Array.isArray(m.errores)
    ? m.errores.filter(
        (x): x is { campo: string; mensaje: string } =>
          !!x && typeof x.campo === "string" && typeof x.mensaje === "string",
      )
    : [];
  return { codigo: m.codigo, estado: m.estado, mensaje: m.message, ...(errores.length ? { errores } : {}) };
}

/** Cualquier fallo, como resultado para el modelo. Lo inesperado se anota en el log. */
function falloDe(e: unknown, herramienta: string): ResultadoHerramienta {
  const motor = errorDeMotor(e);
  if (motor) {
    const campos = motor.errores?.map((x) => x.campo).filter(Boolean).join(", ");
    return fallo(motor, campos ? `${motor.mensaje} (${campos})` : motor.mensaje);
  }
  console.error(`[cad] herramienta ${herramienta}`, e);
  return fallo({ codigo: "interno", mensaje: "La herramienta falló por un problema interno. No lo reintentes sin cambios." });
}

/** 200 → "200", 12.50 → "12.5". */
const num = (n: number) => String(+n.toFixed(2));

const medidas = (d: ResultadoGeneracion["dimensiones"]) => `${num(d.x)} × ${num(d.y)} × ${num(d.z)} mm`;

/** Los errores primero: son los que impiden mandar el diseño a producción. */
const ordenarValidaciones = (v: ValidacionCad[]): ValidacionCad[] =>
  [...v].sort((a, b) => Number(b.nivel === "error") - Number(a.nivel === "error"));

/** Lo que el modelo necesita de una generación. Sin `glb_base64`, a propósito. */
function resumenDeGeneracion(r: ResultadoGeneracion) {
  const validaciones = ordenarValidaciones(r.validaciones ?? []);
  const piezas: PiezaCad[] = r.piezas ?? [];
  return {
    plantilla: r.plantilla,
    version_plantilla: r.version_plantilla,
    parametros: r.parametros,
    dimensiones_mm: r.dimensiones,
    piezas: piezas.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      cantidad: p.cantidad,
      espesor_mm: p.espesor_mm,
      ancho_mm: p.ancho_mm,
      alto_mm: p.alto_mm,
    })),
    total_piezas: piezas.reduce((suma, p) => suma + p.cantidad, 0),
    validaciones,
    exportable: !validaciones.some((v) => v.nivel === "error"),
  };
}

/** Si cada palabra buscada empieza alguna palabra del texto: "blanco lech" ↔ "Blanco Lechoso". */
function coincide(texto: string, buscado: string | undefined): boolean {
  if (!buscado) return true;
  const en = palabras(texto);
  return palabras(buscado).every((b) => en.some((p) => p.startsWith(b)));
}

/* ── Cada herramienta ──────────────────────────────────────────────────────── */

async function listarPlantillas(deps: DependenciasCad): Promise<ResultadoHerramienta> {
  const plantillas = await deps.listarPlantillas();
  return exito(
    {
      plantillas: plantillas.map((p) => ({
        codigo: p.codigo,
        nombre: p.nombre,
        familia: p.familia,
        descripcion: p.descripcion,
      })),
    },
    plantillas.length === 1 ? "1 plantilla" : `${plantillas.length} plantillas`,
  );
}

async function verPlantilla(args: unknown, deps: DependenciasCad): Promise<ResultadoHerramienta> {
  const a = esquemaVerPlantilla.safeParse(args);
  if (!a.success) return argumentosInvalidos(a.error);

  const p = await deps.obtenerPlantilla(a.data.codigo);
  if (!p) {
    return fallo(
      {
        codigo: "plantilla_desconocida",
        mensaje: `No existe la plantilla "${a.data.codigo}". Usa listar_plantillas para ver las que hay.`,
      },
      `No existe la plantilla "${a.data.codigo}"`,
    );
  }
  return exito(
    {
      codigo: p.codigo,
      nombre: p.nombre,
      familia: p.familia,
      version: p.version,
      descripcion: p.descripcion,
      unidades: "mm",
      parametros: p.esquema?.properties ?? {},
      obligatorios: p.esquema?.required ?? [],
    },
    p.nombre,
  );
}

async function generarDiseno(args: unknown, deps: DependenciasCad): Promise<ResultadoHerramienta> {
  const a = esquemaGenerar.safeParse(args);
  if (!a.success) return argumentosInvalidos(a.error);

  // Si el motor rechaza los parámetros (422) no se guarda nada: el error sale
  // por `falloDe` con el detalle por campo.
  const generado = await deps.generarDiseno(a.data.plantilla, a.data.parametros);

  // Se guardan los parámetros que devuelve el motor, ya normalizados y con los
  // valores por defecto puestos: es lo que el formulario va a mostrar.
  let version: number;
  try {
    ({ version } = await deps.guardarVersion({
      plantilla: generado.plantilla,
      parametros: generado.parametros,
      versionPlantilla: generado.version_plantilla,
    }));
  } catch (e) {
    console.error("[cad] guardar versión del chat", e);
    return fallo(
      {
        codigo: "no_guardado",
        mensaje:
          "El diseño se generó pero no se pudo guardar, así que el visor no cambió. Dile a la persona que lo intente de nuevo.",
      },
      "No se pudo guardar el diseño",
    );
  }

  const resumen = resumenDeGeneracion(generado);
  const errores = resumen.validaciones.filter((v) => v.nivel === "error").length;
  return exito(
    { ...resumen, version_guardada: version },
    `${medidas(generado.dimensiones)} · versión ${version}` +
      (errores > 0 ? ` · ${errores} ${errores === 1 ? "error" : "errores"}` : ""),
    { diseno: { plantilla: generado.plantilla, parametros: generado.parametros } },
  );
}

async function verDisenoActual(deps: DependenciasCad): Promise<ResultadoHerramienta> {
  const actual = await deps.obtenerDisenoActual();
  if (!actual) {
    return exito(
      { diseno: null, mensaje: "El diseño está vacío: todavía no se ha generado nada." },
      "Diseño vacío",
    );
  }

  const base = {
    plantilla: actual.plantilla,
    version_guardada: actual.version,
    ultimo_cambio_desde: actual.origen,
  };

  // Las medidas y las validaciones no se guardan: se le vuelven a pedir al
  // motor. Si no contesta, al menos van la plantilla y los parámetros.
  try {
    const generado = await deps.generarDiseno(actual.plantilla, actual.parametros);
    return exito({ ...resumenDeGeneracion(generado), ...base }, `${medidas(generado.dimensiones)} · versión ${actual.version}`);
  } catch (e) {
    const motor = errorDeMotor(e);
    if (!motor) console.error("[cad] herramienta ver_diseno_actual", e);
    return exito(
      {
        ...base,
        parametros: actual.parametros,
        aviso: `No se pudieron recalcular medidas ni validaciones: ${motor?.mensaje ?? "el motor CAD falló"}`,
      },
      `Versión ${actual.version}`,
    );
  }
}

async function buscarPlanchas(args: unknown, deps: DependenciasCad): Promise<ResultadoHerramienta> {
  const a = esquemaBuscarPlanchas.safeParse(args ?? {});
  if (!a.success) return argumentosInvalidos(a.error);
  const { material, espesor_mm, color } = a.data;

  const grupos = (await deps.cargarPlanchas()).filter(
    (g) =>
      g.formatos.length > 0 &&
      coincide(g.material, material) &&
      coincide(`${g.variante} ${g.detalle}`, color) &&
      (espesor_mm === undefined || Math.abs(g.espesorMm - espesor_mm) < 0.01),
  );

  const planchas = grupos.slice(0, MAX_PLANCHAS).map((g) => ({
    material: g.material,
    color: [g.variante, g.detalle].filter((t) => t.trim()).join(" · "),
    espesor_mm: g.espesorMm,
    // El catálogo está en centímetros.
    formatos: g.formatos.map((f) => ({
      codigo: f.codigo,
      ancho_mm: +(f.anchoCm * 10).toFixed(1),
      largo_mm: +(f.largoCm * 10).toFixed(1),
    })),
  }));

  const datos: Record<string, unknown> = { total: grupos.length, planchas };
  if (grupos.length > MAX_PLANCHAS) {
    datos.aviso = `Hay ${grupos.length} resultados y solo se muestran ${MAX_PLANCHAS}. Afina con material, espesor_mm o color.`;
  }
  if (grupos.length === 0) {
    datos.aviso = "Ninguna plancha del catálogo coincide. Prueba con menos filtros.";
  }
  return exito(datos, grupos.length === 1 ? "1 plancha" : `${grupos.length} planchas`);
}

/* ── El ejecutor ───────────────────────────────────────────────────────────── */

/**
 * Ejecuta una herramienta pedida por el modelo. Siempre devuelve un resultado:
 * los errores (del motor, de los argumentos, internos) van dentro, para el
 * modelo.
 */
export async function ejecutarHerramienta(
  nombre: string,
  argumentos: unknown,
  deps: DependenciasCad,
): Promise<ResultadoHerramienta> {
  try {
    switch (nombre as NombreHerramienta) {
      case "listar_plantillas":
        return await listarPlantillas(deps);
      case "ver_plantilla":
        return await verPlantilla(argumentos, deps);
      case "generar_diseno":
        return await generarDiseno(argumentos, deps);
      case "ver_diseno_actual":
        return await verDisenoActual(deps);
      case "buscar_planchas":
        return await buscarPlanchas(argumentos, deps);
      default:
        return fallo(
          {
            codigo: "herramienta_desconocida",
            mensaje: `No existe la herramienta "${nombre}". Las disponibles: ${NOMBRES_HERRAMIENTA.join(", ")}.`,
          },
          "Herramienta desconocida",
        );
    }
  } catch (e) {
    return falloDe(e, nombre);
  }
}
