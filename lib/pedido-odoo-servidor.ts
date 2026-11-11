/**
 * Lo que un pedido le pide a Odoo después de registrarse: descontar el stock al
 * terminarlo y soltar la reserva si se anula.
 *
 * Lo pide quien mueve el pedido, que puede ser el taller. El taller no lee
 * `cotizaciones` (su RLS es de Administración), así que todo pasa por las
 * funciones de ventanilla de la base: `lineas_de_pedido()` y `odoo_de_pedido()`
 * para leer, `anotar_stock_de_pedido()` y `anotar_anulacion_en_odoo()` para
 * escribir. A Odoo se va con la cuenta del servidor, como en el resto de la app.
 */

import { cache } from "react";
import { leerCorte } from "./cortes/guardado";
import { mensajeDeError } from "./errores";
import { cancelarPedidoDeVenta, validarEntrega } from "./odoo/entregas";
import { ErrorOdoo, ODOO_NO_CONFIGURADO, odooConfigurado } from "./odoo/rpc";
import { cantidadesParaDescontar, type LineaDePedido, type OdooDePedido } from "./pedido-lineas";
import { clienteServidor } from "./supabase-servidor";

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export async function leerLineasDePedido(codigo: string): Promise<LineaDePedido[]> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase.rpc("lineas_de_pedido", { p_codigo: codigo });
  if (error) throw new Error(`No se pudieron leer las líneas del pedido: ${error.message}`);
  return (data ?? []).map((f) => ({
    posicion: f.posicion,
    productoId: f.odoo_product_id,
    nombre: f.producto_nombre,
    codigo: f.producto_codigo,
    descripcion: f.descripcion,
    cantidad: Number(f.cantidad),
    corte: f.tipo === "corte" ? leerCorte(f.corte) : null,
    planchasUsadas: num(f.planchas_usadas),
    importe: num(f.importe),
  }));
}

export async function leerOdooDePedido(codigo: string): Promise<OdooDePedido | null> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase.rpc("odoo_de_pedido", { p_codigo: codigo });
  if (error) throw new Error(`No se pudo leer cómo va el pedido en Odoo: ${error.message}`);
  const f = data?.[0];
  if (!f) return null;
  return {
    cotizacionId: f.cotizacion_id,
    orderId: f.odoo_order_id,
    orderName: f.odoo_order_name,
    enOdoo: f.sincronizacion === "sincronizada",
    confirmada: f.confirmada_en_odoo,
    stockDescontado: f.stock_descontado,
    errorStock: f.error_stock,
    anuladaEnOdoo: f.anulada_en_odoo,
    errorAnulacion: f.error_anulacion,
  };
}

/** Las dos, una vez por petición: para la página del detalle. */
export const cargarLineasDePedido = cache(leerLineasDePedido);
export const cargarOdooDePedido = cache(leerOdooDePedido);

export type ResultadoOdoo = { ok: true; nada?: boolean } | { ok: false; error: string };

const mensaje = (e: unknown, contexto: string) => {
  if (e instanceof ErrorOdoo) return e.message;
  console.error(`[pedidos] ${contexto}`, e);
  return "Algo falló al hablar con Odoo.";
};

/**
 * Descuenta en Odoo el stock de un pedido terminado: valida la entrega con las
 * planchas que el taller anotó en cada corte o, si no anotó, las calculadas. El
 * resultado queda anotado en la cotización; si falla, con el motivo, para
 * reintentar desde el detalle del pedido.
 *
 * Se puede repetir. Un pedido sin cotización (los de antes de los productos de
 * Odoo) no tiene nada que descontar.
 */
export async function descontarStockDePedido(codigo: string): Promise<ResultadoOdoo> {
  const odoo = await leerOdooDePedido(codigo);
  if (!odoo || odoo.stockDescontado) return { ok: true, nada: true };

  let resultado: ResultadoOdoo;
  if (!odooConfigurado()) {
    resultado = { ok: false, error: ODOO_NO_CONFIGURADO };
  } else if (!odoo.orderId) {
    resultado = {
      ok: false,
      error: "El pedido todavía no está en Odoo. Administración tiene que crearlo desde su cotización.",
    };
  } else {
    try {
      const lineas = await leerLineasDePedido(codigo);
      await validarEntrega(odoo.orderId, cantidadesParaDescontar(lineas));
      resultado = { ok: true };
    } catch (e) {
      resultado = { ok: false, error: mensaje(e, "descontar stock") };
    }
  }

  const supabase = await clienteServidor();
  const { error } = await supabase.rpc("anotar_stock_de_pedido", {
    p_codigo: codigo,
    p_descontado: resultado.ok,
    p_error: resultado.ok ? undefined : resultado.error,
  });
  if (error && resultado.ok) {
    return { ok: false, error: `El stock bajó en Odoo, pero no se pudo anotar aquí: ${mensajeDeError(error)}` };
  }
  return resultado;
}

/**
 * Cancela en Odoo la venta de un pedido anulado, para que las planchas
 * reservadas vuelvan a estar libres. Si el stock ya se había descontado no se
 * toca: deshacerlo es una devolución, y se hace en Odoo.
 */
export async function cancelarVentaDePedido(codigo: string): Promise<ResultadoOdoo> {
  const odoo = await leerOdooDePedido(codigo);
  if (!odoo || odoo.anuladaEnOdoo || !odoo.orderId) return { ok: true, nada: true };

  let resultado: ResultadoOdoo;
  if (odoo.stockDescontado) {
    resultado = {
      ok: false,
      error: `Las planchas ya salieron del almacén: la devolución se hace en Odoo, en ${odoo.orderName ?? "la orden"}.`,
    };
  } else if (!odooConfigurado()) {
    resultado = { ok: false, error: ODOO_NO_CONFIGURADO };
  } else {
    try {
      await cancelarPedidoDeVenta(odoo.orderId);
      resultado = { ok: true };
    } catch (e) {
      resultado = { ok: false, error: mensaje(e, "cancelar venta") };
    }
  }

  const supabase = await clienteServidor();
  const { error } = await supabase.rpc("anotar_anulacion_en_odoo", {
    p_codigo: codigo,
    p_anulada: resultado.ok,
    p_error: resultado.ok ? undefined : resultado.error,
  });
  if (error && resultado.ok) {
    return { ok: false, error: `Se canceló en Odoo, pero no se pudo anotar aquí: ${mensajeDeError(error)}` };
  }
  return resultado;
}
