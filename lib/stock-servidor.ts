/**
 * El stock del lado del servidor: lo que hay de cada plancha y cada accesorio en
 * cada almacén, los ingresos (compras y ajustes), los productos nuevos y los
 * precios.
 *
 * Lo que manda es Odoo: aquí solo se guarda lo necesario para no perder lo que
 * alguien escribió si Odoo falla (los ingresos), y lo que Odoo no tiene (las
 * categorías de los accesorios). Los precios y el stock se leen de Odoo.
 */

import { cache } from "react";
import type { Almacen } from "./almacenes";
import { asegurarAlmacenesEnOdoo, cargarAlmacenes, odooDeAlmacen, odooDeAlmacenId } from "./almacenes-servidor";
import { cargarCatalogoPlanchas } from "./cortes-servidor";
import type { GrupoPlancha } from "./cortes/catalogo";
import { mensajeDeError } from "./errores";
import {
  filasDePlanchas,
  nombreDePlancha,
  type AccesorioInventario,
  type CategoriaAccesorio,
  type IngresoResumen,
  type NuevoIngreso,
  type NuevoProducto,
  type PlanchaInventario,
  type StockFila,
} from "./inventario";
import { ajustarInventario, ingresarCompra, stockPorAlmacen, type UbicacionDeAlmacen } from "./odoo/almacenes";
import { indiceProductos, productosPorCodigo, productosPorId } from "./odoo/catalogos";
import { origenDe } from "./odoo/pedidos-venta";
import {
  cambiarPrecio,
  codigosConPrefijo,
  costosPorId,
  crearProductoAlmacenable,
  siguienteDe,
} from "./odoo/productos";
import { ErrorOdoo, ODOO_NO_CONFIGURADO, odooConfigurado } from "./odoo/rpc";
import type { ProductoOdoo } from "./odoo/tipos";
import { precioDeSobrante, type Sobrante } from "./sobrantes";
import { clienteServidor } from "./supabase-servidor";

type Resultado = { ok: true; codigo?: string; aviso?: string } | { ok: false; error: string };

const mensajeOdoo = (e: unknown, contexto: string) => {
  if (e instanceof ErrorOdoo) return e.message;
  console.error(`[stock] ${contexto}`, e);
  return "Algo falló al hablar con Odoo.";
};

/* ── La configuración del almacén ──────────────────────────────────────────── */

export interface ConfigAlmacen {
  /** Por cuánto se multiplica el costo de un sobrante para proponer su precio. */
  factorSobrante: number;
  /** Con qué empieza el código de una plancha nueva (PL0001). */
  prefijoPlancha: string;
}

export const CONFIG_ALMACEN_DEFECTO: ConfigAlmacen = { factorSobrante: 1.5, prefijoPlancha: "PL" };

export function leerConfigAlmacen(valor: unknown): ConfigAlmacen {
  const v = (valor ?? {}) as Partial<Record<keyof ConfigAlmacen, unknown>>;
  const factor = Number(v.factorSobrante);
  const prefijo = typeof v.prefijoPlancha === "string" ? v.prefijoPlancha.trim().toUpperCase() : "";
  return {
    factorSobrante: Number.isFinite(factor) && factor > 0 ? factor : CONFIG_ALMACEN_DEFECTO.factorSobrante,
    prefijoPlancha: /^[A-Z]{2,5}$/.test(prefijo) ? prefijo : CONFIG_ALMACEN_DEFECTO.prefijoPlancha,
  };
}

/** La lee cualquier rol, por la función de ventanilla (`config_almacen()`). */
export const cargarConfigAlmacen = cache(async (): Promise<ConfigAlmacen> => {
  const supabase = await clienteServidor();
  const { data } = await supabase.rpc("config_almacen");
  return leerConfigAlmacen(data);
});

/* ── El inventario ─────────────────────────────────────────────────────────── */

export interface Inventario {
  almacenes: Almacen[];
  planchas: PlanchaInventario[];
  accesorios: AccesorioInventario[];
  categorias: CategoriaAccesorio[];
  /** Por qué no hay stock o precios, si Odoo no respondió. */
  errorOdoo: string | null;
  /** Lo que hay en Odoo fuera de los almacenes de la app (el almacén anterior). */
  hayFuera: boolean;
}

export const cargarCategorias = cache(async (): Promise<CategoriaAccesorio[]> => {
  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from("categorias_accesorio")
    .select("id, nombre, prefijo, orden")
    .order("orden")
    .order("nombre");
  if (error) throw new Error(`No se pudieron leer las categorías: ${error.message}`);
  return data ?? [];
});

async function cargarAccesorios() {
  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from("accesorios")
    .select("id, codigo_odoo, categoria_id, activo")
    .order("codigo_odoo");
  if (error) throw new Error(`No se pudieron leer los accesorios: ${error.message}`);
  return data ?? [];
}

/**
 * Las ubicaciones de Odoo de los almacenes activos. Quien gestiona el stock crea
 * en Odoo los que falten; el resto solo ve los que ya están.
 */
async function ubicacionesDeAlmacenes(almacenes: Almacen[], crear: boolean): Promise<{ ubicaciones: UbicacionDeAlmacen[]; problemas: string[] }> {
  const problemas = crear ? await asegurarAlmacenesEnOdoo() : [];
  const ubicaciones: UbicacionDeAlmacen[] = [];
  for (const a of almacenes.filter((x) => x.activo)) {
    if (crear) {
      try {
        ubicaciones.push({ almacenId: a.id, ubicacionId: (await odooDeAlmacen(a)).ubicacionId });
      } catch {
        // Ya está en `problemas`.
      }
    } else if (a.odooUbicacionId) {
      ubicaciones.push({ almacenId: a.id, ubicacionId: a.odooUbicacionId });
    }
  }
  return { ubicaciones, problemas };
}

/**
 * Todas las planchas y los accesorios, con su precio y su stock en cada
 * almacén. Si Odoo no responde, el catálogo se ve igual, sin stock ni precios.
 */
export async function cargarInventario(opciones: { verPrecios: boolean; gestionaStock: boolean }): Promise<Inventario> {
  const [almacenes, catalogo, accesorios, categorias] = await Promise.all([
    cargarAlmacenes(),
    cargarCatalogoPlanchas(),
    cargarAccesorios(),
    cargarCategorias(),
  ]);

  const filas = filasDePlanchas(catalogo);
  const codigoDeFormato = new Map(catalogo.flatMap((g) => g.formatos.map((f) => [f.id, f.codigo] as const)));
  const codigos = [...codigoDeFormato.values(), ...accesorios.map((a) => a.codigo_odoo)];

  let productos = new Map<string, ProductoOdoo>();
  let stock = new Map<number, StockFila>();
  let errorOdoo: string | null = null;
  if (!odooConfigurado()) {
    errorOdoo = ODOO_NO_CONFIGURADO;
  } else {
    try {
      const { ubicaciones, problemas } = await ubicacionesDeAlmacenes(almacenes, opciones.gestionaStock);
      if (problemas.length) errorOdoo = problemas.join(" · ");
      productos = await productosPorCodigo(codigos);
      stock = await stockPorAlmacen(
        [...productos.values()].map((p) => p.id),
        ubicaciones,
      );
    } catch (e) {
      errorOdoo = mensajeOdoo(e, "inventario");
    }
  }

  const deOdoo = (codigo: string) => {
    const p = productos.get(codigo);
    return {
      productoId: p?.id ?? null,
      codigo,
      nombre: p?.nombre ?? "(no está en Odoo)",
      precio: opciones.verPrecios && p ? p.precio : null,
      unidad: p?.unidad ?? null,
      stock: p ? (stock.get(p.id) ?? null) : null,
    };
  };

  const nombreCategoria = new Map(categorias.map((c) => [c.id, c.nombre]));
  return {
    almacenes,
    planchas: filas.map((f) => ({ ...f, ...deOdoo(codigoDeFormato.get(f.formatoId)!) })),
    accesorios: accesorios.map((a) => ({
      id: a.id,
      categoriaId: a.categoria_id,
      categoria: nombreCategoria.get(a.categoria_id) ?? "(sin categoría)",
      activo: a.activo,
      ...deOdoo(a.codigo_odoo),
    })),
    categorias,
    errorOdoo,
    hayFuera: [...stock.values()].some((s) => Math.abs(s.fuera) > 0.0001),
  };
}

/**
 * El precio de cada sobrante, por su código: el que fijó Administración o, si
 * no, el costo de su pedazo de plancha por el factor. Si Odoo no responde, solo
 * los fijados.
 */
export async function preciosDeSobrantes(sobrantes: Sobrante[], catalogo: GrupoPlancha[]): Promise<Record<string, number | null>> {
  const config = await cargarConfigAlmacen();
  // El formato de referencia de cada grupo: el primero activo (el más usado).
  const base = new Map(
    catalogo.map((g) => [g.id, g.formatos.find((f) => f.activo) ?? g.formatos[0] ?? null] as const),
  );
  let costoDe = new Map<string, number>();
  if (odooConfigurado() && sobrantes.some((s) => s.precioVenta === null)) {
    try {
      const codigos = [...new Set([...base.values()].filter((f) => f).map((f) => f!.codigo))];
      const productos = await productosPorCodigo(codigos);
      const costos = await costosPorId([...productos.values()].map((p) => p.id));
      costoDe = new Map(
        [...productos.entries()].flatMap(([codigo, p]) => (costos.has(p.id) ? [[codigo, costos.get(p.id)!] as const] : [])),
      );
    } catch (e) {
      mensajeOdoo(e, "costos de sobrantes");
    }
  }
  const salida: Record<string, number | null> = {};
  for (const s of sobrantes) {
    const f = base.get(s.grupoId);
    salida[s.codigo] = precioDeSobrante(
      s,
      f ? { anchoCm: f.anchoCm, largoCm: f.largoCm, costo: costoDe.get(f.codigo) ?? null } : null,
      config.factorSobrante,
    );
  }
  return salida;
}

/* ── Ingresos ──────────────────────────────────────────────────────────────── */

/** Los últimos ingresos, con sus líneas. */
export async function cargarIngresos(limite = 60): Promise<IngresoResumen[]> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from("ingresos_stock")
    .select(
      `id, codigo, tipo, proveedor_nombre, documento, nota, sincronizacion, error_sincronizacion, creado_en,
       almacen:almacenes ( nombre ),
       creador:usuarios!ingresos_stock_creado_por_fkey ( nombre ),
       ingresos_stock_lineas ( posicion, codigo, nombre, cantidad, costo_unitario, cantidad_anterior )`,
    )
    .order("creado_en", { ascending: false })
    .limit(limite);
  if (error) throw new Error(`No se pudieron leer los ingresos: ${error.message}`);
  const uno = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
  return (data ?? []).map((f) => ({
    id: f.id,
    codigo: f.codigo,
    tipo: f.tipo as IngresoResumen["tipo"],
    almacen: uno(f.almacen)?.nombre ?? "(almacén borrado)",
    proveedor: f.proveedor_nombre,
    documento: f.documento,
    nota: f.nota,
    lineas: [...(f.ingresos_stock_lineas ?? [])]
      .sort((a, b) => a.posicion - b.posicion)
      .map((l) => ({
        codigo: l.codigo,
        nombre: l.nombre,
        cantidad: l.cantidad,
        costo: l.costo_unitario === null ? null : Number(l.costo_unitario),
        anterior: l.cantidad_anterior === null ? null : Number(l.cantidad_anterior),
      })),
    sincronizacion: f.sincronizacion,
    error: f.error_sincronizacion,
    creadoPor: uno(f.creador)?.nombre ?? null,
    creadoEn: f.creado_en,
  }));
}

/** Los códigos que se pueden ingresar: las planchas del catálogo y los accesorios. */
async function codigosDelCatalogo(): Promise<Set<string>> {
  const [catalogo, accesorios] = await Promise.all([cargarCatalogoPlanchas(), cargarAccesorios()]);
  return new Set([...catalogo.flatMap((g) => g.formatos.map((f) => f.codigo)), ...accesorios.map((a) => a.codigo_odoo)]);
}

/**
 * Registra un ingreso: primero en la tabla (así no se pierde lo escrito si Odoo
 * falla) y después en Odoo.
 */
export async function registrarIngreso(v: NuevoIngreso): Promise<Resultado> {
  const almacen = (await cargarAlmacenes()).find((a) => a.id === v.almacenId && a.activo);
  if (!almacen) return { ok: false, error: "Ese almacén ya no está activo. Vuelve a elegirlo." };

  let productos: Map<number, ProductoOdoo>;
  try {
    productos = await productosPorId(v.lineas.map((l) => l.productoId));
  } catch (e) {
    return { ok: false, error: mensajeOdoo(e, "leer productos del ingreso") };
  }
  const delCatalogo = await codigosDelCatalogo();
  for (const l of v.lineas) {
    const p = productos.get(l.productoId);
    if (!p) return { ok: false, error: "Uno de los productos ya no existe en Odoo. Quítalo y vuelve a buscarlo." };
    if (!p.codigo || !delCatalogo.has(p.codigo)) {
      return { ok: false, error: `${p.nombre} no es una plancha ni un accesorio del almacén.` };
    }
  }

  const supabase = await clienteServidor();
  const { data: ingreso, error } = await supabase
    .from("ingresos_stock")
    .insert({
      tipo: v.tipo,
      almacen_id: almacen.id,
      proveedor_odoo_id: v.tipo === "compra" ? v.proveedorId : null,
      proveedor_nombre: v.tipo === "compra" ? v.proveedorNombre : null,
      documento: v.documento,
      nota: v.nota,
    })
    .select("id, codigo")
    .single();
  if (error || !ingreso) return { ok: false, error: mensajeDeError(error) };

  const { error: alLineas } = await supabase.from("ingresos_stock_lineas").insert(
    v.lineas.map((l, i) => {
      const p = productos.get(l.productoId)!;
      return {
        ingreso_id: ingreso.id,
        posicion: i + 1,
        producto_odoo_id: p.id,
        codigo: p.codigo,
        nombre: p.nombre,
        cantidad: l.cantidad,
        costo_unitario: v.tipo === "compra" ? l.costo : null,
      };
    }),
  );
  if (alLineas) return { ok: false, error: mensajeDeError(alLineas) };

  const odoo = await llevarIngresoAOdoo(ingreso.id);
  return odoo.ok
    ? { ok: true, codigo: ingreso.codigo }
    : { ok: true, codigo: ingreso.codigo, aviso: `Quedó registrado, pero no llegó a Odoo: ${odoo.error}` };
}

/**
 * Lleva a Odoo un ingreso que todavía no está: la compra como recepción del
 * almacén, el ajuste como inventario. Reintentar no duplica: la recepción se
 * busca por su origen, y un ajuste deja lo contado (repetirlo da lo mismo).
 */
export async function llevarIngresoAOdoo(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await clienteServidor();
  const { data: i, error } = await supabase
    .from("ingresos_stock")
    .select(
      `id, codigo, tipo, almacen_id, proveedor_odoo_id, documento, sincronizacion,
       ingresos_stock_lineas ( posicion, producto_odoo_id, cantidad, costo_unitario )`,
    )
    .eq("id", id)
    .maybeSingle();
  if (error) return { ok: false, error: mensajeDeError(error) };
  if (!i) return { ok: false, error: "Ese ingreso ya no existe." };
  if (i.sincronizacion === "sincronizada") return { ok: true };

  const anotar = (cambios: { odoo_picking_id?: number; sincronizacion: "sincronizada" | "error"; error_sincronizacion: string | null }) =>
    supabase.from("ingresos_stock").update(cambios).eq("id", id);

  if (!odooConfigurado()) {
    await anotar({ sincronizacion: "error", error_sincronizacion: ODOO_NO_CONFIGURADO });
    return { ok: false, error: ODOO_NO_CONFIGURADO };
  }

  const lineas = [...(i.ingresos_stock_lineas ?? [])].sort((a, b) => a.posicion - b.posicion);
  try {
    const almacen = await odooDeAlmacenId(i.almacen_id);
    if (i.tipo === "compra") {
      const picking = await ingresarCompra({
        almacen,
        proveedorId: i.proveedor_odoo_id!,
        origen: origenDe(i.codigo),
        documento: i.documento,
        lineas: lineas.map((l) => ({
          productoId: l.producto_odoo_id,
          cantidad: l.cantidad,
          costo: l.costo_unitario === null ? null : Number(l.costo_unitario),
        })),
      });
      await anotar({ odoo_picking_id: picking, sincronizacion: "sincronizada", error_sincronizacion: null });
    } else {
      const antes = await ajustarInventario({
        ubicacionId: almacen.ubicacionId,
        lineas: lineas.map((l) => ({ productoId: l.producto_odoo_id, cantidad: l.cantidad })),
      });
      for (const l of lineas) {
        await supabase
          .from("ingresos_stock_lineas")
          .update({ cantidad_anterior: antes.get(l.producto_odoo_id) ?? null })
          .eq("ingreso_id", id)
          .eq("posicion", l.posicion);
      }
      await anotar({ sincronizacion: "sincronizada", error_sincronizacion: null });
    }
    return { ok: true };
  } catch (e) {
    const mensaje = mensajeOdoo(e, "llevar ingreso");
    await anotar({ sincronizacion: "error", error_sincronizacion: mensaje });
    return { ok: false, error: mensaje };
  }
}

/* ── Productos nuevos ──────────────────────────────────────────────────────── */

/**
 * Crea una plancha o un accesorio: en Odoo (con el código que sigue en el
 * correlativo de su prefijo) y en el catálogo de la app. El precio solo lo pone
 * Administración; si lo crea Logística, queda en 0 hasta que Administración lo ponga.
 */
export async function crearProducto(v: NuevoProducto, ponePrecio: boolean): Promise<Resultado> {
  if (!odooConfigurado()) return { ok: false, error: ODOO_NO_CONFIGURADO };
  const precio = ponePrecio ? (v.precio ?? 0) : 0;
  const supabase = await clienteServidor();

  try {
    if (v.tipo === "plancha") {
      const catalogo = await cargarCatalogoPlanchas();
      const igual = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
      const grupo = catalogo.find(
        (g) =>
          igual(g.material, v.material) &&
          igual(g.variante, v.variante) &&
          igual(g.detalle, v.detalle) &&
          Math.abs(g.espesorMm - v.espesorMm) < 0.001,
      );
      const repetido = grupo?.formatos.find(
        (f) =>
          (Math.abs(f.anchoCm - v.anchoCm) < 0.01 && Math.abs(f.largoCm - v.largoCm) < 0.01) ||
          (Math.abs(f.anchoCm - v.largoCm) < 0.01 && Math.abs(f.largoCm - v.anchoCm) < 0.01),
      );
      if (repetido) return { ok: false, error: `Esa plancha ya existe: es la ${repetido.codigo}.` };

      const { prefijoPlancha } = await cargarConfigAlmacen();
      const usados = [...(await codigosConPrefijo(prefijoPlancha)), ...catalogo.flatMap((g) => g.formatos.map((f) => f.codigo))];
      const codigo = siguienteDe(prefijoPlancha, usados, 4);
      const producto = await crearProductoAlmacenable({ nombre: nombreDePlancha(v), codigo, precio });
      indiceProductos().agregar(producto);

      let grupoId = grupo?.id;
      if (!grupoId) {
        const { data, error } = await supabase
          .from("grupos_plancha")
          .insert({
            material: v.material,
            variante: v.variante,
            detalle: v.detalle,
            espesor_mm: v.espesorMm,
            rotable: v.rotable,
            sobrantes_activo: true,
          })
          .select("id")
          .single();
        if (error || !data) return { ok: false, error: `Se creó ${codigo} en Odoo, pero no en el catálogo: ${mensajeDeError(error)}` };
        grupoId = data.id;
      }
      const { error } = await supabase.from("formatos_plancha").insert({
        grupo_id: grupoId,
        codigo_odoo: codigo,
        ancho_cm: v.anchoCm,
        largo_cm: v.largoCm,
      });
      if (error) return { ok: false, error: `Se creó ${codigo} en Odoo, pero no en el catálogo: ${mensajeDeError(error)}` };
      return { ok: true, codigo };
    }

    const categoria = (await cargarCategorias()).find((c) => c.id === v.categoriaId);
    if (!categoria) return { ok: false, error: "Esa categoría ya no existe. Vuelve a elegirla." };
    const accesorios = await cargarAccesorios();
    const usados = [...(await codigosConPrefijo(categoria.prefijo)), ...accesorios.map((a) => a.codigo_odoo)];
    const codigo = siguienteDe(categoria.prefijo, usados, 3);
    const producto = await crearProductoAlmacenable({ nombre: v.nombre, codigo, precio });
    indiceProductos().agregar(producto);
    const { error } = await supabase.from("accesorios").insert({ codigo_odoo: codigo, categoria_id: categoria.id });
    if (error) return { ok: false, error: `Se creó ${codigo} en Odoo, pero no en el almacén: ${mensajeDeError(error)}` };
    return { ok: true, codigo };
  } catch (e) {
    return { ok: false, error: mensajeOdoo(e, "crear producto") };
  }
}

/** Un accesorio que ya está en Odoo (con su código) y todavía no en el almacén de la app. */
export async function agregarAccesorioExistente(codigo: string, categoriaId: string): Promise<Resultado> {
  if (!odooConfigurado()) return { ok: false, error: ODOO_NO_CONFIGURADO };
  try {
    const encontrado = (await productosPorCodigo([codigo])).get(codigo);
    if (!encontrado) return { ok: false, error: `No hay ningún producto ${codigo} en Odoo.` };
  } catch (e) {
    return { ok: false, error: mensajeOdoo(e, "buscar accesorio") };
  }
  const supabase = await clienteServidor();
  const { error } = await supabase.from("accesorios").insert({ codigo_odoo: codigo, categoria_id: categoriaId });
  if (error) {
    if (/duplicate key|unique/i.test(error.message)) return { ok: false, error: `${codigo} ya está en el almacén.` };
    return { ok: false, error: mensajeDeError(error) };
  }
  return { ok: true, codigo };
}

/** Cambia el precio de venta de una plancha o un accesorio en Odoo. Solo Administración. */
export async function cambiarPrecioProducto(productoId: number, precio: number): Promise<Resultado> {
  if (!odooConfigurado()) return { ok: false, error: ODOO_NO_CONFIGURADO };
  try {
    const p = await cambiarPrecio(productoId, precio);
    indiceProductos().agregar(p);
    return { ok: true, codigo: p.codigo ?? undefined };
  } catch (e) {
    return { ok: false, error: mensajeOdoo(e, "cambiar precio") };
  }
}

/** Fija (o, con `null`, vuelve al calculado) el precio de un sobrante. Solo Administración: lo exige la base. */
export async function fijarPrecioSobrante(codigo: string, precio: number | null): Promise<Resultado> {
  const supabase = await clienteServidor();
  const { error } = await supabase.rpc("fijar_precio_sobrante", { p_codigo: codigo, p_precio: precio as number });
  return error ? { ok: false, error: mensajeDeError(error) } : { ok: true };
}

/** Crea o cambia una categoría de accesorios. */
export async function guardarCategoria(v: { id: string | null; nombre: string; prefijo: string }): Promise<Resultado> {
  const supabase = await clienteServidor();
  const fila = { nombre: v.nombre, prefijo: v.prefijo };
  const { error } = v.id
    ? await supabase.from("categorias_accesorio").update(fila).eq("id", v.id)
    : await supabase
        .from("categorias_accesorio")
        .insert({ ...fila, orden: Math.max(0, ...(await cargarCategorias()).map((c) => c.orden)) + 1 });
  if (error) {
    if (/duplicate key|unique/i.test(error.message)) return { ok: false, error: "Ya hay una categoría con ese nombre." };
    return { ok: false, error: mensajeDeError(error) };
  }
  return { ok: true };
}

/** Cambia la categoría de un accesorio, o lo saca del almacén (sin tocar Odoo). */
export async function cambiarAccesorio(id: string, cambios: { categoriaId?: string; activo?: boolean }): Promise<Resultado> {
  const supabase = await clienteServidor();
  const fila: { categoria_id?: string; activo?: boolean } = {};
  if (cambios.categoriaId) fila.categoria_id = cambios.categoriaId;
  if (cambios.activo !== undefined) fila.activo = cambios.activo;
  const { data, error } = await supabase.from("accesorios").update(fila).eq("id", id).select("id");
  if (error) return { ok: false, error: mensajeDeError(error) };
  if (!data?.length) return { ok: false, error: "Ese accesorio ya no existe." };
  return { ok: true };
}
