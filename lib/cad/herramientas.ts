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
import {
  PLANTILLA_LIBRE,
  type ErrorCodigoLibre,
  type EstadoDisenoLibre,
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
  generarDiseno(
    plantilla: string,
    parametros: ParametrosCad,
  ): Promise<ResultadoGeneracion>;
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
  /** Solo si el diseño libre está activo (`CAD_DISENO_LIBRE=1` y sandbox configurado). */
  libre?: DependenciasLibre;
}

/** Diseño libre: el sandbox (`lib/cad/sandbox.ts`) y la persistencia de versiones libres. */
export interface DependenciasLibre {
  /** Lanza un error con `errorCodigo` si el código falla (lo que lanza `ErrorSandboxCad`). */
  ejecutarCodigo(codigo: string): Promise<ResultadoLibre>;
  /** Guarda el código como versión nueva en borrador. */
  guardarVersionLibre(codigo: string): Promise<{ version: number }>;
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
  diseno?: { plantilla: string; parametros: ParametrosCad };
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
] as const;

export type NombreHerramienta = (typeof NOMBRES_HERRAMIENTA)[number];

const SIN_ARGUMENTOS = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

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
        codigo: {
          type: "string",
          description: 'El código de la plantilla, por ejemplo "caja".',
        },
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
        plantilla: {
          type: "string",
          description: "El código de la plantilla.",
        },
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
        material: {
          type: "string",
          description:
            'Parte del nombre del material: "acrílico", "eco", "mdf".',
        },
        espesor_mm: {
          type: "number",
          description: "El espesor exacto, en milímetros.",
        },
        color: {
          type: "string",
          description:
            'El color o acabado: "cristal", "blanco lechoso", "negro".',
        },
      },
      additionalProperties: false,
    },
  },
];

/** Las herramientas del diseño libre: solo se ofrecen con el diseño libre activo. */
export const NOMBRES_HERRAMIENTA_LIBRE = [
  "leer_referencia_cad",
  "ejecutar_build123d",
  "ver_render",
] as const;

export type NombreHerramientaLibre = (typeof NOMBRES_HERRAMIENTA_LIBRE)[number];

export const HERRAMIENTAS_LIBRE: HerramientaLlm[] = [
  {
    nombre: "leer_referencia_cad",
    descripcion:
      "Lee un archivo de referencia de build123d (guías y ejemplos). Sin nombre, o con un nombre que no existe, devuelve la lista. " +
      'Útiles: "quick-reference.md", "advanced-patterns.md", "SKILL.md". Úsala solo para diseño libre, cuando dudes de la API.',
    parametros: {
      type: "object",
      properties: {
        nombre: {
          type: "string",
          description:
            'Ruta o nombre del archivo, p. ej. "quick-reference.md".',
        },
      },
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
      properties: {
        codigo: {
          type: "string",
          description: "El programa completo, en Python.",
        },
      },
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
export const herramientasDisponibles = (
  libreActivo: boolean,
): HerramientaLlm[] =>
  libreActivo ? [...HERRAMIENTAS_CAD, ...HERRAMIENTAS_LIBRE] : HERRAMIENTAS_CAD;

/* ── Argumentos ────────────────────────────────────────────────────────────── */

const esquemaVerPlantilla = z.object({
  codigo: z.string().trim().min(1).max(80),
});

const esquemaGenerar = z.object({
  plantilla: z.string().trim().min(1).max(80),
  parametros: z
    .record(
      z.string().min(1).max(80),
      z.union([z.number(), z.boolean(), z.string().max(500)]),
    )
    .default({}),
});

const esquemaReferencia = z.object({
  nombre: z.string().trim().max(300).optional(),
});

const esquemaCodigo = z.object({ codigo: z.string().min(1).max(60_000) });

const esquemaBuscarPlanchas = z.object({
  material: z.string().trim().max(80).optional(),
  espesor_mm: z.number().positive().optional(),
  color: z.string().trim().max(80).optional(),
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

const fallo = (
  datos: { codigo: string; mensaje: string } & Record<string, unknown>,
  resumen?: string,
): ResultadoHerramienta => ({
  ok: false,
  contenido: JSON.stringify({ error: datos }),
  resumen: resumen ?? datos.mensaje,
});

function argumentosInvalidos(error: z.ZodError): ResultadoHerramienta {
  return fallo(
    {
      codigo: "argumentos_invalidos",
      mensaje: "Los argumentos de la herramienta no son válidos.",
      errores: error.issues.map((i) => ({
        campo: i.path.join("."),
        mensaje: i.message,
      })),
    },
    "Argumentos inválidos",
  );
}

/**
 * Un `ErrorMotorCad` (`lib/cad/motor.ts`), reconocido por su forma y no por
 * `instanceof`: así este archivo no importa el transporte del motor.
 */
function errorDeMotor(
  e: unknown,
): {
  codigo: string;
  estado: number;
  mensaje: string;
  errores?: { campo: string; mensaje: string }[];
} | null {
  if (!(e instanceof Error)) return null;
  const m = e as Error & {
    codigo?: unknown;
    estado?: unknown;
    errores?: unknown;
  };
  if (typeof m.codigo !== "string" || typeof m.estado !== "number") return null;
  const errores = Array.isArray(m.errores)
    ? m.errores.filter(
        (x): x is { campo: string; mensaje: string } =>
          !!x && typeof x.campo === "string" && typeof x.mensaje === "string",
      )
    : [];
  return {
    codigo: m.codigo,
    estado: m.estado,
    mensaje: m.message,
    ...(errores.length ? { errores } : {}),
  };
}

/** Cualquier fallo, como resultado para el modelo. Lo inesperado se anota en el log. */
function falloDe(e: unknown, herramienta: string): ResultadoHerramienta {
  const motor = errorDeMotor(e);
  if (motor) {
    const campos = motor.errores
      ?.map((x) => x.campo)
      .filter(Boolean)
      .join(", ");
    return fallo(
      motor,
      campos ? `${motor.mensaje} (${campos})` : motor.mensaje,
    );
  }
  console.error(`[cad] herramienta ${herramienta}`, e);
  return fallo({
    codigo: "interno",
    mensaje:
      "La herramienta falló por un problema interno. No lo reintentes sin cambios.",
  });
}

/** 200 → "200", 12.50 → "12.5". */
const num = (n: number) => String(+n.toFixed(2));

const medidas = (d: ResultadoGeneracion["dimensiones"]) =>
  `${num(d.x)} × ${num(d.y)} × ${num(d.z)} mm`;

/** Los errores primero: son los que impiden mandar el diseño a producción. */
const ordenarValidaciones = (v: ValidacionCad[]): ValidacionCad[] =>
  [...v].sort(
    (a, b) => Number(b.nivel === "error") - Number(a.nivel === "error"),
  );

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

async function listarPlantillas(
  deps: DependenciasCad,
): Promise<ResultadoHerramienta> {
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

async function verPlantilla(
  args: unknown,
  deps: DependenciasCad,
): Promise<ResultadoHerramienta> {
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

async function generarDiseno(
  args: unknown,
  deps: DependenciasCad,
): Promise<ResultadoHerramienta> {
  const a = esquemaGenerar.safeParse(args);
  if (!a.success) return argumentosInvalidos(a.error);

  // Si el motor rechaza los parámetros (422) no se guarda nada: el error sale
  // por `falloDe` con el detalle por campo.
  const generado = await deps.generarDiseno(
    a.data.plantilla,
    a.data.parametros,
  );

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
  const errores = resumen.validaciones.filter(
    (v) => v.nivel === "error",
  ).length;
  return exito(
    { ...resumen, version_guardada: version },
    `${medidas(generado.dimensiones)} · versión ${version}` +
      (errores > 0
        ? ` · ${errores} ${errores === 1 ? "error" : "errores"}`
        : ""),
    {
      diseno: {
        plantilla: generado.plantilla,
        parametros: generado.parametros,
      },
    },
  );
}

async function verDisenoActual(
  deps: DependenciasCad,
): Promise<ResultadoHerramienta> {
  const actual = await deps.obtenerDisenoActual();
  if (!actual) {
    return exito(
      {
        diseno: null,
        mensaje: "El diseño está vacío: todavía no se ha generado nada.",
      },
      "Diseño vacío",
    );
  }

  const base = {
    plantilla: actual.plantilla,
    version_guardada: actual.version,
    ultimo_cambio_desde: actual.origen,
  };

  if (actual.plantilla === PLANTILLA_LIBRE)
    return verDisenoLibreActual(actual, base, deps);

  // Las medidas y las validaciones no se guardan: se le vuelven a pedir al
  // motor. Si no contesta, al menos van la plantilla y los parámetros.
  try {
    const generado = await deps.generarDiseno(
      actual.plantilla,
      actual.parametros,
    );
    return exito(
      { ...resumenDeGeneracion(generado), ...base },
      `${medidas(generado.dimensiones)} · versión ${actual.version}`,
    );
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

async function buscarPlanchas(
  args: unknown,
  deps: DependenciasCad,
): Promise<ResultadoHerramienta> {
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
    datos.aviso =
      "Ninguna plancha del catálogo coincide. Prueba con menos filtros.";
  }
  return exito(
    datos,
    grupos.length === 1 ? "1 plancha" : `${grupos.length} planchas`,
  );
}

/* ── Diseño libre ──────────────────────────────────────────────────────────── */

/** El error de código que trae un `ErrorSandboxCad`, reconocido por su forma. */
function errorDeCodigo(e: unknown): ErrorCodigoLibre | null {
  if (!(e instanceof Error)) return null;
  const x = (e as Error & { errorCodigo?: unknown }).errorCodigo;
  if (
    !x ||
    typeof x !== "object" ||
    typeof (x as ErrorCodigoLibre).mensaje !== "string"
  )
    return null;
  return x as ErrorCodigoLibre;
}

const PISTAS_ERROR: Record<ErrorCodigoLibre["tipo"], string> = {
  sintaxis: "Corrige la sintaxis en la línea indicada.",
  prohibido:
    "El sandbox solo admite `import math`, `from build123d import ...` y `from diseno import ...`, sin archivos, sin atributos con guion bajo, sin clases ni try/with. Reescribe esa parte.",
  ejecucion:
    "Lee la traza: la línea indicada es la de tu código. Corrige y vuelve a ejecutar.",
  tiempo:
    "Tardó demasiado: quita bucles largos o geometría con demasiados detalles.",
  memoria: "Usó demasiada memoria: simplifica la geometría.",
  contrato:
    "Asigna `piezas = [pieza(id, nombre, contorno, espesor, ubicaciones=[ubicar(...)])]` con caras planas de `diseno`, no sólidos 3D.",
  geometria:
    "Las piezas no forman geometría válida: revisa que los contornos sean cerrados y no se crucen.",
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

async function leerReferenciaCad(
  args: unknown,
  deps: DependenciasCad,
): Promise<ResultadoHerramienta> {
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
  if (texto === null)
    return listar(
      `No existe la referencia "${a.data.nombre}". Estas son las que hay.`,
    );
  const recortado = texto.length > MAX_REFERENCIA;
  return exito(
    {
      nombre: a.data.nombre,
      nota:
        "Material de referencia de build123d (VibeCAD). Adáptalo a las reglas del sandbox: nada de uvx ni exportar archivos; " +
        "el resultado es `piezas = [...]` de `diseno`.",
      contenido: recortado
        ? `${texto.slice(0, MAX_REFERENCIA)}\n…(recortado)`
        : texto,
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

async function ejecutarBuild123d(
  args: unknown,
  deps: DependenciasCad,
): Promise<ResultadoHerramienta> {
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
        mensaje:
          "El código funcionó pero no se pudo guardar, así que el visor no cambió. Dile a la persona que lo intente de nuevo.",
      },
      "No se pudo guardar el diseño",
    );
  }

  const resumen = resumenDeLibre(generado);
  const errores = resumen.validaciones.filter(
    (v) => v.nivel === "error",
  ).length;
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
      (errores > 0
        ? ` · ${errores} ${errores === 1 ? "error" : "errores"}`
        : ""),
    { diseno: { plantilla: PLANTILLA_LIBRE, parametros: {} } },
  );
}

async function verRender(deps: DependenciasCad): Promise<ResultadoHerramienta> {
  if (!deps.libre) return sinLibre("ver_render");
  const actual = await deps.obtenerDisenoActual();
  if (!actual) {
    return fallo(
      { codigo: "sin_diseno", mensaje: "Todavía no hay un diseño que mirar." },
      "Diseño vacío",
    );
  }
  const imagen = await deps.libre.renderizarActual();
  return exito(
    {
      version: actual.version,
      vistas: [
        "isométrica (arriba a la izquierda)",
        "frente",
        "planta",
        "lateral",
      ],
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
  const datos = {
    ...base,
    tipo: "diseño libre",
    estado: actual.estado ?? "borrador",
    codigo: actual.codigo ?? "",
  };
  if (!deps.libre || !actual.codigo) {
    return exito(
      {
        ...datos,
        aviso:
          "El diseño libre no está disponible ahora: no se pueden recalcular medidas.",
      },
      `Versión ${actual.version} · personalizado`,
    );
  }
  try {
    const r = await deps.libre.ejecutarCodigo(actual.codigo);
    return exito(
      { ...resumenDeLibre(r), ...datos },
      `${medidas(r.dimensiones)} · versión ${actual.version} · personalizado`,
    );
  } catch (e) {
    const error = errorDeCodigo(e) ?? errorDeMotor(e);
    if (!error) console.error("[cad] herramienta ver_diseno_actual (libre)", e);
    return exito(
      {
        ...datos,
        aviso: `No se pudieron recalcular medidas: ${error?.mensaje ?? "el sandbox falló"}`,
      },
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
