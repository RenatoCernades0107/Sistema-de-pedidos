/**
 * La configuración de cortes y el catálogo de planchas, del lado del servidor.
 *
 * Como el resto de la app, se lee con la sesión de quien pide: la RLS es la que
 * dice que solo Administración ve precios de corte y catálogo.
 */

import { cache } from "react";
import { clienteServidor } from "./supabase-servidor";
import { calcularCorte } from "./cortes/calcular";
import { colorDe, pideColor, type FormatoPlancha, type GrupoPlancha } from "./cortes/catalogo";
import { leerConfigCortes, type ConfigCortes } from "./cortes/config";
import { guardarCorte, resumenPiezas, tituloCorte, type CorteGuardado } from "./cortes/guardado";
import type { NuevaLineaCorte } from "./esquemas";
import { productosPorCodigo } from "./odoo/catalogos";
import { contenedoresDe } from "./sobrantes";
import { sobrantesDisponibles } from "./sobrantes-servidor";

export const CLAVE_CONFIG_CORTES = "cortes";

/** Lo guardado, completado con los defectos. Si no hay nada guardado, los defectos. */
export const cargarConfigCortes = cache(async (): Promise<ConfigCortes> => {
  const supabase = await clienteServidor();
  const { data } = await supabase
    .from("configuracion")
    .select("valor")
    .eq("clave", CLAVE_CONFIG_CORTES)
    .maybeSingle();
  return leerConfigCortes(data?.valor ?? null);
});

interface FilaGrupo {
  id: string;
  material: string;
  variante: string;
  detalle: string;
  espesor_mm: number;
  rotable: boolean;
  sobrantes_activo: boolean;
  formatos_plancha: {
    id: string;
    codigo_odoo: string;
    ancho_cm: number;
    largo_cm: number;
    sku_compartido: boolean;
    por_verificar: boolean;
    nota: string | null;
    activo: boolean;
  }[];
}

const deFormato = (f: FilaGrupo["formatos_plancha"][number]): FormatoPlancha => ({
  id: f.id,
  codigo: f.codigo_odoo,
  anchoCm: Number(f.ancho_cm),
  largoCm: Number(f.largo_cm),
  skuCompartido: f.sku_compartido,
  porVerificar: f.por_verificar,
  nota: f.nota,
  activo: f.activo,
});

const deGrupo = (g: FilaGrupo): GrupoPlancha => ({
  id: g.id,
  material: g.material,
  variante: g.variante,
  detalle: g.detalle,
  espesorMm: Number(g.espesor_mm),
  rotable: g.rotable,
  sobrantesActivo: g.sobrantes_activo,
  formatos: (g.formatos_plancha ?? [])
    .map(deFormato)
    .sort((a, b) => a.anchoCm * a.largoCm - b.anchoCm * b.largoCm || a.codigo.localeCompare(b.codigo)),
});

const COLUMNAS = `
  id, material, variante, detalle, espesor_mm, rotable, sobrantes_activo,
  formatos_plancha ( id, codigo_odoo, ancho_cm, largo_cm, sku_compartido, por_verificar, nota, activo )
`;

/**
 * Todos los grupos con sus formatos, ordenados como se leen: material, color,
 * espesor. `soloActivos` quita los formatos dados de baja y los grupos que se
 * quedan sin ninguno: es lo que ve quien cotiza.
 */
export const cargarCatalogoPlanchas = cache(async (soloActivos = false): Promise<GrupoPlancha[]> => {
  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from("grupos_plancha")
    .select(COLUMNAS)
    .order("material")
    .order("variante")
    .order("detalle")
    .order("espesor_mm");
  if (error) throw new Error(`No se pudo leer el catálogo de planchas: ${error.message}`);

  const grupos = ((data ?? []) as unknown as FilaGrupo[]).map(deGrupo);
  if (!soloActivos) return grupos;
  return grupos
    .map((g) => ({ ...g, formatos: g.formatos.filter((f) => f.activo) }))
    .filter((g) => g.formatos.length > 0);
});

export async function cargarGrupoPlancha(id: string): Promise<GrupoPlancha | null> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase.from("grupos_plancha").select(COLUMNAS).eq("id", id).maybeSingle();
  if (error) throw new Error(`No se pudo leer el grupo de planchas: ${error.message}`);
  return data ? deGrupo(data as unknown as FilaGrupo) : null;
}

/* ── Un corte, calculado por el servidor ───────────────────────────────────── */

/** La línea de corte lista para `crear_cotizacion`, en las columnas de la tabla. */
export interface FilaDeCorte {
  tipo: "corte";
  odoo_product_id: number;
  producto_nombre: string;
  producto_codigo: string | null;
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  importe: number;
  corte: CorteGuardado;
}

const redondear2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Lo que cuesta cada formato de un grupo según Odoo, por su código. Del índice
 * en memoria si ya está cargado: es lo que deja calcular mientras se escribe.
 */
export async function preciosDeGrupo(grupo: GrupoPlancha) {
  const productos = await productosPorCodigo(grupo.formatos.map((f) => f.codigo));
  return new Map(
    grupo.formatos
      .filter((f) => productos.has(f.codigo))
      .map((f) => [f.codigo, { productoId: productos.get(f.codigo)!.id, precio: productos.get(f.codigo)!.precio }]),
  );
}

/**
 * Rehace el cálculo de un corte que llega del navegador. De allá vienen el
 * material, las piezas y el formato elegido; el precio de la plancha lo dice
 * Odoo y el del corte la configuración, leídos aquí.
 *
 * Si el total no coincide con el que vio quien cotiza —cambió un precio
 * mientras armaba el pedido—, no se guarda: se le pide que lo revise.
 */
export async function prepararCorte(
  linea: NuevaLineaCorte,
): Promise<{ ok: true; fila: FilaDeCorte } | { ok: false; error: string }> {
  const fallo = (error: string) => ({ ok: false as const, error });

  const [grupo, config] = await Promise.all([cargarGrupoPlancha(linea.grupoId), cargarConfigCortes()]);
  if (!grupo) return fallo("Ese material ya no está en el catálogo de planchas. Vuelve a elegirlo.");

  const formato = grupo.formatos.find((f) => f.codigo === linea.formatoCodigo && f.activo);
  if (!formato) return fallo(`El formato ${linea.formatoCodigo} ya no está disponible para ese material.`);

  const codigoServicio = config.servicios[linea.modalidad];
  const productos = await productosPorCodigo([formato.codigo, codigoServicio]);
  const plancha = productos.get(formato.codigo);
  if (!plancha) return fallo(`La plancha ${formato.codigo} no existe en Odoo. Revisa el código en Configuración.`);
  const servicio = productos.get(codigoServicio);
  if (!servicio) {
    return fallo(`El servicio de corte ${codigoServicio} no existe en Odoo. Revisa el código en Configuración.`);
  }

  // Con el piloto, el acomodo usa primero los sobrantes del almacén. El precio no cambia.
  const delAlmacen = grupo.sobrantesActivo
    ? contenedoresDe(await sobrantesDisponibles(grupo.id), pideColor(grupo) ? (linea.color ?? null) : null)
    : [];
  const calculo = calcularCorte(
    { piezas: linea.piezas, espesorMm: grupo.espesorMm, modalidad: linea.modalidad, rotable: grupo.rotable },
    { codigo: formato.codigo, ancho: formato.anchoCm, alto: formato.largoCm, precio: plancha.precio },
    config,
    delAlmacen,
  );
  if (calculo.problema) return fallo(calculo.problema);
  if (Math.abs(calculo.total - linea.totalMostrado) > 0.01) {
    return fallo(
      `El precio del corte cambió mientras lo armabas (ahora es S/ ${calculo.total.toFixed(2)}). ` +
        "Ábrelo de nuevo para revisarlo.",
    );
  }

  const corte = guardarCorte(
    {
      grupoId: grupo.id,
      material: grupo.material,
      // Con un código para todos los colores, vale el que se pidió.
      color: (pideColor(grupo) && linea.color) || colorDe(grupo),
      espesorMm: grupo.espesorMm,
      modalidad: linea.modalidad,
      rotable: grupo.rotable,
      piezas: linea.piezas,
      servicio: { productoId: servicio.id, codigo: codigoServicio, nombre: servicio.nombre },
      sobrantes: grupo.sobrantesActivo,
    },
    calculo,
  );

  return {
    ok: true,
    fila: {
      tipo: "corte",
      odoo_product_id: plancha.id,
      producto_nombre: plancha.nombre,
      producto_codigo: plancha.codigo,
      descripcion: `${tituloCorte(corte)}: ${resumenPiezas(corte.piezas)}`,
      cantidad: corte.planchas.length,
      // Referencial: lo que vale es el importe de la línea.
      precio_unitario: redondear2(corte.montoMaterial / corte.planchas.length),
      importe: corte.total,
      corte,
    },
  };
}
