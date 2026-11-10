/**
 * La configuración de cortes y el catálogo de planchas, del lado del servidor.
 *
 * Como el resto de la app, se lee con la sesión de quien pide: la RLS es la que
 * dice que solo Administración ve precios de corte y catálogo.
 */

import { cache } from "react";
import { clienteServidor } from "./supabase-servidor";
import { leerConfigCortes, type ConfigCortes } from "./cortes/config";
import type { FormatoPlancha, GrupoPlancha } from "./cortes/catalogo";

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
