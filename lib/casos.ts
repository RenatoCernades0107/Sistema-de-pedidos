/**
 * Bajas, conteos y los casos que Administración cierra.
 *
 * Logística reporta una baja o envía un conteo; cada cosa que cambiaría el stock
 * queda como un caso pendiente. Administración lo cierra con una razón:
 * aplicándolo (cambia Odoo) o descartándolo. Sin dependencias de servidor.
 */

import { z } from "zod";

export type MotivoBaja = "rotura" | "defecto" | "merma" | "perdido" | "otro";

export const MOTIVOS_BAJA: Record<MotivoBaja, string> = {
  rotura: "Rotura",
  defecto: "Defecto de fábrica",
  merma: "Merma",
  perdido: "Perdido",
  otro: "Otro",
};

export type TipoCaso = "baja" | "diferencia";
export type EstadoCaso = "pendiente" | "aplicado" | "descartado";

export const ESTADOS_CASO: Record<EstadoCaso, string> = {
  pendiente: "Pendiente",
  aplicado: "Aplicado en Odoo",
  descartado: "Descartado",
};

export interface Caso {
  id: string;
  codigo: string;
  tipo: TipoCaso;
  almacenId: string;
  almacen: string;
  productoId: number;
  codigoProducto: string | null;
  nombre: string;
  sobrante: string | null;
  /** El cambio de stock propuesto: negativo si falta o se da de baja. */
  cantidad: number;
  motivo: MotivoBaja | null;
  descripcion: string | null;
  conteo: string | null;
  esperado: number | null;
  contado: number | null;
  estado: EstadoCaso;
  razon: string | null;
  cerradoPor: string | null;
  cerradoEn: string | null;
  reportadoPor: string | null;
  reportadoEn: string;
  error: string | null;
}

export type EstadoConteo = "borrador" | "enviado" | "anulado";

export interface ConteoResumen {
  id: string;
  codigo: string;
  almacenId: string;
  almacen: string;
  alcance: string;
  estado: EstadoConteo;
  productos: number;
  contados: number;
  sobrantes: number;
  diferencias: number | null;
  coincidencias: number | null;
  creadoPor: string | null;
  creadoEn: string;
  enviadoEn: string | null;
}

export interface LineaConteo {
  productoId: number;
  codigo: string | null;
  nombre: string;
  grupo: string | null;
  contado: number | null;
}

export interface SobranteConteo {
  codigo: string;
  material: string;
  medida: string;
  ubicacion: string | null;
  encontrado: boolean | null;
}

export interface Conteo extends ConteoResumen {
  lineas: LineaConteo[];
  sobrantesLista: SobranteConteo[];
}

/* ── Esquemas ──────────────────────────────────────────────────────────────── */

const texto = (max: number, mensaje: string) =>
  z
    .string()
    .trim()
    .max(max, mensaje)
    .nullable()
    .transform((v) => (v ? v : null));

export const esquemaBaja = z
  .object({
    almacenId: z.uuid("Elige el almacén"),
    productoId: z.number().int().positive().nullable(),
    sobrante: z.string().trim().min(1).nullable(),
    cantidad: z
      .number({ error: "La cantidad es un número" })
      .int("Se da de baja por unidades enteras")
      .positive("Al menos una unidad")
      .max(99_999),
    motivo: z.enum(["rotura", "defecto", "merma", "perdido", "otro"], { error: "Elige el motivo" }),
    descripcion: texto(500, "La descripción es muy larga"),
  })
  .superRefine((v, ctx) => {
    if (!v.productoId === !v.sobrante) {
      ctx.addIssue({ code: "custom", path: ["productoId"], message: "Elige un producto o un sobrante" });
    }
    if (v.sobrante && v.cantidad !== 1) {
      ctx.addIssue({ code: "custom", path: ["cantidad"], message: "Un sobrante se da de baja entero" });
    }
    if (v.motivo === "otro" && !v.descripcion) {
      ctx.addIssue({ code: "custom", path: ["descripcion"], message: "Cuenta qué pasó" });
    }
  });

export type NuevaBaja = z.output<typeof esquemaBaja>;

export const esquemaCierre = z.object({
  id: z.uuid(),
  decision: z.enum(["aplicar", "descartar"]),
  razon: z.string().trim().min(5, "Escribe la razón (al menos 5 letras)").max(500, "La razón es muy larga"),
});

export type CierreCaso = z.output<typeof esquemaCierre>;

export const esquemaNuevoConteo = z.object({
  almacenId: z.uuid("Elige el almacén"),
  planchas: z.boolean(),
  /** Solo de un material ("Acrílico ECO"). `null`: todos. */
  material: z.string().trim().min(1).nullable(),
  accesorios: z.boolean(),
  /** Solo de una categoría. `null`: todas. */
  categoriaId: z.uuid().nullable(),
  sobrantes: z.boolean(),
}).refine((v) => v.planchas || v.accesorios || v.sobrantes, { message: "Elige qué vas a contar", path: ["planchas"] });

export type NuevoConteo = z.output<typeof esquemaNuevoConteo>;

export const esquemaGuardarConteo = z.object({
  id: z.uuid(),
  lineas: z
    .array(
      z.object({
        productoId: z.number().int().positive(),
        contado: z.number().int("Se cuenta por unidades enteras").min(0, "No puede ser negativo").max(99_999).nullable(),
      }),
    )
    .max(2000),
  sobrantes: z.array(z.object({ codigo: z.string().min(1), encontrado: z.boolean().nullable() })).max(2000),
});

export type ConteoGuardado = z.output<typeof esquemaGuardarConteo>;

/* ── Lo que sale de un conteo ──────────────────────────────────────────────── */

export interface DiferenciaDeConteo {
  productoId: number;
  codigo: string | null;
  nombre: string;
  sobrante: string | null;
  esperado: number;
  contado: number;
  /** contado − esperado. */
  cantidad: number;
}

/**
 * Las diferencias de un conteo contra lo que dice Odoo. Lo que no se contó no se
 * toma en cuenta; un sobrante marcado "no está" es una diferencia de −1, y uno
 * sin marcar tampoco cuenta.
 */
export function diferenciasDeConteo(
  lineas: Pick<LineaConteo, "productoId" | "codigo" | "nombre" | "contado">[],
  sobrantes: { codigo: string; productoId: number; encontrado: boolean | null }[],
  esperado: Map<number, number>,
): { diferencias: DiferenciaDeConteo[]; coinciden: number; sinContar: number } {
  const diferencias: DiferenciaDeConteo[] = [];
  let coinciden = 0;
  let sinContar = 0;
  for (const l of lineas) {
    if (l.contado === null) {
      sinContar++;
      continue;
    }
    const e = Math.round((esperado.get(l.productoId) ?? 0) * 100) / 100;
    const cantidad = Math.round((l.contado - e) * 100) / 100;
    if (cantidad === 0) coinciden++;
    else diferencias.push({ productoId: l.productoId, codigo: l.codigo, nombre: l.nombre, sobrante: null, esperado: e, contado: l.contado, cantidad });
  }
  for (const s of sobrantes) {
    if (s.encontrado === null) {
      sinContar++;
      continue;
    }
    if (s.encontrado) coinciden++;
    else
      diferencias.push({
        productoId: s.productoId,
        codigo: s.codigo,
        nombre: `Sobrante ${s.codigo}`,
        sobrante: s.codigo,
        esperado: 1,
        contado: 0,
        cantidad: -1,
      });
  }
  return { diferencias, coinciden, sinContar };
}

/** "−2", "+1". */
export const cambioTexto = (n: number) => `${n > 0 ? "+" : "−"}${String(+Math.abs(n).toFixed(2))}`;
