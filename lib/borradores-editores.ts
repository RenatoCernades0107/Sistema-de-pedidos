import { z } from "zod";
import type { EleccionPlancha, Modalidad } from "./cortes/calcular";
import type { LugarCorte } from "./cortes/guardado";
import type { Accesorio } from "./terminados/calcular";

/**
 * El editor de corte a medida o de producto terminado que quedó abierto a
 * medias dentro de "Nuevo pedido" o "Nueva cotización".
 *
 * Viaja dentro del borrador del formulario (`datos.editor`): al retomarlo, el
 * formulario vuelve a abrir el editor tal como quedó. Se guarda solo mientras
 * cerrarlo pediría confirmación (hay algo elegido o escrito); al agregar el
 * corte o el producto, o al descartarlo, deja de estar.
 *
 * Es lo de pantalla, sin validar: al agregar la línea, el editor calcula todo
 * de nuevo y el servidor lo vuelve a validar al crear.
 */

/** Una fila de piezas tal como se escribe. */
export interface FilaPiezaBorrador {
  ancho: string;
  alto: string;
  cantidad: string;
}

export interface BorradorCorte {
  tipo: "corte";
  /** La línea que se estaba editando; `null`: un corte nuevo. */
  clave: string | null;
  grupoId: string | null;
  modalidad: Modalidad;
  /** Dónde se corta a mano (el láser va siempre al taller). */
  lugar: LugarCorte;
  filas: FilaPiezaBorrador[];
  eleccion: EleccionPlancha | null;
  permitidos: string[] | null;
  ignorarStock: boolean;
}

/** El formulario de producto terminado de siempre (líneas sin diseño CAD). */
export interface BorradorTerminado {
  tipo: "terminado";
  clave: string | null;
  estandar: boolean;
  tipoCodigo: string | null;
  productoCodigo: string | null;
  nombre: string;
  medidaId: string | null;
  medidas: Record<string, string>;
  grupoId: string | null;
  opciones: number[];
  texto: string;
  notas: string;
  areaManual: string;
  accesorios: Accesorio[];
  cantidad: string;
  precio: string;
  reservar: boolean;
  eleccion: EleccionPlancha | null;
}

/**
 * El diseñador CAD de un producto terminado. El diseño en sí (modelo, medidas,
 * material, chat) ya se guarda solo en `disenos`: aquí va cuál era y el pie.
 */
export interface BorradorDiseno {
  tipo: "diseno";
  disenoId: string;
  /** Si el diseño se creó al abrir el diseñador: al descartarlo, se borra. */
  nuevo: boolean;
  clave: string | null;
  productoCodigo: string | null;
  cantidad: string;
  precio: string;
}

export type EditorEnCurso = BorradorCorte | BorradorTerminado | BorradorDiseno;

/* ── Validación ──────────────────────────────────────────────────────────── */

const texto = (max: number) => z.string().max(max);
const codigo = texto(100).nullable();
const eleccion = z.object({ tipo: z.enum(["formato", "sobrante"]), codigo: texto(100) }).nullable();

const esquemaCorte = z.object({
  tipo: z.literal("corte"),
  clave: codigo,
  grupoId: texto(60).nullable(),
  modalidad: z.enum(["laser", "manual"]),
  lugar: z.enum(["taller", "tienda"]),
  filas: z.array(z.object({ ancho: texto(40), alto: texto(40), cantidad: texto(40) })).max(500),
  eleccion,
  permitidos: z.array(texto(100)).max(100).nullable(),
  ignorarStock: z.boolean(),
}) satisfies z.ZodType<BorradorCorte>;

const esquemaTerminado = z.object({
  tipo: z.literal("terminado"),
  clave: codigo,
  estandar: z.boolean(),
  tipoCodigo: codigo,
  productoCodigo: codigo,
  nombre: texto(300),
  medidaId: texto(100).nullable(),
  medidas: z.record(texto(20), texto(40)),
  grupoId: texto(60).nullable(),
  opciones: z.array(z.number().int()).max(200),
  texto: texto(5000),
  notas: texto(5000),
  areaManual: texto(40),
  accesorios: z
    .array(
      z.object({
        productoId: z.number().int(),
        codigo: texto(100).nullable(),
        nombre: texto(300),
        unidad: texto(60).nullable(),
        cantidad: z.number().finite(),
        precio: z.number().finite(),
      }),
    )
    .max(200),
  cantidad: texto(40),
  precio: texto(40),
  reservar: z.boolean(),
  eleccion,
}) satisfies z.ZodType<BorradorTerminado>;

const esquemaDiseno = z.object({
  tipo: z.literal("diseno"),
  disenoId: z.uuid(),
  nuevo: z.boolean(),
  clave: codigo,
  productoCodigo: codigo,
  cantidad: texto(40),
  precio: texto(40),
}) satisfies z.ZodType<BorradorDiseno>;

export const esquemaEditorEnCurso = z.discriminatedUnion("tipo", [esquemaCorte, esquemaTerminado, esquemaDiseno]);

/* ── Lo que se ve en la lista ────────────────────────────────────────────── */

export type ClaseEnCurso = "corte" | "terminado";

/** Qué quedó a medio armar, para la lista de borradores. */
export const claseEnCurso = (e: EditorEnCurso | null | undefined): ClaseEnCurso | undefined =>
  !e ? undefined : e.tipo === "corte" ? "corte" : "terminado";

export const TEXTO_EN_CURSO: Record<ClaseEnCurso, string> = {
  corte: "un corte a medio armar",
  terminado: "un producto terminado a medio armar",
};

/* ── Del editor al borrador y de vuelta ──────────────────────────────────── */

/** Las filas con algo escrito: las vacías no cuentan como contenido. */
export const filasEscritas = (filas: FilaPiezaBorrador[]) => filas.filter((f) => f.ancho || f.alto || f.cantidad);

/** Cómo arranca el editor de corte: el borrador manda; si no, la línea que se edita; si no, vacío. */
export function estadoInicialCorte(
  inicial: {
    grupoId: string;
    modalidad: Modalidad;
    lugar?: LugarCorte | null;
    piezas: { ancho: number; alto: number; cantidad: number }[];
    eleccion?: EleccionPlancha | null;
    formatosPermitidos?: string[] | null;
  } | null,
  borrador: BorradorCorte | null = null,
): Omit<BorradorCorte, "tipo" | "clave"> {
  if (borrador) {
    const { grupoId, modalidad, lugar, filas, eleccion, permitidos, ignorarStock } = borrador;
    return {
      grupoId,
      modalidad,
      lugar,
      filas: filas.length > 0 ? filas : [{ ancho: "", alto: "", cantidad: "" }],
      eleccion,
      permitidos,
      ignorarStock,
    };
  }
  return {
    grupoId: inicial?.grupoId ?? null,
    modalidad: inicial?.modalidad ?? "laser",
    lugar: inicial?.lugar ?? "tienda",
    filas: inicial
      ? inicial.piezas.map((p) => ({ ancho: String(p.ancho), alto: String(p.alto), cantidad: String(p.cantidad) }))
      : [{ ancho: "", alto: "", cantidad: "" }],
    eleccion: inicial?.eleccion ?? null,
    permitidos: inicial?.formatosPermitidos ?? null,
    ignorarStock: false,
  };
}

/**
 * ¿El corte en pantalla difiere de cómo abrió el editor (la línea o vacío)?
 * Es lo que hace que cerrar pida confirmación y lo que se guarda en el borrador.
 */
export function corteCambiado(
  actual: Omit<BorradorCorte, "tipo" | "clave">,
  alAbrir: Omit<BorradorCorte, "tipo" | "clave">,
): boolean {
  return (
    actual.grupoId !== alAbrir.grupoId ||
    actual.modalidad !== alAbrir.modalidad ||
    actual.lugar !== alAbrir.lugar ||
    JSON.stringify(actual.eleccion) !== JSON.stringify(alAbrir.eleccion) ||
    JSON.stringify(actual.permitidos) !== JSON.stringify(alAbrir.permitidos) ||
    JSON.stringify(filasEscritas(actual.filas)) !== JSON.stringify(filasEscritas(alAbrir.filas))
  );
}
