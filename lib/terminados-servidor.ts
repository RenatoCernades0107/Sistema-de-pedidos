/**
 * El catálogo de productos terminados y la ficha de una línea, del lado del
 * servidor.
 *
 * Como el de planchas, el catálogo se lee con la sesión de quien pide: la RLS
 * dice que solo Administración lo ve.
 */

import { cache } from "react";
import { cargarConfigCortes, cargarGrupoPlancha, preciosDeGrupo } from "./cortes-servidor";
import { colorDe, pideColor } from "./cortes/catalogo";
import type { NuevaLineaTerminado } from "./esquemas";
import { productosPorCodigo, productosPorId } from "./odoo/catalogos";
import { CODIGO_PERSONALIZADO, NOMBRE_PERSONALIZADO, productoTerminado } from "./odoo/produccion";
import { clienteServidor } from "./supabase-servidor";
import {
  calcularTerminado,
  formatosConPrecio,
  planchaDeReferencia,
  redondear2,
  type Accesorio,
} from "./terminados/calcular";
import type {
  CatalogoTerminados,
  ClaseOpcion,
  Opcion,
  ProductoEstandar,
  TipoTerminado,
} from "./terminados/catalogo";
import { leerConfigTerminados, type ConfigTerminados } from "./terminados/config";
import { limpiarMedidas, type Geometria } from "./terminados/geometria";
import { leerParametrosCad } from "./terminados/plantilla-cad";
import { descripcionDeTerminado, guardarCorteDeTerminado, type TerminadoGuardado } from "./terminados/guardado";
import { urlMiniatura } from "@/lib/cad/miniatura-url";

export const CLAVE_CONFIG_TERMINADOS = "terminados";

export const cargarConfigTerminados = cache(async (): Promise<ConfigTerminados> => {
  const supabase = await clienteServidor();
  const { data } = await supabase
    .from("configuracion")
    .select("valor")
    .eq("clave", CLAVE_CONFIG_TERMINADOS)
    .maybeSingle();
  return leerConfigTerminados(data?.valor ?? null);
});

const COLUMNAS_PRODUCTO = `
  codigo, tipo, nombre, usos, a_medida, contacto_alimentario, imagen_url, miniatura_path, notas, geometria, activo, plantilla_cad, parametros_cad,
  pt_medidas ( id, orden, medida_1_cm, medida_2_cm, medida_3_cm, diametro_cm, altura_cm, altura_max_cm, formato, estimado, nota ),
  pt_espesores ( id, orden, espesor_min_mm, espesor_max_mm, aplicacion, material, estimado, nota ),
  pt_producto_color ( pt_colores ( nombre ) ),
  pt_producto_opcion ( opcion_id, opcional, detalle ),
  pt_producto_material ( componente, opcional, especificacion, pt_materiales ( nombre ) )
`;

interface FilaProducto {
  codigo: string;
  tipo: string;
  nombre: string;
  usos: string | null;
  a_medida: boolean;
  contacto_alimentario: string | null;
  imagen_url: string | null;
  miniatura_path: string | null;
  notas: string | null;
  geometria: Geometria;
  activo: boolean;
  plantilla_cad: string | null;
  parametros_cad: unknown;
  pt_medidas: {
    id: string;
    orden: number;
    medida_1_cm: number | null;
    medida_2_cm: number | null;
    medida_3_cm: number | null;
    diametro_cm: number | null;
    altura_cm: number | null;
    altura_max_cm: number | null;
    formato: string | null;
    estimado: boolean;
    nota: string | null;
  }[];
  pt_espesores: {
    id: string;
    orden: number;
    espesor_min_mm: number;
    espesor_max_mm: number;
    aplicacion: string | null;
    material: string | null;
    estimado: boolean;
    nota: string | null;
  }[];
  pt_producto_color: { pt_colores: { nombre: string } | null }[];
  pt_producto_opcion: { opcion_id: number; opcional: boolean; detalle: string | null }[];
  pt_producto_material: {
    componente: string | null;
    opcional: boolean;
    especificacion: string | null;
    pt_materiales: { nombre: string } | null;
  }[];
}

const num = (v: number | null) => (v === null ? null : Number(v));

const deProducto = (p: FilaProducto): ProductoEstandar => ({
  codigo: p.codigo,
  tipo: p.tipo,
  nombre: p.nombre,
  usos: p.usos,
  aMedida: p.a_medida,
  contactoAlimentario: p.contacto_alimentario,
  imagenUrl: p.imagen_url,
  miniatura: urlMiniatura(p.miniatura_path),
  notas: p.notas,
  geometria: p.geometria,
  activo: p.activo,
  plantillaCad: p.plantilla_cad,
  parametrosCad: p.plantilla_cad ? leerParametrosCad(p.parametros_cad) : null,
  medidas: (p.pt_medidas ?? [])
    .map((m) => ({
      id: m.id,
      orden: m.orden,
      m1: num(m.medida_1_cm),
      m2: num(m.medida_2_cm),
      m3: num(m.medida_3_cm),
      diametro: num(m.diametro_cm),
      altura: num(m.altura_cm),
      alturaMax: num(m.altura_max_cm),
      formato: m.formato,
      estimado: m.estimado,
      nota: m.nota,
    }))
    .sort((a, b) => a.orden - b.orden),
  espesores: (p.pt_espesores ?? [])
    .map((e) => ({
      id: e.id,
      orden: e.orden,
      minMm: Number(e.espesor_min_mm),
      maxMm: Number(e.espesor_max_mm),
      aplicacion: e.aplicacion,
      material: e.material,
      estimado: e.estimado,
      nota: e.nota,
    }))
    .sort((a, b) => a.orden - b.orden),
  colores: (p.pt_producto_color ?? []).flatMap((c) => (c.pt_colores ? [c.pt_colores.nombre] : [])),
  opciones: (p.pt_producto_opcion ?? []).map((o) => ({
    opcionId: o.opcion_id,
    opcional: o.opcional,
    detalle: o.detalle,
  })),
  materiales: (p.pt_producto_material ?? []).flatMap((m) =>
    m.pt_materiales
      ? [{ nombre: m.pt_materiales.nombre, componente: m.componente, opcional: m.opcional, especificacion: m.especificacion }]
      : [],
  ),
});

async function leerTipos(): Promise<TipoTerminado[]> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase.from("pt_tipos").select("codigo, nombre, orden, factor_fabricacion").order("orden");
  if (error) throw new Error(`No se pudieron leer los tipos de producto terminado: ${error.message}`);
  return (data ?? []).map((t) => ({ codigo: t.codigo, nombre: t.nombre, orden: t.orden, factor: Number(t.factor_fabricacion) }));
}

async function leerOpciones(): Promise<Opcion[]> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase.from("pt_opciones").select("id, clase, nombre, extra").order("nombre");
  if (error) throw new Error(`No se pudieron leer las opciones de producto terminado: ${error.message}`);
  return (data ?? []).map((o) => ({ id: o.id, clase: o.clase as ClaseOpcion, nombre: o.nombre, extra: Number(o.extra) }));
}

/**
 * Todo el catálogo, para el editor del pedido y para /configuracion.
 * `soloActivos` quita los productos dados de baja: es lo que ve quien cotiza.
 */
export const cargarCatalogoTerminados = cache(async (soloActivos = false): Promise<CatalogoTerminados> => {
  const supabase = await clienteServidor();
  const [tipos, opciones, config, productos, colores] = await Promise.all([
    leerTipos(),
    leerOpciones(),
    cargarConfigTerminados(),
    supabase.from("pt_productos").select(COLUMNAS_PRODUCTO).order("codigo"),
    supabase.from("pt_colores").select("id, nombre").order("id"),
  ]);
  if (productos.error) throw new Error(`No se pudo leer el catálogo de productos terminados: ${productos.error.message}`);
  if (colores.error) throw new Error(`No se pudieron leer los colores: ${colores.error.message}`);

  const lista = ((productos.data ?? []) as unknown as FilaProducto[]).map(deProducto);
  return {
    tipos,
    opciones,
    config,
    colores: colores.data ?? [],
    productos: soloActivos ? lista.filter((p) => p.activo) : lista,
  };
});

async function cargarProducto(codigo: string): Promise<ProductoEstandar | null> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase.from("pt_productos").select(COLUMNAS_PRODUCTO).eq("codigo", codigo).maybeSingle();
  if (error) throw new Error(`No se pudo leer el producto terminado: ${error.message}`);
  return data ? deProducto(data as unknown as FilaProducto) : null;
}

/* ── Una línea, armada por el servidor ─────────────────────────────────────── */

/** La línea lista para `crear_cotizacion`, en las columnas de la tabla. */
export interface FilaDeTerminado {
  tipo: "terminado";
  odoo_product_id: number;
  producto_nombre: string;
  producto_codigo: string | null;
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  importe: number;
  terminado: TerminadoGuardado;
  /** La versión del diseño CAD de la que sale; FK en la base. */
  diseno_version_id: string | null;
}

/** Si la medida pedida es una de las estándar del producto. */
function esMedidaEstandar(p: ProductoEstandar, m: ReturnType<typeof limpiarMedidas>): boolean {
  const igual = (a: number | null | undefined, b: number | null | undefined) =>
    Math.abs((a ?? 0) - (b ?? 0)) < 0.005;
  return p.medidas.some(
    (e) =>
      igual(e.m1, m.m1) &&
      igual(e.m2, m.m2) &&
      igual(e.m3, m.m3) &&
      igual(e.diametro, m.diametro) &&
      // En las letras la altura estándar puede ser un rango.
      (e.alturaMax ? (m.altura ?? 0) >= (e.altura ?? 0) && (m.altura ?? 0) <= e.alturaMax : igual(e.altura, m.altura)),
  );
}

/**
 * Arma la ficha de un producto terminado que llega del navegador. De allá
 * vienen las referencias y lo que decidió quien cotiza; el nombre del producto,
 * los extras de las opciones, el factor, el precio de los materiales y el
 * precio sugerido se leen o se calculan aquí.
 *
 * El precio final sí viene de allá: es una decisión de quien cotiza, y la ficha
 * guarda al lado el sugerido para poder compararlos.
 */
export async function prepararTerminado(
  linea: NuevaLineaTerminado,
): Promise<{ ok: true; fila: FilaDeTerminado } | { ok: false; error: string }> {
  const fallo = (error: string) => ({ ok: false as const, error });

  const [producto, tipos, opcionesCatalogo, config, configCortes, grupo] = await Promise.all([
    linea.productoCodigo ? cargarProducto(linea.productoCodigo) : Promise.resolve(null),
    leerTipos(),
    leerOpciones(),
    cargarConfigTerminados(),
    cargarConfigCortes(),
    linea.grupoId ? cargarGrupoPlancha(linea.grupoId) : Promise.resolve(null),
  ]);

  if (linea.productoCodigo && (!producto || !producto.activo)) {
    return fallo(`El producto ${linea.productoCodigo} ya no está en el catálogo. Vuelve a elegirlo.`);
  }
  if (linea.grupoId && !grupo) return fallo("Ese material ya no está en el catálogo de planchas. Vuelve a elegirlo.");

  const tipo = tipos.find((t) => t.codigo === (producto?.tipo ?? linea.tipoCodigo)) ?? null;
  const nombre = producto?.nombre ?? linea.nombre ?? "";
  const medidas = limpiarMedidas(linea.medidas);

  // Solo las opciones que el producto admite; en un personalizado, cualquiera del catálogo.
  const admitidas = producto ? new Set(producto.opciones.map((o) => o.opcionId)) : null;
  const opciones = opcionesCatalogo.filter((o) => linea.opciones.includes(o.id) && (!admitidas || admitidas.has(o.id)));

  // La plancha con que se estima y los accesorios, con el precio de Odoo.
  const precios = grupo
    ? await preciosDeGrupo(grupo)
    : new Map<string, { productoId: number; precio: number; nombre: string }>();
  let plancha = grupo ? planchaDeReferencia(grupo.formatos, precios) : null;
  if (grupo && !plancha) {
    return fallo("Ninguna plancha de ese material tiene precio en Odoo. Revisa sus códigos en Configuración.");
  }
  if (plancha) {
    const enOdoo = (await productosPorCodigo([plancha.codigo])).get(plancha.codigo);
    plancha = { ...plancha, nombre: enOdoo?.nombre ?? plancha.codigo };
  }

  const deOdoo = await productosPorId(linea.accesorios.map((a) => a.productoId));
  const accesorios: Accesorio[] = [];
  for (const a of linea.accesorios) {
    const p = deOdoo.get(a.productoId);
    if (!p) return fallo("Uno de los materiales del producto ya no existe en Odoo. Quítalo y vuelve a buscarlo.");
    accesorios.push({ productoId: p.id, codigo: p.codigo, nombre: p.nombre, unidad: p.unidad, cantidad: a.cantidad, precio: p.precio });
  }

  const factor = tipo?.factor ?? 1;
  const geometria: Geometria = producto?.geometria ?? "manual";
  const calculo = calcularTerminado({
    geometria,
    medidas,
    areaManualM2: linea.areaM2,
    cantidad: linea.cantidad,
    plancha,
    accesorios,
    factor,
    extras: opciones.map((o) => o.extra),
    mermaPct: config.mermaPct,
    anchoDeLetra: config.anchoDeLetra,
    // Solo un estándar se despieza: un personalizado es "manual".
    formatos: grupo ? formatosConPrecio(grupo.formatos, precios) : [],
    configCortes,
    espesorMm: grupo?.espesorMm,
  });

  const terminado: TerminadoGuardado = {
    version: 1,
    estandar: !!producto,
    productoCodigo: producto?.codigo ?? null,
    tipoCodigo: tipo?.codigo ?? null,
    tipoNombre: tipo?.nombre ?? null,
    nombre,
    geometria,
    medidas,
    medidaEstandar: producto ? esMedidaEstandar(producto, medidas) : false,
    material: grupo
      ? {
          grupoId: grupo.id,
          material: grupo.material,
          // Con un código para todos los colores, vale el que se pidió.
          color: (pideColor(grupo) && linea.color) || colorDe(grupo),
          espesorMm: grupo.espesorMm,
        }
      : null,
    opciones: opciones.map((o) => ({ clase: o.clase, nombre: o.nombre, extra: o.extra })),
    texto: linea.texto || null,
    notas: linea.notas || null,
    areaUnidadM2: calculo.areaUnidadM2,
    areaManual: calculo.areaManual,
    mermaPct: calculo.mermaPct,
    materiales: calculo.materiales,
    costoMaterial: calculo.costoMaterial,
    factor,
    precioSugerido: calculo.precioSugerido,
    precioUnitario: linea.precioUnitario,
    reservar: linea.reservar && calculo.materiales.length > 0,
    corte: guardarCorteDeTerminado(calculo),
  };

  // El producto de Odoo con el que se vende: el del catálogo o el genérico.
  const codigoOdoo = producto?.codigo ?? CODIGO_PERSONALIZADO;
  const nombreOdoo = producto ? producto.nombre : NOMBRE_PERSONALIZADO;
  const odooId = await productoTerminado(codigoOdoo, nombreOdoo);

  return {
    ok: true,
    fila: {
      tipo: "terminado",
      odoo_product_id: odooId,
      producto_nombre: nombre,
      producto_codigo: codigoOdoo,
      descripcion: descripcionDeTerminado(terminado),
      cantidad: linea.cantidad,
      precio_unitario: linea.precioUnitario,
      importe: redondear2(linea.cantidad * linea.precioUnitario),
      terminado,
      diseno_version_id: linea.disenoVersionId ?? null,
    },
  };
}
