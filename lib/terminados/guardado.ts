/**
 * Un producto terminado tal como se guarda con su línea
 * (`cotizacion_productos.terminado`).
 *
 * Como el corte, es la ficha congelada de lo que se cotizó: qué producto,
 * medidas, material, opciones, el material que se estimó, y el precio que
 * sugirió la fórmula junto al que se cobró. No se rehace al leer.
 *
 * Sin dependencias de servidor: lo leen también los componentes del navegador.
 */

import { z } from "zod";
import { esquemaPlancha, guardarPlanchas, type PlanchaGuardada } from "../cortes/guardado";
import type { CalculoTerminado, MaterialEstimado } from "./calcular";
import type { PiezaDeTerminado } from "./piezas";
import type { ClaseOpcion } from "./catalogo";
import { textoDeMedidas, type Geometria, type Medidas } from "./geometria";

export interface OpcionGuardada {
  clase: ClaseOpcion;
  nombre: string;
  /** Lo que sumó al precio de cada unidad. */
  extra: number;
}

export interface MaterialDeTerminado {
  /** El grupo del catálogo de planchas (`grupos_plancha.id`). */
  grupoId: string;
  /** "Acrílico ECO". */
  material: string;
  color: string;
  espesorMm: number;
}

/** Los cortes de un producto terminado: sus piezas y cómo se acomodan en la plancha. */
export interface CorteDeTerminado {
  /** Las piezas de toda la línea, una fila por medida. */
  piezas: PiezaDeTerminado[];
  /** El formato elegido, con su precio de Odoo en ese momento. */
  formato: { codigo: string; ancho: number; alto: number; precio: number };
  rotable: boolean;
  planchas: PlanchaGuardada[];
  desperdicioPct: number;
}

export interface TerminadoGuardado {
  version: 1;
  /** Del catálogo o llenado a mano. */
  estandar: boolean;
  /** "CAJ-001". `null` en un personalizado. */
  productoCodigo: string | null;
  /** "CAJ". Un personalizado puede no tener tipo. */
  tipoCodigo: string | null;
  tipoNombre: string | null;
  nombre: string;
  geometria: Geometria;
  medidas: Medidas;
  /** Si la medida es una de las estándar del catálogo. */
  medidaEstandar: boolean;
  /** La plancha de la que sale. `null`: un personalizado que no la dijo. */
  material: MaterialDeTerminado | null;
  opciones: OpcionGuardada[];
  /** El texto de unas letras o de un letrero, tal cual va. */
  texto: string | null;
  notas: string | null;
  /** El área de una unidad, sin merma (m²). */
  areaUnidadM2: number | null;
  /** Si el área la escribió quien cotiza en vez de salir de la forma. */
  areaManual: boolean;
  mermaPct: number;
  /** Lo que se estima que consume toda la línea. */
  materiales: MaterialEstimado[];
  costoMaterial: number;
  factor: number;
  /** Por unidad: lo que dijo la fórmula. */
  precioSugerido: number;
  /** Por unidad: lo que se cobra. */
  precioUnitario: number;
  /** Si lo estimado se reserva en Odoo al confirmar el pedido. */
  reservar: boolean;
  /** Las piezas y su acomodo. `null`: el material se estimó por área (o la ficha es de antes). */
  corte: CorteDeTerminado | null;
}

/** Los cortes del cálculo como se guardan, o `null` si el material salió del área. */
export function guardarCorteDeTerminado(c: Pick<CalculoTerminado, "corte" | "piezas">): CorteDeTerminado | null {
  if (!c.corte || !c.piezas) return null;
  const { codigo, ancho, alto, precio } = c.corte.formato;
  return {
    piezas: c.piezas.map((p) => ({ nombre: p.nombre, ancho: p.ancho, alto: p.alto, cantidad: p.cantidad })),
    formato: { codigo, ancho, alto, precio },
    rotable: true,
    planchas: guardarPlanchas(c.corte.planchas),
    desperdicioPct: Math.round(c.corte.desperdicioPct * 10) / 10,
  };
}

/** Lo que logística dice que se usó de verdad en un producto terminado. */
export interface MaterialUsado {
  productoId: number;
  codigo: string | null;
  nombre: string;
  unidad: string | null;
  cantidad: number;
}

/* ── Leer lo guardado ──────────────────────────────────────────────────────── */

const numero = z.number().finite();
const medida = numero.nullable().optional();

const esquema = z.object({
  version: z.literal(1),
  estandar: z.boolean(),
  productoCodigo: z.string().nullable(),
  tipoCodigo: z.string().nullable(),
  tipoNombre: z.string().nullable(),
  nombre: z.string(),
  geometria: z.enum(["caja_cerrada", "caja_abierta", "cilindro", "lamina", "lamina_plegada", "letras", "manual"]),
  medidas: z.object({ m1: medida, m2: medida, m3: medida, diametro: medida, altura: medida, letras: medida }),
  medidaEstandar: z.boolean().catch(false),
  material: z
    .object({ grupoId: z.string(), material: z.string(), color: z.string(), espesorMm: numero })
    .nullable(),
  opciones: z.array(
    z.object({ clase: z.enum(["personalizacion", "acabado", "complemento"]), nombre: z.string(), extra: numero }),
  ),
  texto: z.string().nullable().catch(null),
  notas: z.string().nullable().catch(null),
  areaUnidadM2: numero.nullable(),
  areaManual: z.boolean().catch(false),
  mermaPct: numero.catch(0),
  materiales: z.array(
    z.object({
      productoId: numero,
      codigo: z.string().nullable(),
      nombre: z.string(),
      unidad: z.string().nullable(),
      cantidad: numero,
      precio: numero,
      esPlancha: z.boolean(),
    }),
  ),
  costoMaterial: numero,
  factor: numero,
  precioSugerido: numero,
  precioUnitario: numero,
  reservar: z.boolean().catch(false),
  corte: z
    .object({
      piezas: z.array(z.object({ nombre: z.string().catch(""), ancho: numero, alto: numero, cantidad: numero })),
      formato: z.object({ codigo: z.string(), ancho: numero, alto: numero, precio: numero }),
      rotable: z.boolean().catch(true),
      planchas: z.array(esquemaPlancha),
      desperdicioPct: numero.catch(0),
    })
    .nullable()
    .catch(null)
    .default(null),
}) satisfies z.ZodType<TerminadoGuardado>;

/** La ficha de una línea, o `null` si la línea no es un producto terminado o el JSON no se entiende. */
export function leerTerminado(json: unknown): TerminadoGuardado | null {
  const r = esquema.safeParse(json);
  return r.success ? r.data : null;
}

const esquemaUsados = z.array(
  z.object({
    productoId: numero,
    codigo: z.string().nullable().catch(null),
    nombre: z.string().catch(""),
    unidad: z.string().nullable().catch(null),
    cantidad: numero,
  }),
);

/** Lo anotado como usado, o `null` si nadie lo anotó. */
export function leerMaterialesUsados(json: unknown): MaterialUsado[] | null {
  if (json === null || json === undefined) return null;
  const r = esquemaUsados.safeParse(json);
  return r.success ? r.data : null;
}

/* ── Decirlo en palabras ───────────────────────────────────────────────────── */

const n = (x: number) => String(+x.toFixed(2));

/** "Acrílico ECO · Cristal · 3 mm". */
export const materialDeTerminado = (m: MaterialDeTerminado) =>
  [m.material, m.color, `${n(m.espesorMm)} mm`].filter(Boolean).join(" · ");

/** "[CAJ-001] Caja con tapa removible", o el nombre a secas en un personalizado. */
export const tituloTerminado = (t: Pick<TerminadoGuardado, "productoCodigo" | "nombre">) =>
  t.productoCodigo ? `[${t.productoCodigo}] ${t.nombre}` : t.nombre;

type ParaFicha = Pick<TerminadoGuardado, "medidas" | "material" | "opciones" | "texto" | "notas">;

/**
 * Las características, una por renglón: lo que el taller necesita para
 * fabricarlo y lo que el cliente lee en su cotización.
 */
export function renglonesDeTerminado(t: ParaFicha): { etiqueta: string; valor: string }[] {
  const salida: { etiqueta: string; valor: string }[] = [];
  const medidas = textoDeMedidas(t.medidas);
  if (medidas) salida.push({ etiqueta: "Medidas", valor: medidas });
  if (t.material) salida.push({ etiqueta: "Material", valor: materialDeTerminado(t.material) });
  if (t.texto) salida.push({ etiqueta: "Texto", valor: t.texto });
  for (const [clase, etiqueta] of [
    ["personalizacion", "Personalización"],
    ["acabado", "Acabado"],
    ["complemento", "Complementos"],
  ] as const) {
    const nombres = t.opciones.filter((o) => o.clase === clase).map((o) => o.nombre);
    if (nombres.length) salida.push({ etiqueta, valor: nombres.join(", ") });
  }
  if (t.notas) salida.push({ etiqueta: "Notas", valor: t.notas });
  return salida;
}

/** Todo en un renglón: "Medidas: 30 × 20 × 20 cm. Material: … ". Va a la descripción de la línea. */
export const descripcionDeTerminado = (t: ParaFicha) =>
  renglonesDeTerminado(t)
    .map((r) => `${r.etiqueta}: ${r.valor.replace(/\s+/g, " ").trim()}`)
    .join(". ");

/** "0.35 planchas", "2 un". */
export const cantidadDeMaterial = (m: { cantidad: number; unidad: string | null }) =>
  `${n(m.cantidad)} ${m.unidad === "plancha" ? (m.cantidad === 1 ? "plancha" : "planchas") : (m.unidad ?? "un")}`;

/**
 * Lo que se descuenta de un producto terminado: lo anotado o, si nadie anotó,
 * lo estimado.
 */
export function materialesADescontar(
  t: Pick<TerminadoGuardado, "materiales">,
  usados: MaterialUsado[] | null,
): MaterialUsado[] {
  const lista =
    usados ??
    t.materiales.map((m) => ({
      productoId: m.productoId,
      codigo: m.codigo,
      nombre: m.nombre,
      unidad: m.unidad,
      cantidad: m.cantidad,
    }));
  // El mismo producto dos veces se suma: Odoo lo consume una vez.
  const porProducto = new Map<number, MaterialUsado>();
  for (const m of lista) {
    if (!(m.cantidad > 0)) continue;
    const previo = porProducto.get(m.productoId);
    if (previo) previo.cantidad = Math.round((previo.cantidad + m.cantidad) * 1000) / 1000;
    else porProducto.set(m.productoId, { ...m });
  }
  return [...porProducto.values()];
}
