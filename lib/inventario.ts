/**
 * El inventario en el idioma de la pantalla: las planchas y los accesorios con
 * su stock en cada almacén, los ingresos, y lo que llega del navegador para
 * ingresar stock o crear productos.
 *
 * Sin dependencias de servidor: lo usan la pantalla Almacén, el servidor y las pruebas.
 */

import { z } from "zod";
import { colorDe, medidaDe, type GrupoPlancha } from "./cortes/catalogo";

/* ── Lo que se muestra ─────────────────────────────────────────────────────── */

export interface StockFila {
  /** Lo que hay en cada almacén de la app, por su id. */
  porAlmacen: Record<string, number>;
  total: number;
  /** Lo que está en Odoo fuera de los almacenes de la app (el almacén anterior). */
  fuera: number;
}

/** Lo común de una plancha o un accesorio: el producto de Odoo y su stock. */
export interface ProductoInventario {
  /** El producto de Odoo. `null`: el código no existe en Odoo. */
  productoId: number | null;
  codigo: string;
  nombre: string;
  /** Precio de venta. `null` para quien no lo ve (o si no está en Odoo). */
  precio: number | null;
  unidad: string | null;
  /** `null`: no se pudo leer de Odoo. */
  stock: StockFila | null;
}

export interface PlanchaInventario extends ProductoInventario {
  grupoId: string;
  formatoId: string;
  material: string;
  /** "Cristal", "Blanco lechoso". */
  color: string;
  espesorMm: number;
  /** "122×183". */
  formato: string;
  anchoCm: number;
  largoCm: number;
  activo: boolean;
}

export interface AccesorioInventario extends ProductoInventario {
  id: string;
  categoriaId: string;
  categoria: string;
  activo: boolean;
}

export interface CategoriaAccesorio {
  id: string;
  nombre: string;
  prefijo: string;
  orden: number;
}

export interface IngresoResumen {
  id: string;
  codigo: string;
  tipo: TipoIngreso;
  almacen: string;
  proveedor: string | null;
  documento: string | null;
  nota: string | null;
  lineas: { codigo: string | null; nombre: string; cantidad: number; costo: number | null; anterior: number | null }[];
  sincronizacion: "pendiente" | "sincronizada" | "error";
  error: string | null;
  creadoPor: string | null;
  creadoEn: string;
}

/** Las planchas de un catálogo, una fila por formato, en el orden del catálogo. */
export function filasDePlanchas(catalogo: GrupoPlancha[]): Omit<PlanchaInventario, keyof ProductoInventario | "codigo">[] {
  return catalogo.flatMap((g) =>
    g.formatos.map((f) => ({
      grupoId: g.id,
      formatoId: f.id,
      material: g.material,
      color: colorDe(g),
      espesorMm: g.espesorMm,
      formato: medidaDe(f),
      anchoCm: f.anchoCm,
      largoCm: f.largoCm,
      activo: f.activo,
    })),
  );
}

/** Los valores distintos de un campo, en orden: para los filtros de la pantalla. */
export function valoresDe<T, K extends keyof T>(filas: T[], campo: K): T[K][] {
  const vistos: T[K][] = [];
  for (const f of filas) if (!vistos.includes(f[campo])) vistos.push(f[campo]);
  return vistos;
}

/** Sin tildes y en mayúsculas, como los nombres de la lista de la empresa. */
const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** "ACRILICO ECO CRISTAL 3MM 1.22X1.83", como los demás nombres de planchas en Odoo. */
export function nombreDePlancha(p: {
  material: string;
  variante: string;
  detalle: string;
  espesorMm: number;
  anchoCm: number;
  largoCm: number;
}): string {
  const m = (cm: number) => String(+(cm / 100).toFixed(4));
  const partes = [p.material, p.variante, p.detalle, `${String(+p.espesorMm.toFixed(2))}MM`, `${m(p.anchoCm)}X${m(p.largoCm)}`];
  return sinTildes(partes.filter((x) => x.trim()).join(" ")).toUpperCase();
}

/* ── Lo que llega del navegador ────────────────────────────────────────────── */

export type TipoIngreso = "compra" | "ajuste";

export const TIPOS_INGRESO: Record<TipoIngreso, string> = {
  compra: "Compra",
  ajuste: "Ajuste de inventario",
};

const texto = (max: number, mensaje: string) =>
  z
    .string()
    .trim()
    .max(max, mensaje)
    .transform((v) => v || null)
    .nullable();

const precio = z
  .number({ error: "El precio es un número" })
  .min(0, "El precio no puede ser negativo")
  .max(1_000_000, "Ese precio no es razonable");

export const esquemaIngreso = z
  .object({
    tipo: z.enum(["compra", "ajuste"]),
    almacenId: z.uuid("Elige el almacén"),
    proveedorId: z.number().int().positive().nullable(),
    proveedorNombre: texto(160, "El nombre del proveedor es muy largo"),
    documento: texto(60, "La guía o factura es muy larga"),
    nota: texto(500, "La nota es muy larga"),
    lineas: z
      .array(
        z.object({
          productoId: z.number().int().positive(),
          cantidad: z
            .number({ error: "La cantidad es un número" })
            .int("Se ingresa por unidades enteras")
            .min(0, "La cantidad no puede ser negativa")
            .max(99_999, "Son demasiadas unidades"),
          costo: precio.nullable(),
        }),
      )
      .min(1, "Agrega al menos un producto")
      .max(100, "Son demasiados productos para un solo ingreso"),
  })
  .superRefine((v, ctx) => {
    if (v.tipo === "compra" && !v.proveedorId) {
      ctx.addIssue({ code: "custom", path: ["proveedorId"], message: "Elige el proveedor de la compra" });
    }
    v.lineas.forEach((l, i) => {
      if (v.tipo === "compra" && l.cantidad <= 0) {
        ctx.addIssue({ code: "custom", path: ["lineas", i, "cantidad"], message: "En una compra cada producto llega con al menos una unidad" });
      }
      if (v.tipo === "compra" && l.costo === null) {
        ctx.addIssue({ code: "custom", path: ["lineas", i, "costo"], message: "Escribe el costo de cada producto comprado" });
      }
    });
    const ids = v.lineas.map((l) => l.productoId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", path: ["lineas"], message: "Un producto está dos veces: júntalo en una sola línea" });
    }
  });

export type NuevoIngreso = z.output<typeof esquemaIngreso>;

const medida = z
  .number({ error: "Escribe la medida en centímetros" })
  .positive("La medida tiene que ser mayor que cero")
  .max(2000, "Esa medida no es razonable");

export const esquemaNuevaPlancha = z.object({
  tipo: z.literal("plancha"),
  material: z.string().trim().min(2, "Escribe el material").max(80),
  variante: z.string().trim().max(60),
  detalle: z.string().trim().max(80),
  espesorMm: z
    .number({ error: "Escribe el espesor en milímetros" })
    .positive("El espesor tiene que ser mayor que cero")
    .max(200, "Ese espesor no es razonable"),
  anchoCm: medida,
  largoCm: medida,
  rotable: z.boolean(),
  /** Solo Administración lo pone; para el resto queda en 0 hasta que lo ponga. */
  precio: precio.nullable(),
});

export const esquemaNuevoAccesorio = z.object({
  tipo: z.literal("accesorio"),
  categoriaId: z.uuid("Elige la categoría"),
  nombre: z.string().trim().min(3, "Escribe el nombre del accesorio").max(120, "El nombre es muy largo"),
  precio: precio.nullable(),
});

export const esquemaNuevoProducto = z.discriminatedUnion("tipo", [esquemaNuevaPlancha, esquemaNuevoAccesorio]);
export type NuevoProducto = z.output<typeof esquemaNuevoProducto>;

export const esquemaAccesorioExistente = z.object({
  codigo: z.string().trim().min(1, "Escribe el código de Odoo").max(40),
  categoriaId: z.uuid("Elige la categoría"),
});

export const esquemaPrecio = z.object({
  productoId: z.number().int().positive(),
  precio,
});

export const esquemaPrecioSobrante = z.object({
  codigo: z.string().trim().min(1).max(60),
  /** `null`: vuelve al calculado. */
  precio: precio.nullable(),
});

export const esquemaCategoria = z.object({
  id: z.uuid().nullable(),
  nombre: z.string().trim().min(2, "Escribe el nombre de la categoría").max(60),
  prefijo: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2,5}$/, "El prefijo son de 2 a 5 letras (ACC, PEG)"),
});

export const esquemaAlmacen = z.object({
  id: z.uuid().nullable(),
  nombre: z.string().trim().min(2, "Escribe el nombre del almacén").max(60),
  codigo: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{1,5}$/, "El código son hasta 5 letras o números (AND, CAT)"),
  tipo: z.enum(["taller", "tienda", "deposito"]),
  activo: z.boolean(),
});

/* ── Transferencias ────────────────────────────────────────────────────────── */

export const esquemaTransferencia = z
  .object({
    desdeId: z.uuid("Elige de dónde sale"),
    haciaId: z.uuid("Elige a dónde va"),
    nota: texto(500, "La nota es muy larga"),
    lineas: z
      .array(
        z.object({
          productoId: z.number().int().positive(),
          cantidad: z
            .number({ error: "La cantidad es un número" })
            .int("Se mueve por unidades enteras")
            .positive("Cada producto va con al menos una unidad")
            .max(99_999, "Son demasiadas unidades"),
        }),
      )
      .max(100, "Son demasiados productos para una sola transferencia"),
    sobrantes: z.array(z.string().trim().min(1)).max(100, "Son demasiados sobrantes para una sola transferencia"),
    /** Los avisos de "mover stock" que esta transferencia atiende. */
    faltanteIds: z.array(z.uuid()).max(100).default([]),
    pedidoId: z.uuid().nullable().default(null),
  })
  .superRefine((v, ctx) => {
    if (v.desdeId === v.haciaId) {
      ctx.addIssue({ code: "custom", path: ["haciaId"], message: "El destino tiene que ser otro almacén" });
    }
    if (v.lineas.length === 0 && v.sobrantes.length === 0) {
      ctx.addIssue({ code: "custom", path: ["lineas"], message: "Agrega al menos un producto o un sobrante" });
    }
    const repetidos = v.lineas.filter((l, i) => v.lineas.findIndex((x) => x.productoId === l.productoId) !== i);
    if (repetidos.length) {
      ctx.addIssue({ code: "custom", path: ["lineas"], message: "Un producto está dos veces: junta sus cantidades" });
    }
  });

export type NuevaTransferencia = z.output<typeof esquemaTransferencia>;

export type EstadoTransferencia = "enviada" | "recibida" | "anulada";

export const ESTADOS_TRANSFERENCIA: Record<EstadoTransferencia, string> = {
  enviada: "En camino",
  recibida: "Recibida",
  anulada: "Anulada",
};

export interface TransferenciaResumen {
  id: string;
  codigo: string;
  estado: EstadoTransferencia;
  desdeId: string;
  desde: string;
  haciaId: string;
  hacia: string;
  pedidoCodigo: string | null;
  nota: string | null;
  lineas: { productoId: number; codigo: string | null; nombre: string; cantidad: number; sobrante: string | null }[];
  enviadoPor: string | null;
  enviadoEn: string;
  recibidoPor: string | null;
  recibidoEn: string | null;
  /** Si el paso que toca en Odoo (enviar o recibir) falló. */
  sincronizacion: "pendiente" | "sincronizada" | "error";
  error: string | null;
  /** Si el envío ya salió en Odoo (entonces ya no se anula). */
  salioEnOdoo: boolean;
}
