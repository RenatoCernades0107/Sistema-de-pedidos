/**
 * Los catálogos que alimentan los desplegables: trabajadores del taller y ubigeo.
 *
 * Hasta la Fase 3 eran constantes en el código (`TRABAJADORES` en `dominio.ts`,
 * `DEPARTAMENTOS` en `datos.ts`) porque nada se escribía. Ahora sí: `responsable_id`
 * es una FK a `trabajadores` y el envío guarda `departamento_id`/`provincia_id` con
 * una FK compuesta, así que la app necesita los ids reales, no los nombres.
 *
 * Los tres los lee cualquier rol con perfil activo (`catalogo_lectura` y
 * `trabajadores_lectura` en la migración de RLS), así que van con la sesión de
 * quien mira, como todo lo demás.
 */

import { cache } from "react";
import { clienteServidor } from "./supabase-servidor";

export interface Trabajador {
  id: string;
  nombre: string;
}

export interface Provincia {
  id: number;
  nombre: string;
}

export interface Departamento {
  id: number;
  nombre: string;
  provincias: Provincia[];
}

/** Solo los que siguen en el taller: a un inactivo no se le asignan pedidos nuevos. */
export const cargarTrabajadores = cache(async (): Promise<Trabajador[]> => {
  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from("trabajadores")
    .select("id, nombre")
    .eq("activo", true)
    .order("nombre");

  if (error) throw new Error(`No se pudieron leer los trabajadores: ${error.message}`);
  return data ?? [];
});

/**
 * Los 25 departamentos con sus 196 provincias, anidadas para el select encadenado.
 * Son 221 filas fijas: se piden de una vez y se arman en memoria, no una consulta
 * por departamento.
 */
export const cargarUbigeo = cache(async (): Promise<Departamento[]> => {
  const supabase = await clienteServidor();

  const [departamentos, provincias] = await Promise.all([
    supabase.from("departamentos").select("id, nombre").order("nombre"),
    supabase.from("provincias").select("id, nombre, departamento_id").order("nombre"),
  ]);

  if (departamentos.error) {
    throw new Error(`No se pudieron leer los departamentos: ${departamentos.error.message}`);
  }
  if (provincias.error) {
    throw new Error(`No se pudieron leer las provincias: ${provincias.error.message}`);
  }

  const porDepartamento = new Map<number, Provincia[]>();
  for (const p of provincias.data ?? []) {
    const lista = porDepartamento.get(p.departamento_id) ?? [];
    lista.push({ id: p.id, nombre: p.nombre });
    porDepartamento.set(p.departamento_id, lista);
  }

  return (departamentos.data ?? []).map((d) => ({
    id: d.id,
    nombre: d.nombre,
    provincias: porDepartamento.get(d.id) ?? [],
  }));
});
