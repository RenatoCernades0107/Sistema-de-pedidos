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

/** Corte manual: cuánto se cobra por pieza a ese espesor. */
export interface PrecioManual {
  mm: number;
  precio: number;
}

/** Un pedazo de plancha que el taller vende: media, cuarto. */
export interface Fraccion {
  nombre: string;
  /** Porción del precio de la plancha, antes del recargo. */
  factor: number;
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
  manual: { precios: PrecioManual[] };
  cobro: {
    /** Recargo sobre el precio de una fracción de plancha. */
    recargoPct: number;
    /** De la más barata a la más cara: en ese orden se prueban. */
    fracciones: Fraccion[];
    /** Redondear el total del corte hacia arriba, al sol entero. */
    redondearAlSol: boolean;
  };
  corte: {
    /** Lo que se come el láser en cada corte (cm). */
    kerfLaser: number;
    /** Lo que se come la sierra (cm). */
    kerfManual: number;
    /** Borde de la plancha que no se aprovecha (cm por lado). */
    margen: number;
    /** Un sobrante con algún lado menor que esto es retazo: no vuelve al stock. */
    retazoMin: number;
  };
  /** Los códigos de Odoo de los servicios de corte. */
  servicios: { laser: string; manual: string };
}

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
    // Valores de prueba: Administración pone los reales en Configuración.
    precios: [
      { mm: 2, precio: 2 },
      { mm: 2.5, precio: 2 },
      { mm: 3, precio: 3 },
      { mm: 4, precio: 4 },
      { mm: 5, precio: 5 },
      { mm: 6, precio: 6 },
    ],
  },
  cobro: {
    recargoPct: 20,
    fracciones: [
      { nombre: "1/4", factor: 0.25, formas: [[0.5, 0.5]] },
      {
        nombre: "1/2",
        factor: 0.5,
        formas: [
          [0.5, 1],
          [1, 0.5],
        ],
      },
    ],
    redondearAlSol: true,
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
  formas: z
    .array(z.tuple([z.coerce.number().gt(0).max(1), z.coerce.number().gt(0).max(1)]))
    .min(1)
    .max(8),
});

const codigo = z.string().trim().min(1).max(40);

/** Sin espesores repetidos y de menor a mayor: así se interpola y así se pinta. */
function porEspesor<T extends { mm: number }>(filas: T[]): T[] {
  const vistos = new Map<number, T>();
  for (const f of filas) vistos.set(f.mm, f);
  return [...vistos.values()].sort((a, b) => a.mm - b.mm);
}

/**
 * El esquema estricto: lo que se acepta al guardar desde Configuración. Aquí un
 * valor inválido es un error que se le enseña a quien lo escribió.
 */
export const esquemaConfigCortes = z.object({
  laser: z.object({
    tabla: z.array(filaLaser).min(1, "La tabla del láser necesita al menos un espesor").max(60).transform(porEspesor),
    factorVelocidad: z.coerce.number().gt(0).max(2),
    overheadPorPieza: noNegativo,
    costoPorMinuto: noNegativo,
    igvPct: z.coerce.number().min(0).max(100),
  }),
  manual: z.object({
    precios: z
      .array(z.object({ mm: positivo, precio: noNegativo }))
      .max(80)
      .transform(porEspesor),
  }),
  cobro: z.object({
    recargoPct: z.coerce.number().min(0).max(200),
    fracciones: z
      .array(fraccion)
      .max(8)
      .transform((f) => [...f].sort((a, b) => a.factor - b.factor)),
    redondearAlSol: z.boolean(),
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
 * El esquema tolerante: lo que se usa al LEER. Cada grupo de valores se valida
 * por separado y, si no sirve, se queda con el defecto.
 */
const tolerante = z.object({
  laser: esquemaConfigCortes.shape.laser.catch(D.laser),
  manual: esquemaConfigCortes.shape.manual.catch(D.manual),
  cobro: esquemaConfigCortes.shape.cobro.catch(D.cobro),
  corte: esquemaConfigCortes.shape.corte.catch(D.corte),
  servicios: esquemaConfigCortes.shape.servicios.catch(D.servicios),
});

/** Lo guardado, completado con los defectos. Nunca lanza. */
export function leerConfigCortes(guardado: unknown): ConfigCortes {
  const base = guardado && typeof guardado === "object" ? guardado : {};
  const r = tolerante.safeParse({ ...D, ...base });
  return r.success ? r.data : D;
}
