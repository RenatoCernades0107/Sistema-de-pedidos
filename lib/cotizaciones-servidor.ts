/**
 * Las cotizaciones del sistema del lado del servidor: leerlas de Supabase y
 * llevarlas a Odoo.
 *
 * Como en el resto de la app, se lee y se escribe con la sesión de quien pide
 * (`clienteServidor`), nunca con la clave de servicio: la RLS de `cotizaciones`
 * es la que dice que solo Administración cotiza.
 */

import { cache } from "react";
import { tipoDeDespacho, type Almacen } from "./almacenes";
import { almacenPorTipo, cargarAlmacenes, odooDeAlmacen } from "./almacenes-servidor";
import { clienteServidor } from "./supabase-servidor";
import { mensajeDeError } from "./errores";
import {
  importeDeProducto,
  motivoNoEnviable,
  type Canal,
  type Cotizacion,
  type EstadoCotizacion,
  type LineaGuardada,
  type Sincronizacion,
} from "./cotizaciones";
import {
  fraccionEnPalabras,
  leerCorte,
  materialDeCorte,
  planchasPorCobro,
  resumenPiezas,
  totalPiezas,
} from "./cortes/guardado";
import { leerCliente } from "./odoo/clientes";
import { cancelarPedidoDeVenta } from "./odoo/entregas";
import {
  actualizarPedidoDeVenta,
  cambiarAlmacenDeVenta,
  confirmarPedidoDeVenta,
  crearPedidoDeVenta,
  leerPedidoDeVenta,
  type LineaParaOdoo,
} from "./odoo/pedidos-venta";
import { ErrorOdoo, odooConfigurado } from "./odoo/rpc";
import { PREFIJO_CORTE, alDia, productoCorte } from "./odoo/produccion";
import { cargarGrupoPlancha } from "./cortes-servidor";
import { despachoPorStock } from "./faltantes-servidor";
import { producirCortes, reservarTerminados } from "./produccion-servidor";
import { leerTerminado } from "./terminados/guardado";
import { areaPiezasM2, lineasCorteAMedida, materialOdoo } from "./sobrantes";
import type { ClienteOdoo } from "./odoo/tipos";
import {
  CLAVE_CONFIG_COTIZACIONES,
  leerConfigCotizaciones,
  type ConfigCotizaciones,
} from "./cotizaciones-config";

const COLUMNAS = `
  id, canal, odoo_partner_id, cliente_nombre, cliente_documento, cliente_telefono,
  odoo_contacto_id, contacto_nombre,
  odoo_order_id, odoo_order_name, sincronizacion, error_sincronizacion,
  monto_sin_impuestos, monto_impuestos, monto_total, notas, chat_agente_id, creado_en,
  confirmada_en_odoo, error_confirmacion, token_publico, almacen_despacho_id,
  estado, enviada_en, version, reemplaza_a, error_edicion,
  creador:usuarios!cotizaciones_creado_por_fkey ( nombre ),
  pedido:pedidos!cotizaciones_pedido_id_fkey ( codigo ),
  cotizacion_productos ( posicion, odoo_product_id, producto_nombre, producto_codigo,
                         descripcion, cantidad, precio_unitario, tipo, corte, terminado, importe,
                         odoo_produccion_id )
`;

export interface Fila {
  id: string;
  canal: Canal;
  odoo_partner_id: number;
  cliente_nombre: string;
  cliente_documento: string | null;
  cliente_telefono: string | null;
  odoo_contacto_id: number | null;
  contacto_nombre: string | null;
  odoo_order_id: number | null;
  odoo_order_name: string | null;
  sincronizacion: Sincronizacion;
  error_sincronizacion: string | null;
  monto_sin_impuestos: number | null;
  monto_impuestos: number | null;
  monto_total: number | null;
  notas: string | null;
  chat_agente_id: string | null;
  creado_en: string;
  confirmada_en_odoo: boolean;
  error_confirmacion: string | null;
  token_publico?: string | null;
  almacen_despacho_id?: string | null;
  /** La foto pública (`cotizacion_publica`) no los trae: se asume enviada. */
  estado?: EstadoCotizacion;
  enviada_en?: string | null;
  version?: number;
  reemplaza_a?: string | null;
  error_edicion?: string | null;
  creador: { nombre: string } | { nombre: string }[] | null;
  pedido: { codigo: string } | { codigo: string }[] | null;
  cotizacion_productos: {
    posicion: number;
    odoo_product_id: number;
    producto_nombre: string;
    producto_codigo: string | null;
    descripcion: string | null;
    cantidad: number;
    precio_unitario: number;
    tipo: "producto" | "corte" | "terminado";
    corte: unknown;
    terminado: unknown;
    importe: number | null;
    odoo_produccion_id: number | null;
  }[];
}

/** PostgREST devuelve `numeric` como número, pero con decimales largos puede venir como texto. */
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export function deFila(f: Fila): Cotizacion {
  const creador = Array.isArray(f.creador) ? f.creador[0] : f.creador;
  const pedido = Array.isArray(f.pedido) ? f.pedido[0] : f.pedido;
  return {
    id: f.id,
    canal: f.canal,
    cliente: {
      id: f.odoo_partner_id,
      nombre: f.cliente_nombre,
      documento: f.cliente_documento,
      telefono: f.cliente_telefono,
      contacto:
        f.odoo_contacto_id !== null && f.contacto_nombre
          ? { id: f.odoo_contacto_id, nombre: f.contacto_nombre }
          : null,
    },
    odooOrderId: f.odoo_order_id,
    odooOrderName: f.odoo_order_name,
    sincronizacion: f.sincronizacion,
    errorSincronizacion: f.error_sincronizacion,
    montoSinImpuestos: num(f.monto_sin_impuestos),
    montoImpuestos: num(f.monto_impuestos),
    montoTotal: num(f.monto_total),
    notas: f.notas,
    chatAgenteId: f.chat_agente_id,
    creadoPor: creador?.nombre ?? null,
    creadoEn: f.creado_en,
    pedido: pedido ? { codigo: pedido.codigo } : null,
    confirmadaEnOdoo: f.confirmada_en_odoo,
    errorConfirmacion: f.error_confirmacion,
    tokenPublico: f.token_publico ?? null,
    almacenDespachoId: f.almacen_despacho_id ?? null,
    estado: f.estado ?? "enviada",
    enviadaEn: f.enviada_en ?? null,
    version: f.version ?? 1,
    reemplazaA: f.reemplaza_a ?? null,
    errorEdicion: f.error_edicion ?? null,
    lineas: [...(f.cotizacion_productos ?? [])]
      .sort((a, b) => a.posicion - b.posicion)
      .map((l) => ({
        posicion: l.posicion,
        productoId: l.odoo_product_id,
        nombre: l.producto_nombre,
        codigo: l.producto_codigo,
        descripcion: l.descripcion,
        cantidad: Number(l.cantidad),
        precioUnitario: Number(l.precio_unitario),
        tipo: l.tipo,
        corte: l.tipo === "corte" ? leerCorte(l.corte) : null,
        terminado: l.tipo === "terminado" ? leerTerminado(l.terminado) : null,
        produccionId: l.odoo_produccion_id,
        importe: num(l.importe) ?? importeDeProducto(Number(l.cantidad), Number(l.precio_unitario)),
      })),
  };
}

/** Las más recientes. Sin paginar todavía: a este ritmo, 300 son meses de trabajo. */
export async function cargarCotizaciones(limite = 300): Promise<Cotizacion[]> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from("cotizaciones")
    .select(COLUMNAS)
    .order("creado_en", { ascending: false })
    .limit(limite);
  if (error) throw new Error(`No se pudieron leer las cotizaciones: ${error.message}`);
  return ((data ?? []) as unknown as Fila[]).map(deFila);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * La cotización tal como está ahora mismo en la base. Para quien acaba de
 * escribirla en esta misma petición: `cargarCotizacion` recordaría la de antes.
 */
export async function leerCotizacion(id: string): Promise<Cotizacion | null> {
  // Un id mal formado haría fallar a Postgres con un error de sintaxis; es un 404.
  if (!UUID.test(id)) return null;
  const supabase = await clienteServidor();
  const { data, error } = await supabase.from("cotizaciones").select(COLUMNAS).eq("id", id).maybeSingle();
  if (error) throw new Error(`No se pudo leer la cotización: ${error.message}`);
  return data ? deFila(data as unknown as Fila) : null;
}

/** La misma, una vez por petición: para las páginas, que la piden desde varios sitios. */
export const cargarCotizacion = cache(leerCotizacion);

/** Lo que Administración ajustó de las cotizaciones, completado con los defectos. */
export const cargarConfigCotizaciones = cache(async (): Promise<ConfigCotizaciones> => {
  const supabase = await clienteServidor();
  const { data } = await supabase
    .from("configuracion")
    .select("valor")
    .eq("clave", CLAVE_CONFIG_COTIZACIONES)
    .maybeSingle();
  return leerConfigCotizaciones(data?.valor ?? null);
});

/* ── Sugerencias ───────────────────────────────────────────────────────────── */

/** Los últimos clientes cotizados, para el buscador vacío. */
export async function clientesRecientes(limite = 8): Promise<{ cliente: ClienteOdoo; veces: number }[]> {
  const supabase = await clienteServidor();
  const { data } = await supabase
    .from("clientes_cotizados")
    .select("odoo_partner_id, cliente_nombre, cliente_documento, cliente_telefono, veces")
    .order("ultima_vez", { ascending: false })
    .limit(limite);

  return (data ?? [])
    .filter((f) => f.odoo_partner_id !== null)
    .map((f) => ({
      cliente: {
        id: f.odoo_partner_id!,
        nombre: f.cliente_nombre ?? "(sin nombre)",
        documento: f.cliente_documento,
        telefono: f.cliente_telefono,
        email: null,
        ciudad: null,
        esEmpresa: false,
        empresa: null,
      },
      veces: f.veces ?? 0,
    }));
}

/**
 * Lo que se lee en cada tecla del buscador y cambia despacio: cuántas veces se
 * cotizó cada cliente y cada producto. Se recuerda un minuto por instancia para
 * no sumar una consulta a Supabase a cada letra.
 *
 * Compartirlo entre personas no salta la RLS: solo llega aquí quien puede
 * gestionar cotizaciones (`perfilConCotizaciones`), y todas ellas ven las mismas
 * filas. Los clientes recientes no pasan por aquí: tienen que verse al instante.
 */
const UN_MINUTO = 60_000;
const recordadas = new Map<string, { hasta: number; valor: Promise<Map<number, number>> }>();

function recordarUnMinuto(clave: string, leer: () => Promise<Map<number, number>>) {
  const previa = recordadas.get(clave);
  if (previa && previa.hasta > Date.now()) return previa.valor;
  const valor = leer();
  recordadas.set(clave, { hasta: Date.now() + UN_MINUTO, valor });
  valor.catch(() => recordadas.delete(clave));
  return valor;
}

/** Que lo recién cotizado empuje en la próxima búsqueda, sin esperar el minuto. */
export const olvidarPopularidad = () => recordadas.clear();

/** Cuántas veces se cotizó cada cliente, para desempatar en el buscador. */
export const popularidadClientes = () => recordarUnMinuto("clientes", leerPopularidadClientes);

/** Cuántas veces se cotizó cada producto en los últimos 90 días, de más a menos. */
export const popularidadProductos = () => recordarUnMinuto("productos", leerPopularidadProductos);

async function leerPopularidadClientes(): Promise<Map<number, number>> {
  const supabase = await clienteServidor();
  const { data } = await supabase
    .from("clientes_cotizados")
    .select("odoo_partner_id, veces")
    .order("veces", { ascending: false })
    .limit(1000);
  return new Map((data ?? []).map((f) => [f.odoo_partner_id!, f.veces ?? 0]));
}

async function leerPopularidadProductos(): Promise<Map<number, number>> {
  const supabase = await clienteServidor();
  const { data } = await supabase
    .from("productos_mas_cotizados")
    .select("odoo_product_id, veces")
    .order("veces", { ascending: false })
    .limit(1000);
  return new Map((data ?? []).map((f) => [f.odoo_product_id!, f.veces ?? 0]));
}

/* ── Odoo ──────────────────────────────────────────────────────────────────── */

/**
 * Una línea de la cotización, como va a Odoo.
 *
 * Un producto es una línea. Un corte son varias: la plancha, una línea por cada
 * precio distinto ("2 planchas completas", "1 media plancha"), y el servicio de
 * corte. La cantidad de planchas es la que Odoo descuenta del stock.
 */
export function lineasParaOdoo(
  l: LineaGuardada,
  /** Con el piloto de sobrantes, el producto "Corte a medida" del material. */
  corteAMedida?: { productoId: number; nombre: string; codigo: string },
): LineaParaOdoo[] {
  if (!l.corte) {
    return [
      {
        productoId: l.productoId,
        nombreProducto: l.nombre,
        codigo: l.codigo,
        cantidad: l.cantidad,
        precioUnitario: l.precioUnitario,
        // Un producto terminado se vende con su producto de Odoo y la ficha en la descripción.
        descripcion: l.terminado
          ? [l.terminado.estandar ? null : l.terminado.nombre, l.descripcion].filter(Boolean).join(". ")
          : l.descripcion,
      },
    ];
  }

  const corte = l.corte;
  const piezas = totalPiezas(corte.piezas);
  const paraCortar = `Para cortar: ${resumenPiezas(corte.piezas)}`;
  const servicio = (precio: number) => ({
    productoId: corte.servicio.productoId,
    nombreProducto: corte.servicio.nombre,
    codigo: corte.servicio.codigo,
    cantidad: 1,
    precioUnitario: precio,
    descripcion: `${piezas} ${piezas === 1 ? "pieza" : "piezas"} en ${materialDeCorte(corte)}`,
  });

  /* Con el piloto, el corte es un producto que se fabrica: se vende en m² de
     piezas, por el mismo importe que el cálculo por fracción de plancha. */
  if (corte.sobrantes && corteAMedida) {
    const m2 = lineasCorteAMedida(corte.montoMaterial, corte.montoServicio, areaPiezasM2(corte.piezas));
    return [
      {
        productoId: corteAMedida.productoId,
        nombreProducto: corteAMedida.nombre,
        codigo: corteAMedida.codigo,
        cantidad: m2.cantidad,
        precioUnitario: m2.precio,
        descripcion: paraCortar,
      },
      servicio(m2.servicio),
    ];
  }

  return [
    ...planchasPorCobro(corte).map((g) => ({
      // Con varios formatos, cada grupo con el producto de su plancha; el principal es el de la línea.
      productoId: g.formato.productoId ?? l.productoId,
      nombreProducto: g.formato.productoId ? (g.formato.nombre ?? g.formato.codigo) : l.nombre,
      codigo: g.formato.productoId ? g.formato.codigo : l.codigo,
      cantidad: g.cantidad,
      precioUnitario: g.monto,
      descripcion: g.nombre === "1" ? paraCortar : `Se cobra ${fraccionEnPalabras(g.nombre)}. ${paraCortar}`,
    })),
    servicio(corte.montoServicio),
  ];
}

/** El "Corte a medida" de cada corte con piloto, por posición: hay que tenerlo en Odoo antes de cotizar. */
async function productosDeCorte(lineas: LineaGuardada[]) {
  const salida = new Map<number, { productoId: number; nombre: string; codigo: string }>();
  for (const l of lineas) {
    if (!l.corte?.sobrantes) continue;
    const grupo = await cargarGrupoPlancha(l.corte.grupoId);
    const material = grupo ? materialOdoo(grupo) : null;
    if (!material) throw new ErrorOdoo("El material de un corte ya no tiene planchas en el catálogo.");
    salida.set(l.posicion, {
      productoId: await productoCorte(material),
      nombre: material.nombre.replace(/^SOBRANTE /, "CORTE A MEDIDA "),
      codigo: `${PREFIJO_CORTE}${material.codigoBase}`,
    });
  }
  return salida;
}

/**
 * El almacén del que sale una cotización: el elegido o, si nadie eligió, el
 * taller si algo se produce allí y la tienda si no.
 */
export async function almacenDeDespacho(
  c: Pick<Cotizacion, "almacenDespachoId" | "lineas">,
  opciones: { porStock?: boolean } = {},
): Promise<Almacen> {
  const almacenes = await cargarAlmacenes();
  const elegido = almacenes.find((a) => a.id === c.almacenDespachoId && a.activo);
  if (elegido) return elegido;
  // Sin uno elegido, lo dice el stock (de donde sale todo lo suelto); si Odoo no responde, la regla de siempre.
  if (opciones.porStock) {
    const porStock = await despachoPorStock(c.lineas);
    if (porStock) return porStock;
  }
  return almacenPorTipo(tipoDeDespacho(c.lineas));
}

export type ResultadoSincronizacion =
  | { ok: true; orderName: string }
  | { ok: false; error: string };

/**
 * Crea en Odoo la cotización de una fila que todavía no lo está, y anota el
 * resultado. Si Odoo falla, la fila queda en `error` con el motivo: lo cotizado
 * no se pierde y la pantalla ofrece reintentar.
 *
 * Reintentar no duplica: `crearPedidoDeVenta` busca primero una orden con la
 * marca de esta fila (ver `origenDe`).
 */
export async function sincronizarConOdoo(id: string): Promise<ResultadoSincronizacion> {
  // Sin la caché de la petición: quien llama puede haberla creado hace un instante.
  const c = await leerCotizacion(id);
  if (!c) return { ok: false, error: "La cotización ya no existe." };
  if (c.sincronizacion === "sincronizada" && c.odooOrderName) {
    return { ok: true, orderName: c.odooOrderName };
  }

  const supabase = await clienteServidor();

  try {
    const despacho = await almacenDeDespacho(c, { porStock: true });
    const warehouseId = (await odooDeAlmacen(despacho)).warehouseId;
    // Si el producto Corte a medida que la app recordaba ya no está en Odoo, se vuelve a crear.
    const venta = await alDia(async () => {
      const corteAMedida = await productosDeCorte(c.lineas);
      return crearPedidoDeVenta({
        cotizacionId: c.id,
        clienteId: c.cliente.id,
        lineas: c.lineas.flatMap((l) => lineasParaOdoo(l, corteAMedida.get(l.posicion))),
        warehouseId,
      });
    });

    const { data, error } = await supabase
      .from("cotizaciones")
      .update({
        almacen_despacho_id: despacho.id,
        odoo_order_id: venta.orderId,
        odoo_order_name: venta.orderName,
        sincronizacion: "sincronizada",
        error_sincronizacion: null,
        monto_sin_impuestos: venta.montoSinImpuestos,
        monto_impuestos: venta.montoImpuestos,
        monto_total: venta.montoTotal,
      })
      .eq("id", id)
      .select("id");

    if (error) {
      return {
        ok: false,
        error: `Se creó ${venta.orderName} en Odoo, pero no se pudo anotar aquí: ${mensajeDeError(error)}`,
      };
    }
    if (!data?.length) return { ok: false, error: "Tu rol no puede actualizar esta cotización." };
    return { ok: true, orderName: venta.orderName };
  } catch (e) {
    const mensaje =
      e instanceof ErrorOdoo ? e.message : "Algo falló al crear la cotización en Odoo.";
    if (!(e instanceof ErrorOdoo)) console.error("[cotizaciones] sincronizar", e);

    await supabase
      .from("cotizaciones")
      .update({ sincronizacion: "error", error_sincronizacion: mensaje })
      .eq("id", id);
    return { ok: false, error: mensaje };
  }
}

/**
 * Lleva a la cotización de Odoo lo que se editó en la app: el cliente y todas las
 * líneas. Es lo que cierra una edición: mientras no pase, la fila lleva
 * `error_edicion` y no se puede enviar ni sacar un pedido de ella.
 *
 * Si todavía no está en Odoo (nunca llegó, o falló al crearla), lo que hace es
 * crearla, con lo último que quedó guardado. Repetirla no duplica nada.
 */
export async function sincronizarCambiosConOdoo(id: string): Promise<ResultadoSincronizacion> {
  const c = await leerCotizacion(id);
  if (!c) return { ok: false, error: "La cotización ya no existe." };
  if (c.estado !== "borrador" || c.pedido) {
    return { ok: false, error: "Ya se envió o tiene pedido: lo cotizado no se cambia. Haz una versión nueva." };
  }
  if (!c.odooOrderId || c.sincronizacion !== "sincronizada") return sincronizarConOdoo(id);

  const supabase = await clienteServidor();
  try {
    const despacho = await almacenDeDespacho(c, { porStock: true });
    const warehouseId = (await odooDeAlmacen(despacho)).warehouseId;
    const orderId = c.odooOrderId;
    const venta = await alDia(async () => {
      const corteAMedida = await productosDeCorte(c.lineas);
      return actualizarPedidoDeVenta(orderId, {
        clienteId: c.cliente.id,
        lineas: c.lineas.flatMap((l) => lineasParaOdoo(l, corteAMedida.get(l.posicion))),
        warehouseId,
      });
    });

    const { data, error } = await supabase
      .from("cotizaciones")
      .update({
        almacen_despacho_id: despacho.id,
        odoo_order_name: venta.orderName,
        monto_sin_impuestos: venta.montoSinImpuestos,
        monto_impuestos: venta.montoImpuestos,
        monto_total: venta.montoTotal,
        error_edicion: null,
      })
      .eq("id", id)
      .select("id");
    if (error) {
      return {
        ok: false,
        error: `Se actualizó ${venta.orderName} en Odoo, pero no se pudo anotar aquí: ${mensajeDeError(error)}`,
      };
    }
    if (!data?.length) return { ok: false, error: "Tu rol no puede actualizar esta cotización." };
    return { ok: true, orderName: venta.orderName };
  } catch (e) {
    const mensaje = e instanceof ErrorOdoo ? e.message : "Algo falló al actualizar la cotización en Odoo.";
    if (!(e instanceof ErrorOdoo)) console.error("[cotizaciones] actualizar en Odoo", e);
    await supabase.from("cotizaciones").update({ error_edicion: mensaje }).eq("id", id);
    return { ok: false, error: mensaje };
  }
}

export type ResultadoEnvio =
  | {
      ok: true;
      /**
       * Si esta era la versión nueva de otra: qué pasó con la anterior en Odoo.
       * `null`: no era versión nueva, o la anterior no estaba en Odoo.
       */
      anterior: { orderName: string | null; canceladaEnOdoo: boolean; error: string | null } | null;
    }
  | { ok: false; error: string };

/**
 * Marca un borrador como enviada: desde ahí no se edita. Si era la versión nueva
 * de otra, la base deja la anterior como `reemplazada`, y aquí se cancela su
 * cotización en Odoo para que no queden dos vigentes (si Odoo no la cancela, la
 * versión nueva queda enviada igual y se avisa).
 */
export async function marcarEnviada(id: string): Promise<ResultadoEnvio> {
  const c = await leerCotizacion(id);
  if (!c) return { ok: false, error: "La cotización ya no existe." };
  const motivo = motivoNoEnviable(c);
  if (motivo) return { ok: false, error: motivo };

  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from("cotizaciones")
    .update({ estado: "enviada" })
    .eq("id", id)
    .eq("estado", "borrador")
    .select("id");
  if (error) return { ok: false, error: mensajeDeError(error) };
  if (!data?.length) return { ok: false, error: "Ya no es un borrador, o tu rol no puede cambiarla." };

  if (!c.reemplazaA) return { ok: true, anterior: null };

  // La anterior ya quedó `reemplazada` (lo hace la base). Falta la de Odoo.
  const { data: previa } = await supabase
    .from("cotizaciones")
    .select("odoo_order_id, odoo_order_name, pedido_id")
    .eq("id", c.reemplazaA)
    .maybeSingle();
  if (!previa?.odoo_order_id || previa.pedido_id) return { ok: true, anterior: null };

  try {
    await cancelarPedidoDeVenta(previa.odoo_order_id);
    return { ok: true, anterior: { orderName: previa.odoo_order_name, canceladaEnOdoo: true, error: null } };
  } catch (e) {
    if (!(e instanceof ErrorOdoo)) console.error("[cotizaciones] cancelar la anterior en Odoo", e);
    return {
      ok: true,
      anterior: {
        orderName: previa.odoo_order_name,
        canceladaEnOdoo: false,
        error: e instanceof ErrorOdoo ? e.message : "Algo falló al cancelarla en Odoo.",
      },
    };
  }
}

export type ResultadoVersionNueva =
  | { ok: true; id: string; enOdoo: boolean; errorOdoo: string | null }
  | { ok: false; error: string };

/**
 * Hace de una cotización enviada un borrador nuevo (v2, v3…) con lo mismo, y lo
 * crea en Odoo como una cotización más. La original no se toca hasta que la
 * nueva se envíe: así, si la versión nueva no prospera, lo que se le ofreció al
 * cliente sigue vigente.
 */
export async function crearVersionNueva(id: string): Promise<ResultadoVersionNueva> {
  const supabase = await clienteServidor();
  const { data: nuevoId, error } = await supabase.rpc("nueva_version_cotizacion", { p_id: id });
  if (error || !nuevoId) return { ok: false, error: mensajeDeError(error) };

  if (!odooConfigurado()) return { ok: true, id: nuevoId, enOdoo: false, errorOdoo: null };
  const r = await sincronizarConOdoo(nuevoId);
  olvidarPopularidad();
  return r.ok
    ? { ok: true, id: nuevoId, enOdoo: true, errorOdoo: null }
    : { ok: true, id: nuevoId, enOdoo: false, errorOdoo: r.error };
}

/** La versión siguiente de una cotización (la que la reemplaza o la reemplazará), si la hay. */
export async function versionSiguiente(
  id: string,
): Promise<{ id: string; version: number; estado: "borrador" | "enviada" | "reemplazada"; odooOrderName: string | null } | null> {
  if (!UUID.test(id)) return null;
  const supabase = await clienteServidor();
  const { data } = await supabase
    .from("cotizaciones")
    .select("id, version, estado, odoo_order_name")
    .eq("reemplaza_a", id)
    .maybeSingle();
  return data
    ? { id: data.id, version: data.version, estado: data.estado, odooOrderName: data.odoo_order_name }
    : null;
}

/** La versión anterior (a la que esta reemplaza), con lo mínimo para enlazarla. */
export async function versionAnterior(
  id: string | null,
): Promise<{ id: string; version: number; odooOrderName: string | null } | null> {
  if (!id || !UUID.test(id)) return null;
  const supabase = await clienteServidor();
  const { data } = await supabase
    .from("cotizaciones")
    .select("id, version, odoo_order_name")
    .eq("id", id)
    .maybeSingle();
  return data ? { id: data.id, version: data.version, odooOrderName: data.odoo_order_name } : null;
}

/**
 * Confirma en Odoo la cotización de la que salió un pedido: la `sale.order` pasa
 * de cotización a pedido de venta. Anota el resultado en la fila; si Odoo falla,
 * queda el motivo y el detalle ofrece "Confirmar en Odoo".
 *
 * Corre después del alta del pedido y nunca la deshace: el taller no tiene por
 * qué esperar a que Odoo conteste. Repetirla no hace nada si ya está confirmada.
 */
export async function confirmarEnOdoo(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await clienteServidor();
  // Sin `cargarCotizacion`: está en caché por petición, y el alta acaba de cambiar la fila.
  const { data: c, error } = await supabase
    .from("cotizaciones")
    .select("odoo_order_id, pedido_id")
    .eq("id", id)
    .maybeSingle();
  if (error) return { ok: false, error: mensajeDeError(error) };
  if (!c) return { ok: false, error: "La cotización ya no existe." };
  if (!c.pedido_id) return { ok: false, error: "Esta cotización todavía no tiene pedido." };

  // Un pedido registrado con Odoo caído: primero hay que crear la orden allá.
  let orderId = c.odoo_order_id;
  if (!orderId) {
    const creada = await sincronizarConOdoo(id);
    if (!creada.ok) return { ok: false, error: `No se creó en Odoo: ${creada.error}` };
    const { data: ahora } = await supabase.from("cotizaciones").select("odoo_order_id").eq("id", id).maybeSingle();
    orderId = ahora?.odoo_order_id ?? null;
    if (!orderId) return { ok: false, error: "La cotización se creó en Odoo, pero no quedó anotada aquí." };
  }

  let resultado: { ok: true } | { ok: false; error: string };
  try {
    await confirmarPedidoDeVenta(orderId);
    resultado = { ok: true };
  } catch (e) {
    if (!(e instanceof ErrorOdoo)) console.error("[cotizaciones] confirmar en Odoo", e);
    resultado = {
      ok: false,
      error: e instanceof ErrorOdoo ? e.message : "Algo falló al confirmar la cotización en Odoo.",
    };
  }

  const { error: alAnotar } = await supabase
    .from("cotizaciones")
    .update(
      resultado.ok
        ? { confirmada_en_odoo: true, error_confirmacion: null }
        : { confirmada_en_odoo: false, error_confirmacion: resultado.error },
    )
    .eq("id", id);
  if (alAnotar && resultado.ok) {
    return { ok: false, error: `Se confirmó en Odoo, pero no se pudo anotar aquí: ${mensajeDeError(alAnotar)}` };
  }
  if (!resultado.ok) return resultado;

  /* Con la venta confirmada, las órdenes de fabricación de los cortes con piloto:
     son las que reservan sus planchas. Si fallan, se vuelven a intentar al
     pasar a Listo. */
  const cotizacion = await leerCotizacion(id);
  if (!cotizacion) return resultado;
  const cortes = await producirCortes(id, orderId, cotizacion.lineas);
  if (!cortes.ok) return cortes;
  // Y las de los productos terminados que pidieron reservar su material estimado.
  return reservarTerminados(id, orderId, cotizacion.lineas);
}

/**
 * Registra en la tabla la cotización que acaba de crear el asistente en Odoo.
 * Corre después de responder al chat (`after`), así que nunca lo frena ni lo
 * rompe: si algo falla, se anota en el log y el chat sigue como si nada.
 *
 * Se puede repetir: `crear_cotizacion` devuelve la fila existente si esa orden
 * ya estaba registrada.
 */
export async function registrarDesdeAsistente(chatId: string, orderId: number): Promise<void> {
  if (!odooConfigurado()) return;
  try {
    const supabase = await clienteServidor();
    const { data: ya } = await supabase
      .from("cotizaciones")
      .select("id")
      .eq("odoo_order_id", orderId)
      .maybeSingle();
    if (ya) return;

    const venta = await leerPedidoDeVenta(orderId);
    if (!venta || venta.lineas.length === 0) return;
    const cliente = await leerCliente(venta.clienteId);

    const { error } = await supabase.rpc("crear_cotizacion", {
      p_canal: "tienda",
      p_odoo_partner_id: venta.clienteId,
      p_cliente_nombre: cliente?.nombre ?? `Cliente ${venta.clienteId}`,
      p_cliente_documento: cliente?.documento ?? undefined,
      p_cliente_telefono: cliente?.telefono ?? undefined,
      p_lineas: venta.lineas.map((l) => ({
        odoo_product_id: l.productoId,
        producto_nombre: l.nombre,
        producto_codigo: l.codigo,
        descripcion: l.descripcion,
        cantidad: l.cantidad,
        precio_unitario: l.precioUnitario,
      })),
      p_odoo_order_id: venta.orderId,
      p_odoo_order_name: venta.orderName,
      p_monto_sin_impuestos: venta.montoSinImpuestos ?? undefined,
      p_monto_impuestos: venta.montoImpuestos ?? undefined,
      p_monto_total: venta.montoTotal ?? undefined,
      p_chat_agente_id: chatId,
    });
    if (error) console.error("[cotizaciones] registrar desde el asistente", error.message);
  } catch (e) {
    console.error("[cotizaciones] registrar desde el asistente", e);
  }
}

/**
 * Cambia el almacén del que sale una cotización. Mientras es cotización en Odoo
 * se cambia también allá; una vez confirmada, Odoo ya armó la entrega desde el
 * almacén que tenía, y no se toca.
 */
export async function cambiarAlmacenDespacho(id: string, almacenId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const c = await leerCotizacion(id);
  if (!c) return { ok: false, error: "La cotización ya no existe." };
  if (c.confirmadaEnOdoo) {
    return { ok: false, error: "Ya es pedido de venta en Odoo: su entrega sale del almacén que tenía." };
  }
  const almacen = (await cargarAlmacenes()).find((a) => a.id === almacenId && a.activo);
  if (!almacen) return { ok: false, error: "Ese almacén ya no está activo." };

  if (c.odooOrderId && odooConfigurado()) {
    try {
      const cambiado = await cambiarAlmacenDeVenta(c.odooOrderId, (await odooDeAlmacen(almacen)).warehouseId);
      if (!cambiado) return { ok: false, error: "En Odoo ya no es cotización: su entrega sale del almacén que tenía." };
    } catch (e) {
      if (!(e instanceof ErrorOdoo)) console.error("[cotizaciones] cambiar almacén", e);
      return { ok: false, error: e instanceof ErrorOdoo ? e.message : "Algo falló al cambiar el almacén en Odoo." };
    }
  }
  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from("cotizaciones")
    .update({ almacen_despacho_id: almacen.id })
    .eq("id", id)
    .select("id");
  if (error) return { ok: false, error: mensajeDeError(error) };
  if (!data?.length) return { ok: false, error: "Tu rol no puede cambiar esta cotización." };
  return { ok: true };
}
