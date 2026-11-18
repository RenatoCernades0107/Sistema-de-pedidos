/**
 * Los almacenes del lado del servidor: leerlos, crearlos en Odoo y saber qué
 * ubicación y qué operaciones de Odoo corresponden a cada uno.
 *
 * Los lee cualquier rol (el taller anota a qué almacén van sus sobrantes); los
 * crea y cambia quien gestiona el stock (Administración y Logística).
 */

import { cache } from "react";
import { type Almacen, type SincronizacionAlmacen, type TipoAlmacen } from "./almacenes";
import type { LugarCorte } from "./cortes/guardado";
import { mensajeDeError } from "./errores";
import { asegurarAlmacen, leerAlmacen, type AlmacenOdoo } from "./odoo/almacenes";
import { ErrorOdoo, ODOO_NO_CONFIGURADO, odooConfigurado } from "./odoo/rpc";
import { clienteServidor } from "./supabase-servidor";

const COLUMNAS =
  "id, nombre, codigo, tipo, activo, orden, odoo_warehouse_id, odoo_ubicacion_id, sincronizacion, error_sincronizacion";

interface Fila {
  id: string;
  nombre: string;
  codigo: string;
  tipo: string;
  activo: boolean;
  orden: number;
  odoo_warehouse_id: number | null;
  odoo_ubicacion_id: number | null;
  sincronizacion: SincronizacionAlmacen;
  error_sincronizacion: string | null;
}

const deFila = (f: Fila): Almacen => ({
  id: f.id,
  nombre: f.nombre,
  codigo: f.codigo,
  tipo: f.tipo as TipoAlmacen,
  activo: f.activo,
  orden: f.orden,
  odooWarehouseId: f.odoo_warehouse_id,
  odooUbicacionId: f.odoo_ubicacion_id,
  sincronizacion: f.sincronizacion,
  errorSincronizacion: f.error_sincronizacion,
});

/** Todos los almacenes, en su orden. Los inactivos también: un sobrante viejo puede estar en uno. */
export const cargarAlmacenes = cache(async (): Promise<Almacen[]> => {
  const supabase = await clienteServidor();
  const { data, error } = await supabase.from("almacenes").select(COLUMNAS).order("orden").order("nombre");
  if (error) throw new Error(`No se pudieron leer los almacenes: ${error.message}`);
  return ((data ?? []) as Fila[]).map(deFila);
});

/** El taller o la tienda. */
export async function almacenPorTipo(tipo: LugarCorte): Promise<Almacen> {
  const a = (await cargarAlmacenes()).find((x) => x.tipo === tipo && x.activo);
  if (!a) throw new ErrorOdoo(`No hay ningún almacén marcado como ${tipo === "taller" ? "taller" : "tienda"}.`);
  return a;
}

/* ── Odoo ──────────────────────────────────────────────────────────────────── */

/**
 * El almacén de Odoo de un almacén de la app. Si todavía no existe en Odoo (o lo
 * borraron), lo crea, y anota los ids en la tabla (si la sesión puede
 * escribirla: el taller no, y no importa, la próxima vez se encuentra por el
 * código). Se comprueba contra Odoo una vez por petición: los ids no se guardan
 * en memoria, que quedarían viejos si alguien toca el almacén en Odoo.
 */
export async function odooDeAlmacen(a: Almacen): Promise<AlmacenOdoo> {
  if (!odooConfigurado()) throw new ErrorOdoo(ODOO_NO_CONFIGURADO);
  return odooPorPeticion(a.id, a.nombre, a.codigo, a.odooWarehouseId);
}

const odooPorPeticion = cache(
  async (id: string, nombre: string, codigo: string, warehouseId: number | null): Promise<AlmacenOdoo> => {
    if (warehouseId) {
      try {
        return await leerAlmacen(warehouseId, codigo);
      } catch (e) {
        // Lo borraron en Odoo: se vuelve a buscar (o crear) por su código.
        if (!(e instanceof ErrorOdoo)) throw e;
      }
    }
    const creado = await asegurarAlmacen({ nombre, codigo });
    await anotar(id, {
      odoo_warehouse_id: creado.warehouseId,
      odoo_ubicacion_id: creado.ubicacionId,
      sincronizacion: "sincronizada",
      error_sincronizacion: null,
    });
    return creado;
  },
);

async function anotar(
  id: string,
  cambios: {
    odoo_warehouse_id?: number;
    odoo_ubicacion_id?: number;
    sincronizacion: SincronizacionAlmacen;
    error_sincronizacion: string | null;
  },
) {
  const supabase = await clienteServidor();
  await supabase.from("almacenes").update(cambios).eq("id", id);
}

/** Por su id en la app. */
export async function odooDeAlmacenId(almacenId: string): Promise<AlmacenOdoo> {
  const a = (await cargarAlmacenes()).find((x) => x.id === almacenId);
  if (!a) throw new ErrorOdoo("Ese almacén ya no existe.");
  return odooDeAlmacen(a);
}

/** El del taller o la tienda, ya en Odoo. */
export async function odooDeLugar(lugar: LugarCorte): Promise<AlmacenOdoo> {
  return odooDeAlmacen(await almacenPorTipo(lugar));
}

const mensajeOdoo = (e: unknown) => {
  if (e instanceof ErrorOdoo) return e.message;
  console.error("[almacenes] odoo", e);
  return "Algo falló al hablar con Odoo.";
};

/**
 * Crea en Odoo los almacenes activos que todavía no están, y anota el resultado
 * de cada uno. Devuelve los problemas, en palabras.
 */
export async function asegurarAlmacenesEnOdoo(): Promise<string[]> {
  if (!odooConfigurado()) return [ODOO_NO_CONFIGURADO];
  const problemas: string[] = [];
  for (const a of (await cargarAlmacenes()).filter((x) => x.activo)) {
    try {
      await odooDeAlmacen(a);
    } catch (e) {
      const error = mensajeOdoo(e);
      problemas.push(`${a.nombre}: ${error}`);
      await anotar(a.id, { sincronizacion: "error", error_sincronizacion: error });
    }
  }
  return problemas;
}

export interface AlmacenEditado {
  id: string | null;
  nombre: string;
  codigo: string;
  tipo: TipoAlmacen;
  activo: boolean;
}

/**
 * Crea o cambia un almacén y, si es nuevo, lo crea en Odoo. El código no cambia
 * una vez que el almacén está en Odoo: es por donde se lo encuentra.
 */
export async function guardarAlmacen(v: AlmacenEditado): Promise<{ ok: true; aviso?: string } | { ok: false; error: string }> {
  const supabase = await clienteServidor();
  const todos = await cargarAlmacenes();
  const previo = v.id ? todos.find((a) => a.id === v.id) : null;
  if (v.id && !previo) return { ok: false, error: "Ese almacén ya no existe." };
  if (previo?.odooWarehouseId && previo.codigo !== v.codigo) {
    return { ok: false, error: "El código no se puede cambiar: el almacén ya está en Odoo con ese código." };
  }
  if ((v.tipo === "taller" || v.tipo === "tienda") && todos.some((a) => a.tipo === v.tipo && a.id !== v.id)) {
    return { ok: false, error: `Ya hay un almacén marcado como ${v.tipo}. Cambia ese primero a depósito.` };
  }

  const fila = { nombre: v.nombre, codigo: v.codigo, tipo: v.tipo, activo: v.activo };
  const { data, error } = previo
    ? await supabase.from("almacenes").update(fila).eq("id", previo.id).select(COLUMNAS).single()
    : await supabase
        .from("almacenes")
        .insert({ ...fila, orden: Math.max(0, ...todos.map((a) => a.orden)) + 1 })
        .select(COLUMNAS)
        .single();
  if (error || !data) {
    const texto = mensajeDeError(error);
    if (/duplicate key|unique/i.test(error?.message ?? "")) {
      return { ok: false, error: "Ya hay un almacén con ese nombre o ese código." };
    }
    return { ok: false, error: texto };
  }

  const guardado = deFila(data as Fila);
  if (!guardado.activo || guardado.odooWarehouseId) return { ok: true };
  try {
    await odooDeAlmacen(guardado);
    return { ok: true };
  } catch (e) {
    const error = mensajeOdoo(e);
    await anotar(guardado.id, { sincronizacion: "error", error_sincronizacion: error });
    return { ok: true, aviso: `Se guardó, pero no se creó en Odoo: ${error}` };
  }
}
