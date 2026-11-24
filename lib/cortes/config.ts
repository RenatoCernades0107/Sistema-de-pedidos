/**
 * La configuración del cálculo de cortes: lo que Administración puede cambiar
 * sin tocar código (`/configuracion`).
 *
 * Vive en la tabla `configuracion`, en una sola fila JSON. Se lee siempre a
 * través de `leerConfigCortes`, que nunca falla: cada valor que falte o no sirva
 * cae a su defecto, uno por uno. Una tabla de velocidades mal escrita no puede
 * dejar a la tienda sin cotizar.
 */

import { z } from "zod";

/** Una fila de la tabla del láser: a ese espesor, a qué velocidad corta. */
export interface FilaLaser {
  mm: number;
  /** mm por segundo. */
  velocidad: number;
  /** Segundos que tarda en perforar al empezar cada pieza. */
  pierce: number;
  pasadas: number;
}

/**
 * Corte manual (con cutter): cuánto se cobra por metro lineal de corte hasta ese
 * espesor. Un espesor paga la primera fila que lo alcanza: con filas de 2 y 3 mm,
 * 2.5 mm paga la de 3.
 */
export interface TarifaManual {
  hastaMm: number;
  solesPorMetro: number;
}

/** Un pedazo de plancha que el taller vende: media, cuarto. */
export interface Fraccion {
  nombre: string;
  /** Porción del precio de la plancha, antes del recargo. */
  factor: number;
  /** Recargo sobre esa porción: un pedazo más chico rinde menos. */
  recargoPct: number;
  /** Sus formas posibles, como fracción [del ancho, del alto] de la plancha. */
  formas: [number, number][];
}

export interface ConfigCortes {
  laser: {
    tabla: FilaLaser[];
    /** Lo que de verdad rinde la máquina frente a la velocidad nominal. */
    factorVelocidad: number;
    /** Segundos de más por cada pieza: posicionar, encender. */
    overheadPorPieza: number;
    costoPorMinuto: number;
    /** IGV que se suma al servicio. 0 si el costo por minuto ya lo incluye. */
    igvPct: number;
  };
  manual: { tarifas: TarifaManual[] };
  cobro: {
    /** De la más barata a la más cara: en ese orden se prueban. */
    fracciones: Fraccion[];
    /** Redondear el total del corte hacia arriba, al sol entero. */
    redondearAlSol: boolean;
    /**
     * Cuánto se puede bajar el precio de un corte respecto al calculado (%).
     * Subirlo no tiene tope.
     */
    descuentoMaxPct: number;
  };
  corte: {
    /** Lo que se come el láser en cada corte (cm). */
    kerfLaser: number;
    /** Lo que se come el cutter (cm): nada, se marca y se quiebra. */
    kerfManual: number;
    /** Borde de la plancha que no se aprovecha (cm por lado). */
    margen: number;
    /** Un sobrante con algún lado menor que esto es retazo: no vuelve al stock. */
    retazoMin: number;
  };
  /** Los códigos de Odoo de los servicios de corte. */
  servicios: { laser: string; manual: string };
}

/**
 * Las fracciones que Configuración sabe encender y apagar, de la más chica a la
 * más grande. Cada una se ancla en la esquina de la plancha: lo que queda fuera
 * vuelve al almacén como sobrante.
 */
export const FRACCIONES_ESTANDAR: readonly Fraccion[] = [
  { nombre: "1/16", factor: 1 / 16, recargoPct: 20, formas: [[0.25, 0.25]] },
  {
    nombre: "1/8",
    factor: 1 / 8,
    recargoPct: 20,
    formas: [
      [0.5, 0.25],
      [0.25, 0.5],
    ],
  },
  { nombre: "1/4", factor: 1 / 4, recargoPct: 10, formas: [[0.5, 0.5]] },
  {
    nombre: "1/2",
    factor: 1 / 2,
    recargoPct: 10,
    formas: [
      [0.5, 1],
      [1, 0.5],
    ],
  },
  {
    nombre: "3/4",
    factor: 3 / 4,
    recargoPct: 10,
    formas: [
      [0.75, 1],
      [1, 0.75],
    ],
  },
];

const fraccionEstandar = (nombre: string) => {
  const f = FRACCIONES_ESTANDAR.find((x) => x.nombre === nombre)!;
  return { ...f, formas: f.formas.map(([a, b]) => [a, b] as [number, number]) };
};

export const CONFIG_CORTES_DEFECTO: ConfigCortes = {
  laser: {
    // CO2 de 100–130 W sobre acrílico.
    tabla: [
      [2, 30],
      [3, 20],
      [4, 17],
      [5, 14],
      [6, 10],
      [8, 8],
      [10, 6],
      [12, 5],
      [15, 3],
      [20, 2],
    ].map(([mm, velocidad]) => ({ mm, velocidad, pierce: 0.1, pasadas: 1 })),
    factorVelocidad: 0.9,
    overheadPorPieza: 2.5,
    costoPorMinuto: 0.8,
    igvPct: 18,
  },
  manual: {
    // Soles por metro lineal de cutter. 5 y 6 mm pagan lo mismo; más grueso no
    // se corta a mano.
    tarifas: [
      { hastaMm: 2, solesPorMetro: 3 },
      { hastaMm: 3, solesPorMetro: 4 },
      { hastaMm: 4, solesPorMetro: 5 },
      { hastaMm: 6, solesPorMetro: 6 },
    ],
  },
  cobro: {
    // 1/16, 1/8 y 3/4 existen, pero se encienden en Configuración.
    fracciones: [fraccionEstandar("1/4"), fraccionEstandar("1/2")],
    redondearAlSol: true,
    descuentoMaxPct: 5,
  },
  corte: { kerfLaser: 0, kerfManual: 0, margen: 0, retazoMin: 30 },
  servicios: { laser: "SRV002", manual: "SRV001" },
};

const D = CONFIG_CORTES_DEFECTO;

const positivo = z.coerce.number().finite().positive();
const noNegativo = z.coerce.number().finite().min(0);

const filaLaser = z.object({
  mm: positivo,
  velocidad: positivo,
  pierce: noNegativo,
  pasadas: z.coerce.number().int().min(1),
});

const fraccion = z.object({
  nombre: z.string().trim().min(1).max(20),
  factor: z.coerce.number().gt(0).lt(1),
  recargoPct: z.coerce.number().min(0).max(200),
  formas: z
    .array(z.tuple([z.coerce.number().gt(0).max(1), z.coerce.number().gt(0).max(1)]))
    .min(1)
    .max(8),
});

const codigo = z.string().trim().min(1).max(40);

/** Sin espesores repetidos y de menor a mayor: así se interpola y así se pinta. */
function porEspesor<T>(filas: T[], mm: (f: T) => number): T[] {
  const vistos = new Map<number, T>();
  for (const f of filas) vistos.set(mm(f), f);
  return [...vistos.values()].sort((a, b) => mm(a) - mm(b));
}

/**
 * El esquema estricto: lo que se acepta al guardar desde Configuración. Aquí un
 * valor inválido es un error que se le enseña a quien lo escribió.
 */
export const esquemaConfigCortes = z.object({
  laser: z.object({
    tabla: z.array(filaLaser).min(1, "La tabla del láser necesita al menos un espesor").max(60).transform((f) => porEspesor(f, (x) => x.mm)),
    factorVelocidad: z.coerce.number().gt(0).max(2),
    overheadPorPieza: noNegativo,
    costoPorMinuto: noNegativo,
    igvPct: z.coerce.number().min(0).max(100),
  }),
  manual: z.object({
    tarifas: z
      .array(z.object({ hastaMm: positivo, solesPorMetro: noNegativo }))
      .max(80)
      .transform((f) => porEspesor(f, (x) => x.hastaMm)),
  }),
  cobro: z.object({
    fracciones: z
      .array(fraccion)
      .max(8)
      .transform((f) => [...f].sort((a, b) => a.factor - b.factor)),
    redondearAlSol: z.boolean(),
    descuentoMaxPct: z.coerce.number().finite().min(0).max(50).default(5),
  }),
  corte: z.object({
    kerfLaser: z.coerce.number().min(0).max(2),
    kerfManual: z.coerce.number().min(0).max(2),
    margen: z.coerce.number().min(0).max(10),
    retazoMin: z.coerce.number().min(0).max(200),
  }),
  servicios: z.object({ laser: codigo, manual: codigo }),
}) satisfies z.ZodType<ConfigCortes>;

/**
 * Las fracciones guardadas antes de que cada una tuviera su recargo traían uno
 * solo para todas (`cobro.recargoPct`). A esas se les pone el de la estándar del
 * mismo nombre y, si es una hecha a medida, el recargo único de antes.
 */
function completarRecargos(cobro: unknown): unknown {
  if (!cobro || typeof cobro !== "object") return cobro;
  const { recargoPct: unico, fracciones, ...resto } = cobro as Record<string, unknown>;
  if (!Array.isArray(fracciones)) return resto;
  return {
    ...resto,
    fracciones: fracciones.map((f) => {
      if (!f || typeof f !== "object" || "recargoPct" in f) return f;
      const estandar = FRACCIONES_ESTANDAR.find((e) => e.nombre === (f as { nombre?: unknown }).nombre);
      return { ...f, recargoPct: estandar?.recargoPct ?? (typeof unico === "number" ? unico : 0) };
    }),
  };
}

/**
 * El esquema tolerante: lo que se usa al LEER. Cada grupo de valores se valida
 * por separado y, si no sirve, se queda con el defecto. El corte manual de antes
 * (`manual.precios`, en soles por pieza) no se lee como si fuera por metro: cae
 * al defecto.
 */
const tolerante = z.object({
  laser: esquemaConfigCortes.shape.laser.catch(D.laser),
  manual: esquemaConfigCortes.shape.manual.catch(D.manual),
  cobro: z.preprocess(completarRecargos, esquemaConfigCortes.shape.cobro).catch(D.cobro),
  corte: esquemaConfigCortes.shape.corte.catch(D.corte),
  servicios: esquemaConfigCortes.shape.servicios.catch(D.servicios),
});

/** Lo guardado, completado con los defectos. Nunca lanza. */
export function leerConfigCortes(guardado: unknown): ConfigCortes {
  const base = guardado && typeof guardado === "object" ? guardado : {};
  const r = tolerante.safeParse({ ...D, ...base });
  return r.success ? r.data : D;
}
