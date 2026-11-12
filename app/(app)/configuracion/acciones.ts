"use server";

/**
 * Lo que Administración cambia en `/configuracion`: los parámetros del cálculo
 * de cortes y el catálogo de planchas.
 *
 * Las mismas reglas que `app/(app)/acciones.ts`: se escribe con la sesión de
 * quien pide, se revalida con Zod, y un UPDATE que no toca filas se dice.
 */

import { refresh } from "next/cache";
import { z } from "zod";
import { exigirAdmin } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase-servidor";
import { ERROR_SIN_FILAS, mensajeDeError } from "@/lib/errores";
import { CLAVE_CONFIG_CORTES, cargarCatalogoPlanchas } from "@/lib/cortes-servidor";
import { esquemaConfigCortes } from "@/lib/cortes/config";
import { CLAVE_CONFIG_TERMINADOS } from "@/lib/terminados-servidor";
import { esquemaConfigTerminados } from "@/lib/terminados/config";
import { productosPorCodigo } from "@/lib/odoo/catalogos";
import { ErrorOdoo, ODOO_NO_CONFIGURADO, odooConfigurado } from "@/lib/odoo/rpc";
import type { Json } from "@/lib/supabase-tipos";

type Resultado = { ok: true } | { ok: false; error: string };

const fallo = (error: string): Resultado => ({ ok: false, error });

/** Cómo se llama en la pantalla cada valor de la configuración de cortes. */
const ETIQUETAS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^laser\.tabla\.(\d+)\.mm$/, "Corte láser, fila $1: el espesor"],
  [/^laser\.tabla\.(\d+)\.velocidad$/, "Corte láser, fila $1: la velocidad"],
  [/^laser\.tabla\.(\d+)\.pierce$/, "Corte láser, fila $1: la perforación"],
  [/^laser\.tabla\.(\d+)\.pasadas$/, "Corte láser, fila $1: las pasadas"],
  [/^laser\.tabla$/, "La tabla del corte láser"],
  [/^laser\.costoPorMinuto$/, "El costo por minuto del láser"],
  [/^laser\.igvPct$/, "El IGV sobre el servicio"],
  [/^laser\.factorVelocidad$/, "El rendimiento real del láser"],
  [/^laser\.overheadPorPieza$/, "El tiempo extra por pieza"],
  [/^manual\.precios\.(\d+)\.mm$/, "Corte manual, fila $1: el espesor"],
  [/^manual\.precios\.(\d+)\.precio$/, "Corte manual, fila $1: el precio"],
  [/^cobro\.recargoPct$/, "El recargo por fracción"],
  [/^corte\.kerfLaser$/, "El grosor del corte láser"],
  [/^corte\.kerfManual$/, "El grosor del corte manual"],
  [/^corte\.margen$/, "El borde que se descarta"],
  [/^corte\.retazoMin$/, "El sobrante mínimo"],
  [/^servicios\.laser$/, "El código del servicio de corte láser"],
  [/^servicios\.manual$/, "El código del servicio de corte manual"],
];

/**
 * El primer problema, diciendo de qué valor es: aquí hay decenas de números y
 * "Too small" no ayuda a encontrar el que está mal.
 */
function falloDeEsquema(error: z.ZodError): Resultado {
  const primero = error.issues[0];
  if (!primero) return fallo("Los datos no son válidos.");

  // Las filas se cuentan desde 1, como se ven.
  const ruta = primero.path.map((p) => (typeof p === "number" ? p + 1 : String(p))).join(".");
  for (const [patron, etiqueta] of ETIQUETAS) {
    if (patron.test(ruta)) return fallo(`${ruta.replace(patron, etiqueta)} no es un valor válido.`);
  }
  return fallo(primero.message);
}

export async function guardarConfigCortes(entrada: unknown): Promise<Resultado> {
  await exigirAdmin();

  const datos = esquemaConfigCortes.safeParse(entrada);
  if (!datos.success) return falloDeEsquema(datos.error);

  const supabase = await clienteServidor();
  const { error } = await supabase
    .from("configuracion")
    .upsert({ clave: CLAVE_CONFIG_CORTES, valor: datos.data as unknown as Json }, { onConflict: "clave" });
  if (error) return fallo(mensajeDeError(error));

  refresh();
  return { ok: true };
}

/* ── Catálogo de planchas ──────────────────────────────────────────────────── */

const uuid = z.uuid();
const medida = z.coerce.number("Escribe la medida en centímetros").positive("La medida tiene que ser mayor que cero").max(2000);
const codigo = z.string().trim().min(1, "Falta el código de Odoo").max(40);

const esquemaGrupo = z.object({
  id: uuid,
  rotable: z.boolean().optional(),
  sobrantesActivo: z.boolean().optional(),
});

/** Los dos interruptores de un grupo: si se puede girar y si registra sobrantes. */
export async function actualizarGrupoPlancha(entrada: unknown): Promise<Resultado> {
  await exigirAdmin();
  const datos = esquemaGrupo.safeParse(entrada);
  if (!datos.success) return falloDeEsquema(datos.error);
  const { id, rotable, sobrantesActivo } = datos.data;

  const cambios: { rotable?: boolean; sobrantes_activo?: boolean } = {};
  if (rotable !== undefined) cambios.rotable = rotable;
  if (sobrantesActivo !== undefined) cambios.sobrantes_activo = sobrantesActivo;
  if (Object.keys(cambios).length === 0) return { ok: true };

  const supabase = await clienteServidor();
  const { data, error } = await supabase.from("grupos_plancha").update(cambios).eq("id", id).select("id");
  if (error) return fallo(mensajeDeError(error));
  if (!data?.length) return fallo(ERROR_SIN_FILAS);

  refresh();
  return { ok: true };
}

const esquemaSobrantesPorMaterial = z.object({
  material: z.string().trim().min(1),
  activo: z.boolean(),
});

/** Enciende o apaga el piloto de sobrantes para todo un material de una vez. */
export async function activarSobrantesPorMaterial(entrada: unknown): Promise<Resultado> {
  await exigirAdmin();
  const datos = esquemaSobrantesPorMaterial.safeParse(entrada);
  if (!datos.success) return falloDeEsquema(datos.error);

  const supabase = await clienteServidor();
  const { error } = await supabase
    .from("grupos_plancha")
    .update({ sobrantes_activo: datos.data.activo })
    .eq("material", datos.data.material);
  if (error) return fallo(mensajeDeError(error));

  refresh();
  return { ok: true };
}

const esquemaFormato = z.object({
  /** Sin id es un formato nuevo. */
  id: uuid.optional(),
  grupoId: uuid,
  codigo,
  anchoCm: medida,
  largoCm: medida,
  skuCompartido: z.boolean(),
  activo: z.boolean(),
});

export async function guardarFormatoPlancha(entrada: unknown): Promise<Resultado> {
  await exigirAdmin();
  const datos = esquemaFormato.safeParse(entrada);
  if (!datos.success) return falloDeEsquema(datos.error);
  const v = datos.data;

  const fila = {
    grupo_id: v.grupoId,
    codigo_odoo: v.codigo,
    ancho_cm: v.anchoCm,
    largo_cm: v.largoCm,
    sku_compartido: v.skuCompartido,
    activo: v.activo,
  };

  const supabase = await clienteServidor();
  if (v.id) {
    // Quien lo edita a mano lo está confirmando.
    const { data, error } = await supabase
      .from("formatos_plancha")
      .update({ ...fila, por_verificar: false })
      .eq("id", v.id)
      .select("id");
    if (error) return fallo(mensajeDeError(error));
    if (!data?.length) return fallo(ERROR_SIN_FILAS);
  } else {
    const { error } = await supabase.from("formatos_plancha").insert(fila);
    if (error) return fallo(mensajeDeError(error));
  }

  refresh();
  return { ok: true };
}

const esquemaNuevoGrupo = z.object({
  material: z.string().trim().min(2, "Escribe el material").max(80),
  variante: z.string().trim().max(60),
  detalle: z.string().trim().max(80),
  espesorMm: z.coerce.number("Escribe el espesor en milímetros").positive("El espesor tiene que ser mayor que cero").max(200),
  rotable: z.boolean(),
  codigo,
  anchoCm: medida,
  largoCm: medida,
});

/**
 * Un material nuevo con su primer formato. Si el grupo ya existía (mismo
 * material, color y espesor), el formato se le agrega.
 */
export async function crearGrupoPlancha(entrada: unknown): Promise<Resultado> {
  await exigirAdmin();
  const datos = esquemaNuevoGrupo.safeParse(entrada);
  if (!datos.success) return falloDeEsquema(datos.error);
  const v = datos.data;

  const supabase = await clienteServidor();
  const { data: grupo, error } = await supabase
    .from("grupos_plancha")
    .upsert(
      { material: v.material, variante: v.variante, detalle: v.detalle, espesor_mm: v.espesorMm, rotable: v.rotable },
      { onConflict: "material,variante,detalle,espesor_mm" },
    )
    .select("id")
    .single();
  if (error || !grupo) return fallo(mensajeDeError(error));

  const { error: alInsertar } = await supabase.from("formatos_plancha").insert({
    grupo_id: grupo.id,
    codigo_odoo: v.codigo,
    ancho_cm: v.anchoCm,
    largo_cm: v.largoCm,
  });
  if (alInsertar) return fallo(mensajeDeError(alInsertar));

  refresh();
  return { ok: true };
}

export type ResultadoComprobacion =
  | { ok: true; total: number; faltan: string[] }
  | { ok: false; error: string };

/**
 * Busca en Odoo los códigos de todas las planchas activas del catálogo y dice
 * cuáles no existen. Un código que no está es un formato que nunca tendrá precio
 * ni stock: mejor saberlo aquí que en el mostrador.
 */
export async function comprobarCodigosEnOdoo(): Promise<ResultadoComprobacion> {
  await exigirAdmin();
  if (!odooConfigurado()) return { ok: false, error: ODOO_NO_CONFIGURADO };

  const grupos = await cargarCatalogoPlanchas(true);
  const codigos = grupos.flatMap((g) => g.formatos.map((f) => f.codigo));
  try {
    const encontrados = await productosPorCodigo(codigos);
    return { ok: true, total: codigos.length, faltan: codigos.filter((c) => !encontrados.has(c)).sort() };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof ErrorOdoo ? e.message : "No se pudo hablar con Odoo. Intenta de nuevo.",
    };
  }
}

/* ── Productos terminados ──────────────────────────────────────────────────── */

const esquemaAjustesTerminados = esquemaConfigTerminados.extend({
  /** El factor de fabricación de cada tipo, por su código. */
  factores: z.record(
    z.string().regex(/^[A-Z]{2,5}$/),
    z.coerce.number("El factor es un número").positive("El factor tiene que ser mayor que cero").max(100, "Ese factor no es razonable"),
  ),
});

/** La merma, el ancho de letra y el factor de fabricación de cada tipo. */
export async function guardarAjustesTerminados(entrada: unknown): Promise<Resultado> {
  await exigirAdmin();
  const datos = esquemaAjustesTerminados.safeParse(entrada);
  if (!datos.success) return falloDeEsquema(datos.error);
  const { factores, ...config } = datos.data;

  const supabase = await clienteServidor();
  const { error } = await supabase
    .from("configuracion")
    .upsert({ clave: CLAVE_CONFIG_TERMINADOS, valor: config as unknown as Json }, { onConflict: "clave" });
  if (error) return fallo(mensajeDeError(error));

  for (const [codigo, factor] of Object.entries(factores)) {
    const { error: alGuardar } = await supabase.from("pt_tipos").update({ factor_fabricacion: factor }).eq("codigo", codigo);
    if (alGuardar) return fallo(mensajeDeError(alGuardar));
  }

  refresh();
  return { ok: true };
}

const esquemaOpcionTerminado = z.object({
  /** Sin id es una opción nueva. */
  id: z.number().int().positive().optional(),
  clase: z.enum(["personalizacion", "acabado", "complemento"]),
  nombre: z.string().trim().min(2, "Escribe el nombre de la opción").max(120),
  extra: z.coerce.number("El extra es un monto").min(0, "El extra no puede ser negativo").max(1_000_000),
});

/** Una personalización, un acabado o un complemento, con lo que suma al precio. */
export async function guardarOpcionTerminado(entrada: unknown): Promise<Resultado> {
  await exigirAdmin();
  const datos = esquemaOpcionTerminado.safeParse(entrada);
  if (!datos.success) return falloDeEsquema(datos.error);
  const { id, ...fila } = datos.data;

  const supabase = await clienteServidor();
  if (id) {
    const { data, error } = await supabase.from("pt_opciones").update(fila).eq("id", id).select("id");
    if (error) return fallo(mensajeDeError(error));
    if (!data?.length) return fallo(ERROR_SIN_FILAS);
  } else {
    const { error } = await supabase.from("pt_opciones").insert(fila);
    if (error) return fallo(error.code === "23505" ? "Ya hay una opción con ese nombre." : mensajeDeError(error));
  }

  refresh();
  return { ok: true };
}

const medidaCm = z.coerce.number().positive().max(2000).nullable();

const esquemaProductoTerminado = z.object({
  /** Sin código es un producto nuevo: el código lo pone el servidor. */
  codigo: z.string().regex(/^[A-Z]{2,5}-[0-9]{3,}$/).optional(),
  tipo: z.string().regex(/^[A-Z]{2,5}$/, "Elige el tipo"),
  nombre: z.string().trim().min(3, "Escribe el nombre del producto").max(200),
  usos: z.string().trim().max(300).nullable(),
  notas: z.string().trim().max(500).nullable(),
  aMedida: z.boolean(),
  activo: z.boolean(),
  geometria: z.enum(["caja_cerrada", "caja_abierta", "cilindro", "lamina", "lamina_plegada", "letras", "manual"]),
  medidas: z
    .array(
      z
        .object({
          m1: medidaCm,
          m2: medidaCm,
          m3: medidaCm,
          diametro: medidaCm,
          altura: medidaCm,
          alturaMax: medidaCm,
          formato: z.string().trim().max(30).nullable(),
        })
        .refine((m) => m.m1 || m.diametro || m.altura, "Cada medida necesita al menos un número"),
    )
    .max(40),
  espesores: z
    .array(
      z
        .object({
          minMm: z.coerce.number().positive().max(200),
          maxMm: z.coerce.number().positive().max(200),
          aplicacion: z.string().trim().max(60).nullable(),
        })
        .refine((e) => e.maxMm >= e.minMm, "El espesor máximo no puede ser menor que el mínimo"),
    )
    .max(20),
  colores: z.array(z.number().int().positive()).max(40),
  opciones: z.array(z.object({ opcionId: z.number().int().positive(), opcional: z.boolean() })).max(120),
});

export type ResultadoProducto = { ok: true; codigo: string } | { ok: false; error: string };

/**
 * Un producto del catálogo, con sus medidas, espesores, colores y opciones.
 * Las listas se reemplazan enteras: lo que no venga, se quita.
 */
export async function guardarProductoTerminado(entrada: unknown): Promise<ResultadoProducto> {
  await exigirAdmin();
  const datos = esquemaProductoTerminado.safeParse(entrada);
  if (!datos.success) return { ok: false, error: datos.error.issues[0]?.message ?? "Los datos no son válidos." };
  const v = datos.data;
  const falla = (error: string): ResultadoProducto => ({ ok: false, error });

  const supabase = await clienteServidor();
  const fila = {
    tipo: v.tipo,
    nombre: v.nombre,
    usos: v.usos || null,
    notas: v.notas || null,
    a_medida: v.aMedida,
    activo: v.activo,
    geometria: v.geometria,
  };

  let codigo = v.codigo;
  if (codigo) {
    const { data, error } = await supabase.from("pt_productos").update(fila).eq("codigo", codigo).select("codigo");
    if (error) return falla(mensajeDeError(error));
    if (!data?.length) return falla(ERROR_SIN_FILAS);
  } else {
    // El siguiente número del tipo: CAJ-011 después de CAJ-010.
    const { data: previos, error: alLeer } = await supabase.from("pt_productos").select("codigo").like("codigo", `${v.tipo}-%`);
    if (alLeer) return falla(mensajeDeError(alLeer));
    const ultimo = Math.max(0, ...(previos ?? []).map((p) => Number(p.codigo.split("-")[1]) || 0));
    codigo = `${v.tipo}-${String(ultimo + 1).padStart(3, "0")}`;
    const { error } = await supabase.from("pt_productos").insert({ codigo, ...fila });
    if (error) return falla(mensajeDeError(error));
  }

  const reemplazar = async (tabla: "pt_medidas" | "pt_espesores" | "pt_producto_color" | "pt_producto_opcion", filas: object[]) => {
    const { error: alBorrar } = await supabase.from(tabla).delete().eq("producto", codigo!);
    if (alBorrar) return mensajeDeError(alBorrar);
    if (filas.length === 0) return null;
    const { error } = await supabase.from(tabla).insert(filas as never);
    return error ? mensajeDeError(error) : null;
  };

  const problemas = [
    await reemplazar(
      "pt_medidas",
      v.medidas.map((m, i) => ({
        producto: codigo,
        orden: i + 1,
        medida_1_cm: m.m1,
        medida_2_cm: m.m2,
        medida_3_cm: m.m3,
        diametro_cm: m.diametro,
        altura_cm: m.altura,
        altura_max_cm: m.alturaMax,
        formato: m.formato || null,
      })),
    ),
    await reemplazar(
      "pt_espesores",
      v.espesores.map((e, i) => ({
        producto: codigo,
        orden: i + 1,
        espesor_min_mm: e.minMm,
        espesor_max_mm: e.maxMm,
        aplicacion: e.aplicacion || null,
      })),
    ),
    await reemplazar(
      "pt_producto_color",
      [...new Set(v.colores)].map((color_id) => ({ producto: codigo, color_id })),
    ),
    await reemplazar(
      "pt_producto_opcion",
      [...new Map(v.opciones.map((o) => [o.opcionId, o])).values()].map((o) => ({
        producto: codigo,
        opcion_id: o.opcionId,
        opcional: o.opcional,
      })),
    ),
  ].filter(Boolean);
  if (problemas.length) return falla(`El producto se guardó, pero no todo lo suyo: ${problemas[0]}`);

  refresh();
  return { ok: true, codigo };
}
