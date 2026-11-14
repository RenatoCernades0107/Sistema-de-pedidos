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
import { colorDe, espesorTexto, pideColor, type GrupoPlancha } from "@/lib/cortes/catalogo";
import type { ConfigCortes } from "@/lib/cortes/config";
import type { HerramientaLlm } from "@/lib/llm/inferhub";
import { PARAMETRO_ESPESOR, type ResultadoAcomodo } from "./acomodo";
import { costoDiseno } from "./costo";
import { conEspesor, conservarEspesores, espesoresDe, ESPESOR_MAX_MM, ESPESOR_MIN_MM } from "./espesores";
import {
  acomodoParaGuardar,
  costoPorGrupos,
  materialDeGrupo,
  nodosDe,
  nombreMaterial as nombreDeMaterialRef,
  planchasDelDiseno,
  type AcomodoGuardado,
  type MaterialesPorCopia,
  type PlanchasDelDiseno,
} from "./materiales";
import {
  PLANTILLA_LIBRE,
  type ErrorCodigoLibre,
  type EstadoDisenoLibre,
  type MaterialDiseno,
  type ParametrosCad,
  type PiezaCad,
  type PlantillaCad,
  type ResultadoGeneracion,
  type ResultadoLibre,
  type ValidacionCad,
} from "./tipos";

/* ── Lo que necesita para trabajar ─────────────────────────────────────────── */

/** El diseño que se está editando, en su versión vigente. */
export type DisenoActual = {
  plantilla: string;
  parametros: ParametrosCad;
  version: number;
  /** De dónde vino el último cambio. */
  origen: "formulario" | "chat";
  /** Solo en un diseño libre (`plantilla === "libre"`): su código y si está aprobado. */
  codigo?: string;
  estado?: EstadoDisenoLibre;
};

/** Un grupo del catálogo de planchas (`lib/cortes/catalogo.ts`), con sus formatos activos. */
export type PlanchaCatalogo = GrupoPlancha;

/** La foto del acomodo que se guarda con la versión: un acomodo por grupo de plancha y el kerf. */
export type FotoAcomodo = AcomodoGuardado;

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
    /** Sin material, la versión hereda el de la anterior. */
    material?: MaterialDiseno;
    acomodo?: FotoAcomodo | null;
    /** El material propio de cada copia. Con `material`, conviene pasarlo siempre (si no, se pierde). */
    materiales?: MaterialesPorCopia | null;
  }): Promise<{ version: number }>;
  /** `null` si el diseño todavía no tiene ninguna versión. */
  obtenerDisenoActual(): Promise<DisenoActual | null>;
  /** El material de la versión vigente. `null` si no tiene. */
  obtenerMaterial(): Promise<MaterialDiseno | null>;
  /** El material propio de cada copia en la versión vigente. Sin ella, ninguno. */
  obtenerMaterialesPorCopia?(): Promise<MaterialesPorCopia>;
  /** Los grupos con formatos activos. */
  cargarPlanchas(): Promise<PlanchaCatalogo[]>;
  /** La configuración de cortes (kerf y margen en cm, láser, cobro). */
  cargarConfigCortes(): Promise<ConfigCortes>;
  /**
   * El precio en Odoo de cada código de plancha. Solo si quien chatea es
   * Administración: sin ella, `ver_costo` no da montos.
   */
  cargarPrecios?(codigos: string[]): Promise<Record<string, number>>;
  /** Solo si el diseño libre está activo (`CAD_DISENO_LIBRE=1` y sandbox configurado). */
  libre?: DependenciasLibre;
}

/** Diseño libre: el sandbox (`lib/cad/sandbox.ts`) y la persistencia de versiones libres. */
export interface DependenciasLibre {
  /** Lanza un error con `errorCodigo` si el código falla (lo que lanza `ErrorSandboxCad`). */
  ejecutarCodigo(codigo: string): Promise<ResultadoLibre>;
  /** Guarda el código como versión nueva en borrador. */
  guardarVersionLibre(codigo: string): Promise<{ version: number }>;
  /**
   * Guarda el mismo código como versión nueva con material y acomodo. Sin ella,
   * `elegir_material` no está disponible para diseños libres.
   */
  guardarVersionLibreConMaterial?(
    codigo: string,
    material: MaterialDiseno | null,
    acomodo: FotoAcomodo | null,
    materiales?: MaterialesPorCopia | null,
  ): Promise<{ version: number }>;
  /** El render 2×2 del diseño vigente (libre o de plantilla), como `data:` URL. */
  renderizarActual(): Promise<string>;
  listarReferencias(): Promise<{ nombre: string; bytes: number }[]>;
  leerReferencia(nombre: string): Promise<string | null>;
  /** Cuántas veces se ejecutó código en este turno; lo lleva quien arma las dependencias. */
  intentos: { n: number };
}

/** Cuántas ejecuciones de código se permiten en un turno. */
export const MAX_INTENTOS_LIBRE = 6;

/** Hasta cuántos caracteres de una referencia se le devuelven al modelo. */
export const MAX_REFERENCIA = 30_000;

export type ResultadoHerramienta = {
  ok: boolean;
  /** Lo que lee el modelo: JSON en texto. Nunca lleva el GLB. */
  contenido: string;
  /** Una línea para la ficha del chat. */
  resumen: string;
  /** Solo tras un `generar_diseno` que salió bien: lo que el visor tiene que mostrar. */
  /** Lo que el visor tiene que mostrar. Con `material`, también las pestañas Planchas y Costo. */
  diseno?: {
    plantilla: string;
    parametros: ParametrosCad;
    material?: MaterialDiseno;
    /** El material propio de cada copia, si cambió. */
    materiales?: MaterialesPorCopia;
  };
  /** Imágenes (`data:` URL) para que el modelo las mire: el render de `ver_render`. */
  imagenes?: string[];
};

/* ── Las definiciones que ve el modelo ─────────────────────────────────────── */

export const NOMBRES_HERRAMIENTA = [
  "listar_plantillas",
  "ver_plantilla",
  "generar_diseno",
  "ver_diseno_actual",
  "buscar_planchas",
  "elegir_material",
  "cambiar_piezas",
  "ver_costo",
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
  {
    nombre: "elegir_material",
    descripcion:
      "Elige la plancha del catálogo con la que se cortará el diseño actual. Si la plantilla tiene parámetro de espesor, lo pone al de la plancha y regenera. " +
      "Guarda una versión nueva con el material y devuelve cómo se acomodan las piezas: cuántas planchas y de qué formato, la merma, " +
      "las piezas que no entran y los problemas de espesor. Si el material es ambiguo o no existe, devuelve las opciones.",
    parametros: {
      type: "object",
      properties: {
        material: { type: "string", description: 'El material: "acrílico eco", "mdf".' },
        color: { type: "string", description: 'El color o acabado: "cristal", "blanco lechoso". Omítelo si el material no tiene colores.' },
        espesor_mm: { type: "number", description: "El espesor de la plancha, en milímetros." },
      },
      required: ["material", "espesor_mm"],
      additionalProperties: false,
    },
  },
  {
    nombre: "cambiar_piezas",
    descripcion:
      "Cambia el espesor y/o el material de copias concretas de piezas, sin tocar las demás: por ejemplo, la base de 5 mm o un lateral rojo. " +
      "Espesor y material son independientes: cambia solo lo que se pida. Las copias se nombran por su nodo (`nodos` en el despiece, " +
      "o el `nodo` de una cara señalada): `base`, `lateral_1`, `lateral_2`. El espesor regenera el diseño (la copia crece hacia fuera; " +
      "las uniones con las piezas vecinas no se reajustan). El material es material y color sin espesor: la plancha sale del catálogo " +
      "con ese material y el espesor de la pieza. Con null, la copia vuelve al espesor o al material del diseño. Guarda una versión nueva.",
    parametros: {
      type: "object",
      properties: {
        nodos: {
          type: "array",
          items: { type: "string" },
          description: 'Los nodos de las copias a cambiar, p. ej. ["lateral_2"] o ["lateral_1", "lateral_2"].',
        },
        espesor_mm: {
          type: ["number", "null"],
          description: "El espesor nuevo, en mm (1 a 30). null: el del diseño. Omítelo para no cambiarlo.",
        },
        material: {
          type: ["object", "null"],
          description: "El material nuevo (sin espesor). null: el del diseño. Omítelo para no cambiarlo.",
          properties: {
            material: { type: "string", description: 'El material: "acrílico eco".' },
            color: { type: "string", description: 'El color o acabado: "rojo", "cristal".' },
          },
          required: ["material"],
          additionalProperties: false,
        },
      },
      required: ["nodos"],
      additionalProperties: false,
    },
  },
  {
    nombre: "ver_costo",
    descripcion:
      "Calcula lo que cuesta fabricar el diseño actual en el material elegido: planchas, minutos de láser y, solo si quien pregunta es Administración, " +
      "los montos de material, servicio de corte y total. No es el precio al cliente (no incluye plegado, pegado ni armado). " +
      "Necesita que el diseño tenga material (elegir_material).",
    parametros: SIN_ARGUMENTOS,
  },
];

/** Las herramientas del diseño libre: solo se ofrecen con el diseño libre activo. */
export const NOMBRES_HERRAMIENTA_LIBRE = ["leer_referencia_cad", "ejecutar_build123d", "ver_render"] as const;

export type NombreHerramientaLibre = (typeof NOMBRES_HERRAMIENTA_LIBRE)[number];

export const HERRAMIENTAS_LIBRE: HerramientaLlm[] = [
  {
    nombre: "leer_referencia_cad",
    descripcion:
      "Lee un archivo de referencia de build123d (guías y ejemplos). Sin nombre, o con un nombre que no existe, devuelve la lista. " +
      'Útiles: "quick-reference.md", "advanced-patterns.md", "SKILL.md". Úsala solo para diseño libre, cuando dudes de la API.',
    parametros: {
      type: "object",
      properties: { nombre: { type: "string", description: 'Ruta o nombre del archivo, p. ej. "quick-reference.md".' } },
      additionalProperties: false,
    },
  },
  {
    nombre: "ejecutar_build123d",
    descripcion:
      "Diseño libre (solo si ninguna plantilla sirve): ejecuta código Python build123d en el sandbox. El código DEBE asignar " +
      "`piezas = [pieza(...), ...]` con las ayudas de `from diseno import ...`. Si funciona, lo guarda como versión nueva EN BORRADOR, " +
      "lo muestra en el visor y devuelve medidas, despiece y validaciones. Si falla, devuelve el error (tipo, línea, traza) para corregirlo.",
    parametros: {
      type: "object",
      properties: { codigo: { type: "string", description: "El programa completo, en Python." } },
      required: ["codigo"],
      additionalProperties: false,
    },
  },
  {
    nombre: "ver_render",
    descripcion:
      "Devuelve una imagen del diseño vigente con cuatro vistas (isométrica, frente, planta, lateral) para comprobar que se ve como se pidió.",
    parametros: SIN_ARGUMENTOS,
  },
];

/** Las herramientas que se le ofrecen al modelo en este turno. */
export const herramientasDisponibles = (libreActivo: boolean): HerramientaLlm[] =>
  libreActivo ? [...HERRAMIENTAS_CAD, ...HERRAMIENTAS_LIBRE] : HERRAMIENTAS_CAD;

/* ── Argumentos ────────────────────────────────────────────────────────────── */

const esquemaVerPlantilla = z.object({ codigo: z.string().trim().min(1).max(80) });

const esquemaGenerar = z.object({
  plantilla: z.string().trim().min(1).max(80),
  parametros: z
    .record(z.string().min(1).max(80), z.union([z.number(), z.boolean(), z.string().max(500)]))
    .default({}),
});

const esquemaReferencia = z.object({ nombre: z.string().trim().max(300).optional() });

const esquemaCodigo = z.object({ codigo: z.string().min(1).max(60_000) });

const esquemaBuscarPlanchas = z.object({
  material: z.string().trim().max(80).optional(),
  espesor_mm: z.number().positive().optional(),
  color: z.string().trim().max(80).optional(),
});

const esquemaElegirMaterial = z.object({
  material: z.string().trim().min(1).max(80),
  color: z.string().trim().max(80).optional(),
  espesor_mm: z.number().positive(),
});

const esquemaCambiarPiezas = z.object({
  nodos: z.array(z.string().trim().regex(/^[a-z0-9_]{1,56}$/)).min(1).max(200),
  espesor_mm: z.number().min(ESPESOR_MIN_MM).max(ESPESOR_MAX_MM).nullable().optional(),
  material: z
    .object({ material: z.string().trim().min(1).max(80), color: z.string().trim().max(80).optional() })
    .nullable()
    .optional(),
});

/* ── Apoyo ─────────────────────────────────────────────────────────────────── */

/** Hasta cuántos grupos de planchas se le devuelven al modelo de una vez. */
export const MAX_PLANCHAS = 30;

const exito = (
  datos: unknown,
  resumen: string,
  extra?: Pick<ResultadoHerramienta, "diseno" | "imagenes">,
): ResultadoHerramienta => ({
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
      // Con ellos se le cambia espesor o material a una copia (cambiar_piezas).
      nodos: nodosDe(p),
    })),
    ...(Object.keys(espesoresDe(r.parametros)).length
      ? { espesores_por_copia_mm: espesoresDe(r.parametros) }
      : {}),
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

  // Los espesores elegidos copia por copia se conservan si se sigue en la misma
  // plantilla: el modelo suele mandar solo los parámetros de la plantilla.
  const actual = await deps.obtenerDisenoActual().catch(() => null);
  const parametros =
    actual && actual.plantilla === a.data.plantilla
      ? conservarEspesores(a.data.parametros, actual.parametros)
      : a.data.parametros;

  // Si el motor rechaza los parámetros (422) no se guarda nada: el error sale
  // por `falloDe` con el detalle por campo.
  const generado = await deps.generarDiseno(a.data.plantilla, parametros);

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

  if (actual.plantilla === PLANTILLA_LIBRE) return verDisenoLibreActual(actual, base, deps);

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

/* ── Material y costo ──────────────────────────────────────────────────────── */

/** Hasta cuántas opciones se devuelven cuando el material es ambiguo. */
const MAX_OPCIONES_MATERIAL = 15;

const textoColor = (g: Pick<GrupoPlancha, "variante" | "detalle">) => `${g.variante} ${g.detalle}`;

/** Si el texto dice exactamente lo buscado, sin tildes, mayúsculas ni separadores. */
const igual = (texto: string, buscado: string) => palabras(texto).join(" ") === palabras(buscado).join(" ");

/** De varios candidatos, los que coinciden exactamente; si ninguno, todos. */
function exactos<T>(candidatos: T[], texto: (c: T) => string, buscado: string | undefined): T[] {
  if (!buscado || candidatos.length < 2) return candidatos;
  const iguales = candidatos.filter((c) => igual(texto(c), buscado));
  return iguales.length > 0 ? iguales : candidatos;
}

/**
 * El grupo del catálogo que nombra la persona. Un color que no es el de ningún
 * grupo vale si el único grupo de ese material y espesor tiene el código
 * compartido entre colores (`pideColor`): ahí el color se guarda aparte.
 */
function resolverGrupo(
  catalogo: PlanchaCatalogo[],
  pedido: { material: string; color?: string; espesor_mm?: number },
): { grupo: PlanchaCatalogo; color: string | null } | { candidatos: PlanchaCatalogo[] } {
  const color = pedido.color?.trim() || undefined;
  const base = catalogo.filter(
    (g) =>
      g.formatos.length > 0 &&
      coincide(g.material, pedido.material) &&
      (pedido.espesor_mm === undefined || Math.abs(g.espesorMm - pedido.espesor_mm) < 0.01),
  );

  let candidatos = color ? base.filter((g) => coincide(textoColor(g), color)) : base;
  if (color && candidatos.length === 0) {
    const compartidos = base.filter(pideColor);
    if (compartidos.length === 1) return { grupo: compartidos[0], color };
    return { candidatos: compartidos.length > 0 ? compartidos : base };
  }
  candidatos = exactos(candidatos, textoColor, color);
  candidatos = exactos(candidatos, (g) => g.material, pedido.material);
  if (candidatos.length !== 1) return { candidatos };
  const grupo = candidatos[0];
  return { grupo, color: color && pideColor(grupo) ? color : null };
}

const opcionDeGrupo = (g: PlanchaCatalogo) => ({
  material: g.material,
  color: colorDe(g),
  espesor_mm: g.espesorMm,
});

const nombreMaterial = (g: PlanchaCatalogo, color: string | null) =>
  `${g.material} · ${color ?? colorDe(g)} · ${espesorTexto(g.espesorMm)}`;

/** El kerf y el margen de la configuración de cortes, de cm a mm. */
const corteDe = (config: ConfigCortes) => ({
  kerfMm: config.corte.kerfLaser * 10,
  margenMm: config.corte.margen * 10,
});

/** El formato de un acomodo, en mm. */
function formatoDe(grupo: PlanchaCatalogo, acomodo: ResultadoAcomodo | null) {
  const f = acomodo ? grupo.formatos.find((x) => x.id === acomodo.formatoId) : undefined;
  return f ? { codigo: f.codigo, ancho_mm: +(f.anchoCm * 10).toFixed(1), largo_mm: +(f.largoCm * 10).toFixed(1) } : null;
}

/** Las copias que no entran en el formato elegido, por pieza. */
function piezasFueraDe(acomodo: ResultadoAcomodo | null, piezas: PiezaCad[]) {
  const porId = new Map<string, number>();
  for (const c of acomodo?.noCaben ?? []) porId.set(c.id, (porId.get(c.id) ?? 0) + 1);
  return [...porId].map(([id, copias]) => ({
    id,
    nombre: piezas.find((p) => p.id === id)?.nombre ?? id,
    copias,
  }));
}

/** El resumen del acomodo para el modelo y su línea para la ficha. */
function resumenDeAcomodo(planchas: PlanchasDelDiseno, piezas: PiezaCad[]) {
  const grupos = planchas.grupos.map((g) => {
    const a = g.acomodo;
    const formato = formatoDe(g.grupo, a);
    return {
      material: g.etiqueta,
      copias: g.copias,
      planchas: a?.planchas.length ?? 0,
      formato,
      merma_pct: a ? +a.mermaPct.toFixed(1) : null,
      piezas_que_no_entran: piezasFueraDe(a, piezas),
    };
  });
  const fuera = grupos.flatMap((g) => g.piezas_que_no_entran);
  const datos = {
    ...(grupos.length === 1 ? grupos[0] : { planchas_por_material: grupos }),
    piezas_que_no_entran: fuera,
    problemas: planchas.problemas,
  };
  const partes = grupos.map((g) =>
    g.formato
      ? `${g.material}: ${g.planchas} ${g.planchas === 1 ? "plancha" : "planchas"} ${num(g.formato.ancho_mm / 10)}×${num(g.formato.largo_mm / 10)} cm, merma ${num(+(g.merma_pct ?? 0).toFixed(0))} %`
      : g.material,
  );
  const copiasFuera = fuera.reduce((s, f) => s + f.copias, 0);
  if (copiasFuera > 0) partes.push(`${copiasFuera} ${copiasFuera === 1 ? "pieza no entra" : "piezas no entran"}`);
  else if (planchas.problemas.length > 0) partes.push("revisar material y espesor");
  return { datos, resumen: partes.join(" · ") };
}

/** Los grupos de plancha del diseño con el material del diseño y los de cada copia. */
async function planchasDe(
  deps: DependenciasCad,
  catalogo: PlanchaCatalogo[],
  material: MaterialDiseno | null,
  parametros: ParametrosCad,
  piezas: PiezaCad[],
  corte: { kerfMm: number; margenMm: number },
  porCopia?: MaterialesPorCopia,
) {
  const materiales = porCopia ?? (await deps.obtenerMaterialesPorCopia?.()) ?? {};
  return {
    materiales,
    planchas: planchasDelDiseno({ catalogo, porDefecto: material, porCopia: materiales, parametros, piezas, corte }),
  };
}

const AVISO_PIEZAS_FUERA =
  "Hay piezas que no entran en ninguna plancha de este material: díselo a la persona y propón achicarlas, dividirlas u otro material.";

function sinDiseno(): ResultadoHerramienta {
  return fallo(
    { codigo: "sin_diseno", mensaje: "Todavía no hay un diseño. Genera uno antes de elegir material o calcular el costo." },
    "Diseño vacío",
  );
}

async function elegirMaterial(args: unknown, deps: DependenciasCad): Promise<ResultadoHerramienta> {
  const a = esquemaElegirMaterial.safeParse(args);
  if (!a.success) return argumentosInvalidos(a.error);

  const actual = await deps.obtenerDisenoActual();
  if (!actual) return sinDiseno();

  const elegido = resolverGrupo(await deps.cargarPlanchas(), a.data);
  if ("candidatos" in elegido) {
    const { candidatos } = elegido;
    return fallo(
      {
        codigo: candidatos.length === 0 ? "material_no_encontrado" : "material_ambiguo",
        mensaje:
          candidatos.length === 0
            ? "Ninguna plancha del catálogo coincide con ese material y espesor. Busca con buscar_planchas y pregunta a la persona."
            : "Hay varias planchas que coinciden: pregunta a la persona cuál, o vuelve a llamar con el color exacto.",
        opciones: candidatos.slice(0, MAX_OPCIONES_MATERIAL).map(opcionDeGrupo),
      },
      candidatos.length === 0 ? "Material no encontrado" : `${candidatos.length} materiales posibles`,
    );
  }
  const { grupo, color } = elegido;
  const material: MaterialDiseno = { grupoPlanchaId: grupo.id, color };
  const corte = corteDe(await deps.cargarConfigCortes());
  const catalogo = await deps.cargarPlanchas();

  if (actual.plantilla === PLANTILLA_LIBRE) return elegirMaterialLibre(actual, catalogo, material, corte, deps);

  // Elegir la plancha es también elegir el espesor, si la plantilla lo tiene.
  const plantilla = await deps.obtenerPlantilla(actual.plantilla);
  const conEspesor = plantilla?.esquema?.properties?.[PARAMETRO_ESPESOR]?.type === "number";
  const generado = await deps.generarDiseno(
    actual.plantilla,
    conEspesor ? { ...actual.parametros, [PARAMETRO_ESPESOR]: grupo.espesorMm } : actual.parametros,
  );
  const piezas = generado.piezas ?? [];
  const { planchas, materiales } = await planchasDe(deps, catalogo, material, generado.parametros, piezas, corte);

  let version: number;
  try {
    ({ version } = await deps.guardarVersion({
      plantilla: generado.plantilla,
      parametros: generado.parametros,
      versionPlantilla: generado.version_plantilla,
      material,
      acomodo: acomodoParaGuardar(planchas.grupos, corte.kerfMm),
      materiales,
    }));
  } catch (e) {
    console.error("[cad] guardar material del chat", e);
    return fallo(
      { codigo: "no_guardado", mensaje: "No se pudo guardar el material. Dile a la persona que lo intente de nuevo." },
      "No se pudo guardar el material",
    );
  }

  const { datos, resumen } = resumenDeAcomodo(planchas, piezas);
  return exito(
    {
      ...datos,
      version_guardada: version,
      ...(conEspesor ? { espesor_aplicado_mm: grupo.espesorMm, dimensiones_mm: generado.dimensiones } : {}),
      ...(datos.piezas_que_no_entran.length > 0 ? { aviso: AVISO_PIEZAS_FUERA } : {}),
    },
    `${resumen} · versión ${version}`,
    { diseno: { plantilla: generado.plantilla, parametros: generado.parametros, material } },
  );
}

async function elegirMaterialLibre(
  actual: DisenoActual,
  catalogo: PlanchaCatalogo[],
  material: MaterialDiseno,
  corte: { kerfMm: number; margenMm: number },
  deps: DependenciasCad,
): Promise<ResultadoHerramienta> {
  const guardar = deps.libre?.guardarVersionLibreConMaterial;
  if (!deps.libre || !guardar || !actual.codigo) {
    return fallo(
      {
        codigo: "material_libre_no_disponible",
        mensaje:
          "Todavía no se puede elegir el material de un diseño personalizado desde el chat. Dile a la persona que lo elija en la pestaña Planchas.",
      },
      "No disponible en diseño personalizado",
    );
  }

  const r = await deps.libre.ejecutarCodigo(actual.codigo);
  const piezas = r.piezas ?? [];
  // En un diseño libre el espesor lo fija el código: cada pieza busca la plancha de su espesor.
  const { planchas, materiales } = await planchasDe(deps, catalogo, material, {}, piezas, corte);

  let version: number;
  try {
    ({ version } = await guardar(actual.codigo, material, acomodoParaGuardar(planchas.grupos, corte.kerfMm), materiales));
  } catch (e) {
    console.error("[cad] guardar material libre del chat", e);
    return fallo(
      { codigo: "no_guardado", mensaje: "No se pudo guardar el material. Dile a la persona que lo intente de nuevo." },
      "No se pudo guardar el material",
    );
  }

  const { datos, resumen } = resumenDeAcomodo(planchas, piezas);
  const estado = actual.estado ?? "borrador";
  return exito(
    {
      ...datos,
      version_guardada: version,
      // El código no cambió: la versión nueva conserva la aprobación que tuviera.
      estado,
      ...(datos.piezas_que_no_entran.length > 0 ? { aviso: AVISO_PIEZAS_FUERA } : {}),
      nota: "En un diseño personalizado el espesor lo fija el código: si no coincide con la plancha, corrige el código.",
    },
    `${resumen} · versión ${version}${estado === "borrador" ? " · borrador" : ""}`,
    { diseno: { plantilla: PLANTILLA_LIBRE, parametros: {}, material } },
  );
}

/**
 * El material (sin espesor) que se pide: el de un grupo si solo uno coincide, o
 * el de varios grupos que solo difieren en el espesor.
 */
function resolverMaterial(
  catalogo: PlanchaCatalogo[],
  pedido: { material: string; color?: string },
): { ref: ReturnType<typeof materialDeGrupo> } | { candidatos: PlanchaCatalogo[] } {
  const r = resolverGrupo(catalogo, pedido);
  if ("grupo" in r) return { ref: materialDeGrupo(r.grupo, r.color) };
  const distintos = new Map<string, PlanchaCatalogo>();
  for (const g of r.candidatos) distintos.set(`${g.material}|${g.variante}|${g.detalle}`.toLowerCase(), g);
  if (distintos.size !== 1) return { candidatos: [...distintos.values()] };
  const g = [...distintos.values()][0];
  const color = pedido.color?.trim() && pideColor(g) ? pedido.color.trim() : null;
  return { ref: materialDeGrupo(g, color) };
}

async function cambiarPiezas(args: unknown, deps: DependenciasCad): Promise<ResultadoHerramienta> {
  const a = esquemaCambiarPiezas.safeParse(args);
  if (!a.success) return argumentosInvalidos(a.error);
  const { nodos, espesor_mm, material: pedidoMaterial } = a.data;
  if (espesor_mm === undefined && pedidoMaterial === undefined) {
    return fallo(
      { codigo: "nada_que_cambiar", mensaje: "Indica espesor_mm, material o los dos." },
      "Nada que cambiar",
    );
  }

  const actual = await deps.obtenerDisenoActual();
  if (!actual) return sinDiseno();
  const libre = actual.plantilla === PLANTILLA_LIBRE;
  if (libre && espesor_mm !== undefined) {
    return fallo(
      {
        codigo: "espesor_libre",
        mensaje:
          "En un diseño personalizado el espesor de cada pieza lo fija el código: cámbialo en el código con ejecutar_build123d.",
      },
      "Espesor en diseño personalizado",
    );
  }

  const catalogo = await deps.cargarPlanchas();
  let ref: ReturnType<typeof materialDeGrupo> | null | undefined = undefined;
  if (pedidoMaterial === null) ref = null;
  else if (pedidoMaterial) {
    const r = resolverMaterial(catalogo, pedidoMaterial);
    if ("candidatos" in r) {
      return fallo(
        {
          codigo: r.candidatos.length === 0 ? "material_no_encontrado" : "material_ambiguo",
          mensaje:
            r.candidatos.length === 0
              ? "Ningún material del catálogo coincide. Busca con buscar_planchas y pregunta a la persona."
              : "Hay varios materiales que coinciden: pregunta a la persona cuál, o vuelve a llamar con el color exacto.",
          opciones: r.candidatos.slice(0, MAX_OPCIONES_MATERIAL).map(opcionDeGrupo),
        },
        r.candidatos.length === 0 ? "Material no encontrado" : `${r.candidatos.length} materiales posibles`,
      );
    }
    ref = r.ref;
  }

  // La geometría: con espesor nuevo se regenera; si no, la de ahora.
  let piezas: PiezaCad[];
  let generado: ResultadoGeneracion | null = null;
  if (libre) {
    if (!deps.libre || !actual.codigo) return sinLibre("cambiar_piezas");
    piezas = (await deps.libre.ejecutarCodigo(actual.codigo)).piezas ?? [];
  } else {
    const parametros = espesor_mm !== undefined ? conEspesor(actual.parametros, nodos, espesor_mm) : actual.parametros;
    generado = await deps.generarDiseno(actual.plantilla, parametros);
    piezas = generado.piezas ?? [];
  }

  const existentes = new Set(piezas.flatMap(nodosDe));
  const desconocidos = nodos.filter((n) => !existentes.has(n));
  if (desconocidos.length > 0) {
    return fallo(
      {
        codigo: "nodo_desconocido",
        mensaje: `No hay copias llamadas ${desconocidos.join(", ")}. Usa los nodos del despiece (ver_diseno_actual).`,
        nodos: [...existentes],
      },
      "Pieza no encontrada",
    );
  }

  const materiales: MaterialesPorCopia = { ...((await deps.obtenerMaterialesPorCopia?.()) ?? {}) };
  if (ref !== undefined) {
    for (const nodo of nodos) {
      if (ref) materiales[nodo] = ref;
      else delete materiales[nodo];
    }
  }
  for (const nodo of Object.keys(materiales)) if (!existentes.has(nodo)) delete materiales[nodo];

  const material = await deps.obtenerMaterial();
  const config = await deps.cargarConfigCortes();
  const corte = corteDe(config);
  const { planchas } = await planchasDe(
    deps,
    catalogo,
    material,
    generado?.parametros ?? {},
    piezas,
    corte,
    materiales,
  );
  const acomodo = acomodoParaGuardar(planchas.grupos, corte.kerfMm);

  let version: number;
  try {
    if (libre) {
      const guardar = deps.libre?.guardarVersionLibreConMaterial;
      if (!guardar || !actual.codigo) {
        return fallo(
          {
            codigo: "material_libre_no_disponible",
            mensaje: "Todavía no se puede cambiar el material desde el chat en un diseño personalizado. Que lo cambie en el visor.",
          },
          "No disponible en diseño personalizado",
        );
      }
      ({ version } = await guardar(actual.codigo, material, acomodo, materiales));
    } else {
      ({ version } = await deps.guardarVersion({
        plantilla: generado!.plantilla,
        parametros: generado!.parametros,
        versionPlantilla: generado!.version_plantilla,
        ...(material ? { material } : {}),
        acomodo,
        materiales,
      }));
    }
  } catch (e) {
    console.error("[cad] guardar cambio de piezas del chat", e);
    return fallo(
      { codigo: "no_guardado", mensaje: "No se pudo guardar el cambio. Dile a la persona que lo intente de nuevo." },
      "No se pudo guardar",
    );
  }

  const cambios = [
    ...(espesor_mm !== undefined ? [espesor_mm === null ? "espesor del diseño" : espesorTexto(espesor_mm)] : []),
    ...(ref !== undefined ? [ref === null ? "material del diseño" : nombreDeMaterialRef(ref)] : []),
  ];
  const acomodado = material || Object.keys(materiales).length ? resumenDeAcomodo(planchas, piezas) : null;
  const datos = {
    ...(generado ? resumenDeGeneracion(generado) : {}),
    copias_cambiadas: nodos,
    materiales_por_copia: Object.fromEntries(Object.entries(materiales).map(([n, m]) => [n, nombreDeMaterialRef(m)])),
    ...(acomodado ? { planchas: acomodado.datos } : { planchas: "El diseño todavía no tiene material: elígelo con elegir_material." }),
    version_guardada: version,
  };
  return exito(
    datos,
    `${nodos.length === 1 ? nodos[0] : `${nodos.length} copias`}: ${cambios.join(" y ")} · versión ${version}`,
    {
      diseno: {
        plantilla: generado?.plantilla ?? PLANTILLA_LIBRE,
        parametros: generado?.parametros ?? {},
        ...(material ? { material } : {}),
        materiales,
      },
    },
  );
}

async function verCosto(deps: DependenciasCad): Promise<ResultadoHerramienta> {
  const actual = await deps.obtenerDisenoActual();
  if (!actual) return sinDiseno();

  const material = await deps.obtenerMaterial();
  if (!material) {
    return fallo(
      {
        codigo: "sin_material",
        mensaje:
          "El diseño no tiene material. Pregunta a la persona material, color y espesor, y elígelo con elegir_material antes de calcular el costo.",
      },
      "Falta el material",
    );
  }

  const [catalogo, config] = await Promise.all([deps.cargarPlanchas(), deps.cargarConfigCortes()]);
  const grupo = catalogo.find((g) => g.id === material.grupoPlanchaId);
  if (!grupo) {
    return fallo(
      {
        codigo: "material_fuera_de_catalogo",
        mensaje: "El material del diseño ya no está en el catálogo (o no tiene formatos activos). Elige otro con elegir_material.",
      },
      "Material fuera del catálogo",
    );
  }

  // Las piezas no se guardan: se recalculan con el motor o el sandbox.
  let piezas: PiezaCad[];
  let parametros: ParametrosCad = {};
  let validaciones: ValidacionCad[];
  const avisos: string[] = [];
  if (actual.plantilla === PLANTILLA_LIBRE) {
    if (!deps.libre || !actual.codigo) return sinLibre("ver_costo");
    const r = await deps.libre.ejecutarCodigo(actual.codigo);
    piezas = r.piezas ?? [];
    validaciones = r.validaciones ?? [];
    if (actual.estado !== "aprobado") {
      avisos.push("Es un diseño personalizado en borrador: Administración tiene que aprobarlo antes de cotizarlo.");
    }
  } else {
    const r = await deps.generarDiseno(actual.plantilla, actual.parametros);
    piezas = r.piezas ?? [];
    parametros = r.parametros;
    validaciones = r.validaciones ?? [];
  }
  if (validaciones.some((v) => v.nivel === "error")) {
    avisos.push("El diseño tiene errores de validación: hay que corregirlos antes de cotizarlo.");
  }

  const { planchas } = await planchasDe(deps, catalogo, material, parametros, piezas, corteDe(config));
  const codigos = [...new Set(planchas.grupos.flatMap((g) => g.grupo.formatos.map((f) => f.codigo)))];
  const conMontos = !!deps.cargarPrecios;
  let precios: Record<string, number>;
  if (deps.cargarPrecios) {
    try {
      precios = await deps.cargarPrecios(codigos);
    } catch (e) {
      console.error("[cad] precios de planchas (chat)", e);
      precios = {};
      avisos.push("No se pudieron leer los precios de Odoo: el material sale en cero.");
    }
  } else {
    // Sin montos, el precio no importa: con cero, el costo no se queja de que falte.
    precios = Object.fromEntries(codigos.map((c) => [c, 0]));
  }

  const costo = costoPorGrupos(planchas.grupos, costoDiseno, { precios, config });
  const nombre = nombreMaterial(grupo, material.color);
  if (!costo) {
    return fallo(
      {
        codigo: "sin_acomodo",
        mensaje: "No se pudo calcular el costo: las piezas no se pudieron acomodar en las planchas de este material.",
        material: nombre,
        problemas: planchas.problemas,
      },
      "Costo no disponible",
    );
  }

  const problemas = [...planchas.problemas, ...(costo.problema ? [costo.problema] : [])];
  const fuera = planchas.grupos.flatMap((g) => piezasFueraDe(g.acomodo, piezas));
  const varios = planchas.grupos.length > 1;
  const formato = varios ? null : formatoDe(planchas.grupos[0].grupo, planchas.grupos[0].acomodo);
  const datos = {
    material: nombre,
    planchas: +costo.planchas.toFixed(2),
    ...(varios
      ? {
          por_material: costo.grupos.map((g, i) => ({
            material: g.etiqueta,
            planchas: g.costo ? +g.costo.planchas.toFixed(2) : null,
            formato: formatoDe(planchas.grupos[i].grupo, planchas.grupos[i].acomodo),
            minutos_laser: g.costo ? +g.costo.minutosLaser.toFixed(1) : null,
            ...(conMontos && g.costo ? { total: g.costo.total } : {}),
          })),
        }
      : { formato }),
    minutos_laser: +costo.minutosLaser.toFixed(1),
    ...(conMontos
      ? {
          moneda: "PEN (soles)",
          costo_material: costo.material,
          servicio_corte: costo.servicio,
          total: costo.total,
        }
      : { montos: "Solo Administración ve los montos. No des ni estimes precios: da planchas y minutos de láser." }),
    piezas_que_no_entran: fuera,
    problemas,
    ...(avisos.length ? { avisos } : {}),
    nota: "Es el costo de material y corte láser, no el precio al cliente: no incluye plegado, pegado ni armado.",
  };

  const partes = [
    ...(conMontos ? [`S/ ${costo.total.toFixed(2)}`] : []),
    `${num(costo.planchas)} ${costo.planchas === 1 ? "plancha" : "planchas"}${formato ? ` ${formato.codigo}` : ""}`,
    `${num(+costo.minutosLaser.toFixed(1))} min de láser`,
  ];
  if (problemas.length > 0) partes.push(fuera.length > 0 ? "piezas que no entran" : "con problemas");
  return exito(datos, partes.join(" · "));
}

/* ── Diseño libre ──────────────────────────────────────────────────────────── */

/** El error de código que trae un `ErrorSandboxCad`, reconocido por su forma. */
function errorDeCodigo(e: unknown): ErrorCodigoLibre | null {
  if (!(e instanceof Error)) return null;
  const x = (e as Error & { errorCodigo?: unknown }).errorCodigo;
  if (!x || typeof x !== "object" || typeof (x as ErrorCodigoLibre).mensaje !== "string") return null;
  return x as ErrorCodigoLibre;
}

const PISTAS_ERROR: Record<ErrorCodigoLibre["tipo"], string> = {
  sintaxis: "Corrige la sintaxis en la línea indicada.",
  prohibido:
    "El sandbox solo admite `import math`, `from build123d import ...` y `from diseno import ...`, sin archivos, sin atributos con guion bajo, sin clases ni try/with. Reescribe esa parte.",
  ejecucion: "Lee la traza: la línea indicada es la de tu código. Corrige y vuelve a ejecutar.",
  tiempo: "Tardó demasiado: quita bucles largos o geometría con demasiados detalles.",
  memoria: "Usó demasiada memoria: simplifica la geometría.",
  contrato:
    "Asigna `piezas = [pieza(id, nombre, contorno, espesor, ubicaciones=[ubicar(...)])]` con caras planas de `diseno`, no sólidos 3D.",
  geometria: "Las piezas no forman geometría válida: revisa que los contornos sean cerrados y no se crucen.",
  salida: "El resultado fue demasiado grande: reduce piezas o detalles.",
};

function sinLibre(nombre: string): ResultadoHerramienta {
  return fallo(
    {
      codigo: "diseno_libre_no_disponible",
      mensaje: `El diseño libre no está disponible ahora, así que "${nombre}" no se puede usar. Usa una plantilla.`,
    },
    "Diseño libre no disponible",
  );
}

async function leerReferenciaCad(args: unknown, deps: DependenciasCad): Promise<ResultadoHerramienta> {
  if (!deps.libre) return sinLibre("leer_referencia_cad");
  const a = esquemaReferencia.safeParse(args ?? {});
  if (!a.success) return argumentosInvalidos(a.error);

  const listar = async (aviso?: string) => {
    const lista = await deps.libre!.listarReferencias();
    return exito(
      { ...(aviso ? { aviso } : {}), referencias: lista.map((r) => r.nombre) },
      `${lista.length} referencias`,
    );
  };
  if (!a.data.nombre) return listar();

  const texto = await deps.libre.leerReferencia(a.data.nombre);
  if (texto === null) return listar(`No existe la referencia "${a.data.nombre}". Estas son las que hay.`);
  const recortado = texto.length > MAX_REFERENCIA;
  return exito(
    {
      nombre: a.data.nombre,
      nota:
        "Material de referencia de build123d (VibeCAD). Adáptalo a las reglas del sandbox: nada de uvx ni exportar archivos; " +
        "el resultado es `piezas = [...]` de `diseno`.",
      contenido: recortado ? `${texto.slice(0, MAX_REFERENCIA)}\n…(recortado)` : texto,
    },
    a.data.nombre.split("/").pop() ?? a.data.nombre,
  );
}

/** Lo que el modelo necesita de una ejecución. Sin `glb_base64`. */
function resumenDeLibre(r: ResultadoLibre) {
  const validaciones = ordenarValidaciones(r.validaciones ?? []);
  const piezas: PiezaCad[] = r.piezas ?? [];
  return {
    nombre: r.nombre ?? null,
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
    ...(r.salida ? { salida: r.salida.slice(0, 2000) } : {}),
  };
}

async function ejecutarBuild123d(args: unknown, deps: DependenciasCad): Promise<ResultadoHerramienta> {
  if (!deps.libre) return sinLibre("ejecutar_build123d");
  const a = esquemaCodigo.safeParse(args);
  if (!a.success) return argumentosInvalidos(a.error);

  if (deps.libre.intentos.n >= MAX_INTENTOS_LIBRE) {
    return fallo(
      {
        codigo: "demasiados_intentos",
        mensaje: `Ya se ejecutó código ${MAX_INTENTOS_LIBRE} veces en este turno. Detente, explica a la persona qué falta resolver y pregunta cómo seguir.`,
      },
      "Demasiados intentos",
    );
  }
  deps.libre.intentos.n++;

  let generado: ResultadoLibre;
  try {
    generado = await deps.libre.ejecutarCodigo(a.data.codigo);
  } catch (e) {
    const error = errorDeCodigo(e);
    if (!error) throw e;
    const linea = error.linea ? ` (línea ${error.linea})` : "";
    return fallo(
      {
        codigo: "codigo_invalido",
        tipo: error.tipo,
        mensaje: error.mensaje,
        ...(error.linea ? { linea: error.linea } : {}),
        ...(error.traza ? { traza: error.traza } : {}),
        ...(error.salida ? { salida: error.salida } : {}),
        pista: PISTAS_ERROR[error.tipo] ?? PISTAS_ERROR.ejecucion,
        intentos_restantes: MAX_INTENTOS_LIBRE - deps.libre.intentos.n,
      },
      `Error de ${error.tipo}${linea}`,
    );
  }

  let version: number;
  try {
    ({ version } = await deps.libre.guardarVersionLibre(a.data.codigo));
  } catch (e) {
    console.error("[cad] guardar versión libre", e);
    return fallo(
      {
        codigo: "no_guardado",
        mensaje: "El código funcionó pero no se pudo guardar, así que el visor no cambió. Dile a la persona que lo intente de nuevo.",
      },
      "No se pudo guardar el diseño",
    );
  }

  const resumen = resumenDeLibre(generado);
  const errores = resumen.validaciones.filter((v) => v.nivel === "error").length;
  return exito(
    {
      ...resumen,
      version_guardada: version,
      estado: "borrador",
      aviso:
        "Es un diseño personalizado en BORRADOR: Administración tiene que aprobarlo antes de bajar el DXF para producción. Díselo a la persona.",
      siguiente_paso: "Usa ver_render para comprobar que se ve como se pidió.",
    },
    `Personalizado · ${medidas(generado.dimensiones)} · versión ${version} · borrador` +
      (errores > 0 ? ` · ${errores} ${errores === 1 ? "error" : "errores"}` : ""),
    { diseno: { plantilla: PLANTILLA_LIBRE, parametros: {} } },
  );
}

async function verRender(deps: DependenciasCad): Promise<ResultadoHerramienta> {
  if (!deps.libre) return sinLibre("ver_render");
  const actual = await deps.obtenerDisenoActual();
  if (!actual) {
    return fallo({ codigo: "sin_diseno", mensaje: "Todavía no hay un diseño que mirar." }, "Diseño vacío");
  }
  const imagen = await deps.libre.renderizarActual();
  return exito(
    {
      version: actual.version,
      vistas: ["isométrica (arriba a la izquierda)", "frente", "planta", "lateral"],
      nota: "La imagen va a continuación. Cada pieza tiene un color distinto.",
    },
    `Render de la versión ${actual.version}`,
    { imagenes: [imagen] },
  );
}

async function verDisenoLibreActual(
  actual: DisenoActual,
  base: Record<string, unknown>,
  deps: DependenciasCad,
): Promise<ResultadoHerramienta> {
  const datos = { ...base, tipo: "diseño libre", estado: actual.estado ?? "borrador", codigo: actual.codigo ?? "" };
  if (!deps.libre || !actual.codigo) {
    return exito(
      { ...datos, aviso: "El diseño libre no está disponible ahora: no se pueden recalcular medidas." },
      `Versión ${actual.version} · personalizado`,
    );
  }
  try {
    const r = await deps.libre.ejecutarCodigo(actual.codigo);
    return exito({ ...resumenDeLibre(r), ...datos }, `${medidas(r.dimensiones)} · versión ${actual.version} · personalizado`);
  } catch (e) {
    const error = errorDeCodigo(e) ?? errorDeMotor(e);
    if (!error) console.error("[cad] herramienta ver_diseno_actual (libre)", e);
    return exito(
      { ...datos, aviso: `No se pudieron recalcular medidas: ${error?.mensaje ?? "el sandbox falló"}` },
      `Versión ${actual.version} · personalizado`,
    );
  }
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
      case "elegir_material":
        return await elegirMaterial(argumentos, deps);
      case "cambiar_piezas":
        return await cambiarPiezas(argumentos, deps);
      case "ver_costo":
        return await verCosto(deps);
    }
    switch (nombre as NombreHerramientaLibre) {
      case "leer_referencia_cad":
        return await leerReferenciaCad(argumentos, deps);
      case "ejecutar_build123d":
        return await ejecutarBuild123d(argumentos, deps);
      case "ver_render":
        return await verRender(deps);
      default:
        return fallo(
          {
            codigo: "herramienta_desconocida",
            mensaje: `No existe la herramienta "${nombre}". Las disponibles: ${[
              ...NOMBRES_HERRAMIENTA,
              ...(deps.libre ? NOMBRES_HERRAMIENTA_LIBRE : []),
            ].join(", ")}.`,
          },
          "Herramienta desconocida",
        );
    }
  } catch (e) {
    return falloDe(e, nombre);
  }
}
