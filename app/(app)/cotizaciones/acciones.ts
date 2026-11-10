"use server";

/**
 * Registrar cotizaciones y llevarlas a Odoo.
 *
 * Las mismas reglas que `app/(app)/acciones.ts`: se escribe con la sesión de
 * quien pide, se revalida con Zod aunque el formulario ya lo hiciera, y del
 * navegador llegan referencias, no filas. Aquí eso significa: llegan ids de
 * Odoo, cantidades y precios; el nombre y el código de cada producto, y el
 * nombre del cliente, los vuelve a leer el servidor.
 *
 * Buscar NO está aquí: va por `app/api/cotizaciones/buscar/*`. Las Server
 * Actions se despachan de a una por cliente, y un buscador que escribe mientras
 * se teclea las encolaría.
 */

import { refresh } from "next/cache";
import { exigirCotizaciones } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase-servidor";
import { mensajeDeError } from "@/lib/errores";
import { esquemaNuevaCotizacion, esquemaNuevoClienteOdoo } from "@/lib/esquemas";
import { confirmarEnOdoo, olvidarPopularidad, sincronizarConOdoo } from "@/lib/cotizaciones-servidor";
import { prepararCorte } from "@/lib/cortes-servidor";
import type { Json } from "@/lib/supabase-tipos";
import { indiceClientes, productosPorId } from "@/lib/odoo/catalogos";
import { crearCliente, leerCliente } from "@/lib/odoo/clientes";
import { ErrorOdoo, ODOO_NO_CONFIGURADO, odooConfigurado } from "@/lib/odoo/rpc";
import type { ClienteOdoo } from "@/lib/odoo/tipos";

type Fallo = { ok: false; error: string };

export type ResultadoCreacion =
  | {
      ok: true;
      id: string;
      /** Si ya quedó en Odoo. `false` es "se guardó, pero Odoo falló": hay que reintentar. */
      enOdoo: boolean;
      orderName: string | null;
      errorOdoo: string | null;
    }
  | Fallo;

const fallo = (error: string): Fallo => ({ ok: false, error });

const mensajeOdoo = (e: unknown) =>
  e instanceof ErrorOdoo ? e.message : "No se pudo hablar con Odoo. Intenta de nuevo.";

export async function crearCotizacion(entrada: unknown): Promise<ResultadoCreacion> {
  await exigirCotizaciones();
  if (!odooConfigurado()) return fallo(ODOO_NO_CONFIGURADO);

  const datos = esquemaNuevaCotizacion.safeParse(entrada);
  if (!datos.success) return fallo(datos.error.issues[0]?.message ?? "Los datos no son válidos.");
  const v = datos.data;

  // Lo que se guarda de Odoo sale de Odoo, no del POST.
  const deProducto = v.lineas.filter((l) => l.tipo !== "corte");
  let cliente: ClienteOdoo | null;
  let productos: Awaited<ReturnType<typeof productosPorId>>;
  try {
    [cliente, productos] = await Promise.all([
      leerCliente(v.clienteId),
      productosPorId(deProducto.map((l) => l.productoId)),
    ]);
  } catch (e) {
    return fallo(mensajeOdoo(e));
  }
  if (!cliente) return fallo("Ese cliente ya no existe en Odoo. Búscalo de nuevo.");

  const lineas = [];
  for (const l of v.lineas) {
    if (l.tipo === "corte") {
      // El corte se calcula aquí otra vez: su precio no llega del navegador.
      let corte: Awaited<ReturnType<typeof prepararCorte>>;
      try {
        corte = await prepararCorte(l);
      } catch (e) {
        return fallo(mensajeOdoo(e));
      }
      if (!corte.ok) return fallo(corte.error);
      lineas.push(corte.fila);
      continue;
    }
    const p = productos.get(l.productoId);
    if (!p) return fallo("Uno de los productos ya no existe en Odoo. Quítalo y vuelve a buscarlo.");
    lineas.push({
      tipo: "producto" as const,
      odoo_product_id: p.id,
      producto_nombre: p.nombre,
      producto_codigo: p.codigo,
      descripcion: l.descripcion || null,
      cantidad: l.cantidad,
      precio_unitario: l.precioUnitario,
    });
  }

  const supabase = await clienteServidor();
  const { data: id, error } = await supabase.rpc("crear_cotizacion", {
    p_canal: v.canal,
    p_odoo_partner_id: cliente.id,
    p_cliente_nombre: cliente.nombre,
    p_cliente_documento: cliente.documento ?? undefined,
    p_cliente_telefono: cliente.telefono ?? undefined,
    p_lineas: lineas as unknown as Json,
    p_notas: v.notas ?? undefined,
  });
  if (error || !id) return fallo(mensajeDeError(error));

  /* Primero se guarda y después se va a Odoo: si Odoo está caído, lo tecleado
     no se pierde. La fila queda en `error` y el detalle ofrece reintentar. */
  const r = await sincronizarConOdoo(id);
  olvidarPopularidad();
  refresh();

  return r.ok
    ? { ok: true, id, enOdoo: true, orderName: r.orderName, errorOdoo: null }
    : { ok: true, id, enOdoo: false, orderName: null, errorOdoo: r.error };
}

export async function reintentarSincronizacion(
  id: string,
): Promise<{ ok: true; orderName: string } | Fallo> {
  await exigirCotizaciones();
  if (!odooConfigurado()) return fallo(ODOO_NO_CONFIGURADO);
  if (typeof id !== "string") return fallo("Falta la cotización.");

  const r = await sincronizarConOdoo(id);
  refresh();
  return r;
}

/** Vuelve a pedirle a Odoo que confirme la cotización de la que ya salió un pedido. */
export async function reintentarConfirmacion(id: string): Promise<{ ok: true } | Fallo> {
  await exigirCotizaciones();
  if (!odooConfigurado()) return fallo(ODOO_NO_CONFIGURADO);
  if (typeof id !== "string") return fallo("Falta la cotización.");

  const r = await confirmarEnOdoo(id);
  refresh();
  return r;
}

export type ResultadoCliente = { ok: true; cliente: ClienteOdoo; existia: boolean } | Fallo;

/**
 * Crea el cliente en Odoo desde el buscador. Si ya había uno con ese RUC/DNI,
 * devuelve ese (`existia`) en vez de duplicarlo.
 */
export async function crearClienteOdoo(entrada: unknown): Promise<ResultadoCliente> {
  await exigirCotizaciones();
  if (!odooConfigurado()) return fallo(ODOO_NO_CONFIGURADO);

  const datos = esquemaNuevoClienteOdoo.safeParse(entrada);
  if (!datos.success) return fallo(datos.error.issues[0]?.message ?? "Los datos no son válidos.");

  try {
    const r = await crearCliente(datos.data);
    // Que aparezca en la próxima búsqueda sin esperar al refresco del índice.
    indiceClientes().agregar(r.cliente);
    return { ok: true, ...r };
  } catch (e) {
    return fallo(mensajeOdoo(e));
  }
}
