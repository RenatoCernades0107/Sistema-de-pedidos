/**
 * Los conteos físicos del lado del servidor.
 *
 * Un conteo es de un almacén y de lo que se elija contar (planchas de un
 * material, accesorios de una categoría, los sobrantes). Es **ciego**: la lista
 * no dice cuánto debería haber. Se puede contar en varias vueltas (se guarda) y,
 * al enviarlo, se lee de Odoo lo que hay en ese almacén y cada diferencia queda
 * como un caso pendiente para Administración.
 */

import { cargarAlmacenes, odooDeAlmacenId } from "./almacenes-servidor";
import { avisar } from "./casos-servidor";
import {
  diferenciasDeConteo,
  type Conteo,
  type ConteoGuardado,
  type ConteoResumen,
  type EstadoConteo,
  type NuevoConteo,
} from "./casos";
import { espesorTexto } from "./cortes/catalogo";
import { mensajeDeError } from "./errores";
import { stockPorAlmacen } from "./odoo/almacenes";
import { productosPorId } from "./odoo/catalogos";
import { ErrorOdoo, ODOO_NO_CONFIGURADO, odooConfigurado } from "./odoo/rpc";
import { productosDeLotes } from "./odoo/sobrantes";
import { medidaSobrante } from "./sobrantes";
import { cargarSobrantes } from "./sobrantes-servidor";
import { cargarCategorias, cargarInventario } from "./stock-servidor";
import { clienteServidor } from "./supabase-servidor";

type Resultado = { ok: true; codigo?: string; aviso?: string } | { ok: false; error: string };

const mensajeOdoo = (e: unknown, contexto: string) => {
  if (e instanceof ErrorOdoo) return e.message;
  console.error(`[conteos] ${contexto}`, e);
  return "Algo falló al hablar con Odoo.";
};

const uno = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

const COLUMNAS = `id, codigo, almacen_id, alcance, estado, diferencias, coincidencias, creado_en, enviado_en,
  almacen:almacenes ( nombre ),
  creador:usuarios!conteos_stock_creado_por_fkey ( nombre ),
  conteos_stock_lineas ( producto_odoo_id, codigo, nombre, grupo, contado ),
  conteos_stock_sobrantes ( sobrante_codigo, encontrado )`;

type Fila = {
  id: string;
  codigo: string;
  almacen_id: string;
  alcance: string;
  estado: string;
  diferencias: number | null;
  coincidencias: number | null;
  creado_en: string;
  enviado_en: string | null;
  almacen: { nombre: string } | { nombre: string }[] | null;
  creador: { nombre: string } | { nombre: string }[] | null;
  conteos_stock_lineas: { producto_odoo_id: number; codigo: string | null; nombre: string; grupo: string | null; contado: number | null }[];
  conteos_stock_sobrantes: { sobrante_codigo: string; encontrado: boolean | null }[];
};

const resumen = (f: Fila): ConteoResumen => ({
  id: f.id,
  codigo: f.codigo,
  almacenId: f.almacen_id,
  almacen: uno(f.almacen)?.nombre ?? "(almacén borrado)",
  alcance: f.alcance,
  estado: f.estado as EstadoConteo,
  productos: f.conteos_stock_lineas.length,
  contados: f.conteos_stock_lineas.filter((l) => l.contado !== null).length + f.conteos_stock_sobrantes.filter((s) => s.encontrado !== null).length,
  sobrantes: f.conteos_stock_sobrantes.length,
  diferencias: f.diferencias,
  coincidencias: f.coincidencias,
  creadoPor: uno(f.creador)?.nombre ?? null,
  creadoEn: f.creado_en,
  enviadoEn: f.enviado_en,
});

export async function cargarConteos(limite = 40): Promise<ConteoResumen[]> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from("conteos_stock")
    .select(COLUMNAS)
    .neq("estado", "anulado")
    .order("creado_en", { ascending: false })
    .limit(limite);
  if (error) throw new Error(`No se pudieron leer los conteos: ${error.message}`);
  return ((data ?? []) as unknown as Fila[]).map(resumen);
}

/** Un conteo con su lista, para contar. Lo esperado no viaja: es ciego. */
export async function cargarConteo(codigo: string): Promise<Conteo | null> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase.from("conteos_stock").select(COLUMNAS).eq("codigo", codigo).maybeSingle();
  if (error) throw new Error(`No se pudo leer el conteo: ${error.message}`);
  if (!data) return null;
  const f = data as unknown as Fila;
  const sobrantes = f.conteos_stock_sobrantes.length ? await cargarSobrantes() : [];
  return {
    ...resumen(f),
    lineas: [...f.conteos_stock_lineas]
      .sort((a, b) => (a.grupo ?? "").localeCompare(b.grupo ?? "") || (a.codigo ?? "").localeCompare(b.codigo ?? ""))
      .map((l) => ({ productoId: l.producto_odoo_id, codigo: l.codigo, nombre: l.nombre, grupo: l.grupo, contado: l.contado })),
    sobrantesLista: [...f.conteos_stock_sobrantes]
      .sort((a, b) => a.sobrante_codigo.localeCompare(b.sobrante_codigo))
      .map((x) => {
        const s = sobrantes.find((y) => y.codigo === x.sobrante_codigo);
        return {
          codigo: x.sobrante_codigo,
          material: s?.material ?? "",
          medida: s ? medidaSobrante(s) : "",
          ubicacion: s?.ubicacion ?? null,
          encontrado: x.encontrado,
        };
      }),
  };
}

/** Arma un conteo nuevo: la lista de lo que hay que contar, sin cantidades. */
export async function crearConteo(v: NuevoConteo): Promise<Resultado> {
  const almacen = (await cargarAlmacenes()).find((a) => a.id === v.almacenId && a.activo);
  if (!almacen) return { ok: false, error: "Ese almacén ya no está activo." };
  if (!odooConfigurado()) return { ok: false, error: ODOO_NO_CONFIGURADO };

  const [inventario, categorias, sobrantes] = await Promise.all([
    cargarInventario({ verPrecios: false, gestionaStock: true }),
    cargarCategorias(),
    v.sobrantes ? cargarSobrantes() : Promise.resolve([]),
  ]);
  const lineas = [
    ...(v.planchas
      ? inventario.planchas
          .filter((p) => p.activo && p.productoId && (!v.material || p.material === v.material))
          .map((p) => ({
            producto_odoo_id: p.productoId!,
            codigo: p.codigo,
            nombre: `${p.color} · ${p.formato}`,
            grupo: `${p.material} · ${espesorTexto(p.espesorMm)}`,
          }))
      : []),
    ...(v.accesorios
      ? inventario.accesorios
          .filter((a) => a.activo && a.productoId && (!v.categoriaId || a.categoriaId === v.categoriaId))
          .map((a) => ({ producto_odoo_id: a.productoId!, codigo: a.codigo, nombre: a.nombre, grupo: a.categoria }))
      : []),
  ];
  // Un mismo producto en dos filas del catálogo se cuenta una vez.
  const unicas = [...new Map(lineas.map((l) => [l.producto_odoo_id, l])).values()];
  const delAlmacen = sobrantes.filter((s) => s.almacenId === almacen.id && (s.estado === "disponible" || s.estado === "reservado"));
  if (unicas.length === 0 && delAlmacen.length === 0) return { ok: false, error: "No hay nada que contar con eso." };

  const alcance = [
    v.planchas && `Planchas${v.material ? ` · ${v.material}` : ""}`,
    v.accesorios && `Accesorios${v.categoriaId ? ` · ${categorias.find((c) => c.id === v.categoriaId)?.nombre ?? ""}` : ""}`,
    v.sobrantes && "Sobrantes",
  ]
    .filter(Boolean)
    .join(" + ");

  const supabase = await clienteServidor();
  const { data: c, error } = await supabase
    .from("conteos_stock")
    .insert({ almacen_id: almacen.id, alcance })
    .select("id, codigo")
    .single();
  if (error || !c) return { ok: false, error: mensajeDeError(error) };
  if (unicas.length) {
    const { error: e } = await supabase.from("conteos_stock_lineas").insert(unicas.map((l) => ({ ...l, conteo_id: c.id })));
    if (e) return { ok: false, error: mensajeDeError(e) };
  }
  if (delAlmacen.length) {
    const { error: e } = await supabase
      .from("conteos_stock_sobrantes")
      .insert(delAlmacen.map((s) => ({ conteo_id: c.id, sobrante_codigo: s.codigo })));
    if (e) return { ok: false, error: mensajeDeError(e) };
  }
  return { ok: true, codigo: c.codigo };
}

/** Guarda lo contado hasta ahora. Se puede seguir otro día. */
export async function guardarConteo(v: ConteoGuardado): Promise<Resultado> {
  const supabase = await clienteServidor();
  for (const l of v.lineas) {
    const { error } = await supabase
      .from("conteos_stock_lineas")
      .update({ contado: l.contado })
      .eq("conteo_id", v.id)
      .eq("producto_odoo_id", l.productoId);
    if (error) return { ok: false, error: mensajeDeError(error) };
  }
  for (const s of v.sobrantes) {
    const { error } = await supabase
      .from("conteos_stock_sobrantes")
      .update({ encontrado: s.encontrado })
      .eq("conteo_id", v.id)
      .eq("sobrante_codigo", s.codigo);
    if (error) return { ok: false, error: mensajeDeError(error) };
  }
  return { ok: true };
}

/** Algo que apareció y no estaba en la lista. */
export async function agregarAlConteo(id: string, productoId: number): Promise<Resultado> {
  let nombre: string;
  let codigo: string | null;
  try {
    const p = (await productosPorId([productoId])).get(productoId);
    if (!p) return { ok: false, error: "Ese producto ya no existe en Odoo." };
    nombre = p.nombre;
    codigo = p.codigo;
  } catch (e) {
    return { ok: false, error: mensajeOdoo(e, "agregar") };
  }
  const supabase = await clienteServidor();
  const { error } = await supabase
    .from("conteos_stock_lineas")
    .insert({ conteo_id: id, producto_odoo_id: productoId, codigo, nombre, grupo: "Agregados al contar" });
  if (error) {
    if (/duplicate key/.test(error.message)) return { ok: false, error: "Ya está en la lista." };
    return { ok: false, error: mensajeDeError(error) };
  }
  return { ok: true };
}

/**
 * Envía el conteo: compara con lo que hay en Odoo en ese almacén y deja cada
 * diferencia como un caso pendiente; avisa a Administración. Si se corta a la
 * mitad, repetirlo no duplica los casos.
 */
export async function enviarConteo(id: string): Promise<Resultado & { diferencias?: number; coinciden?: number; sinContar?: number }> {
  if (!odooConfigurado()) return { ok: false, error: ODOO_NO_CONFIGURADO };
  const supabase = await clienteServidor();
  const { data, error } = await supabase.from("conteos_stock").select(COLUMNAS).eq("id", id).maybeSingle();
  if (error) return { ok: false, error: mensajeDeError(error) };
  if (!data) return { ok: false, error: "Ese conteo ya no existe." };
  const f = data as unknown as Fila;
  if (f.estado !== "borrador") return { ok: false, error: "Ese conteo ya se envió." };

  let r: ReturnType<typeof diferenciasDeConteo>;
  try {
    const ubicacion = (await odooDeAlmacenId(f.almacen_id)).ubicacionId;
    const lineas = f.conteos_stock_lineas.map((l) => ({ productoId: l.producto_odoo_id, codigo: l.codigo, nombre: l.nombre, contado: l.contado }));
    const stock = await stockPorAlmacen(
      lineas.map((l) => l.productoId),
      [{ almacenId: f.almacen_id, ubicacionId: ubicacion }],
    );
    const esperado = new Map([...stock].map(([p, s]) => [p, s.porAlmacen[f.almacen_id] ?? 0]));

    // Los sobrantes: su producto es el de su lote (solo hace falta para los que no están).
    const codigos = f.conteos_stock_sobrantes.filter((s) => s.encontrado === false).map((s) => s.sobrante_codigo);
    const { data: lotes } = codigos.length
      ? await supabase.from("sobrantes").select("codigo, odoo_lot_id").in("codigo", codigos)
      : { data: [] };
    const productoDeLote = await productosDeLotes((lotes ?? []).flatMap((l) => (l.odoo_lot_id ? [l.odoo_lot_id] : [])));
    const sobrantes = f.conteos_stock_sobrantes.map((s) => {
      const lote = lotes?.find((l) => l.codigo === s.sobrante_codigo)?.odoo_lot_id;
      return { codigo: s.sobrante_codigo, encontrado: s.encontrado, productoId: lote ? (productoDeLote.get(lote) ?? 0) : 0 };
    });
    const sinProducto = sobrantes.find((s) => s.encontrado === false && !s.productoId);
    if (sinProducto) return { ok: false, error: `El sobrante ${sinProducto.codigo} no tiene lote en Odoo: regístralo antes de enviar.` };
    r = diferenciasDeConteo(lineas, sobrantes, esperado);
  } catch (e) {
    return { ok: false, error: mensajeOdoo(e, "enviar") };
  }

  // Si un intento anterior ya creó los casos, no se vuelven a crear.
  const { data: previos } = await supabase.from("casos_stock").select("codigo").eq("conteo_id", id);
  let codigos = (previos ?? []).map((c) => c.codigo);
  if (codigos.length === 0 && r.diferencias.length) {
    const { data: casos, error: alCrear } = await supabase
      .from("casos_stock")
      .insert(
        r.diferencias.map((d) => ({
          tipo: "diferencia",
          almacen_id: f.almacen_id,
          producto_odoo_id: d.productoId,
          codigo_producto: d.codigo,
          nombre: d.nombre,
          sobrante_codigo: d.sobrante,
          cantidad: d.cantidad,
          conteo_id: id,
          esperado: d.esperado,
          contado: d.contado,
        })),
      )
      .select("codigo");
    if (alCrear) {
      if (/casos_stock_sobrante_abierto/.test(alCrear.message)) {
        return { ok: false, error: "Un sobrante que marcaste como 'no está' ya tiene un caso abierto. Márcalo como sin revisar." };
      }
      return { ok: false, error: mensajeDeError(alCrear) };
    }
    codigos = (casos ?? []).map((c) => c.codigo);
  }

  const { error: alEnviar } = await supabase.rpc("enviar_conteo", {
    p_id: id,
    p_diferencias: r.diferencias.length,
    p_coincidencias: r.coinciden,
  });
  if (alEnviar) return { ok: false, error: mensajeDeError(alEnviar) };
  await avisar(codigos);
  return { ok: true, codigo: f.codigo, diferencias: r.diferencias.length, coinciden: r.coinciden, sinContar: r.sinContar };
}

export async function anularConteo(id: string): Promise<Resultado> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from("conteos_stock")
    .update({ estado: "anulado" })
    .eq("id", id)
    .eq("estado", "borrador")
    .select("id");
  if (error) return { ok: false, error: mensajeDeError(error) };
  if (!data?.length) return { ok: false, error: "Ese conteo ya no está en borrador." };
  return { ok: true };
}
