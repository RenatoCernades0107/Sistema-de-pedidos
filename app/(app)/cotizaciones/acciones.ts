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
import { esquemaNuevaCotizacion, esquemaNuevoClienteOdoo, esquemaNuevoContacto } from "@/lib/esquemas";
import { cambiarAlmacenDespacho, confirmarEnOdoo, olvidarPopularidad, sincronizarConOdoo } from "@/lib/cotizaciones-servidor";
import { mensajeOdoo, registrarCotizacion } from "@/lib/cotizaciones-registro";
import { indiceClientes } from "@/lib/odoo/catalogos";
import {
  contactosDeEmpresa,
  crearCliente,
  crearContacto,
  leerCliente,
  leerContacto,
  type ClienteCreado,
} from "@/lib/odoo/clientes";
import type { ClienteOdoo, ContactoOdoo } from "@/lib/odoo/tipos";
import { ODOO_NO_CONFIGURADO, odooConfigurado } from "@/lib/odoo/rpc";

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

export async function crearCotizacion(entrada: unknown): Promise<ResultadoCreacion> {
  await exigirCotizaciones();
  if (!odooConfigurado()) return fallo(ODOO_NO_CONFIGURADO);

  const datos = esquemaNuevaCotizacion.safeParse(entrada);
  if (!datos.success) return fallo(datos.error.issues[0]?.message ?? "Los datos no son válidos.");
  const v = datos.data;

  // Lo que se guarda de Odoo sale de Odoo, no del POST.
  const guardada = await registrarCotizacion(v);
  if (!guardada.ok) return guardada;
  const { id } = guardada;

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

/** De qué almacén sale la venta, mientras todavía es cotización en Odoo. */
export async function cambiarAlmacenDeCotizacion(id: unknown, almacenId: unknown): Promise<{ ok: true } | Fallo> {
  await exigirCotizaciones();
  if (typeof id !== "string" || typeof almacenId !== "string") return fallo("Faltan la cotización o el almacén.");
  const r = await cambiarAlmacenDespacho(id, almacenId);
  refresh();
  return r;
}

export type ResultadoCliente = ({ ok: true } & ClienteCreado) | Fallo;

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

/* ── Contactos de una empresa ──────────────────────────────────────────────── */

/** Las personas de una empresa, leídas de Odoo en el momento: acaban de agregar una y tiene que verse. */
export async function contactosDeCliente(empresaId: unknown): Promise<{ ok: true; contactos: ContactoOdoo[] } | Fallo> {
  await exigirCotizaciones();
  if (!odooConfigurado()) return fallo(ODOO_NO_CONFIGURADO);
  if (typeof empresaId !== "number" || !Number.isInteger(empresaId) || empresaId <= 0) {
    return fallo("Falta la empresa.");
  }
  try {
    return { ok: true, contactos: await contactosDeEmpresa(empresaId) };
  } catch (e) {
    return fallo(mensajeOdoo(e));
  }
}

/** Agrega una persona a una empresa que ya existe en Odoo. */
export async function agregarContactoOdoo(entrada: unknown): Promise<{ ok: true; contacto: ContactoOdoo } | Fallo> {
  await exigirCotizaciones();
  if (!odooConfigurado()) return fallo(ODOO_NO_CONFIGURADO);

  const datos = esquemaNuevoContacto.safeParse(entrada);
  if (!datos.success) return fallo(datos.error.issues[0]?.message ?? "Los datos no son válidos.");

  try {
    const { empresaId, ...contacto } = datos.data;
    return { ok: true, contacto: await crearContacto(empresaId, contacto) };
  } catch (e) {
    return fallo(mensajeOdoo(e));
  }
}

/**
 * Se buscó por el nombre de una persona y salió ella. Elegirla es elegir a su
 * empresa con ella de contacto: la cotización es de la empresa, que es la del RUC.
 */
export async function empresaDeContacto(
  contactoId: unknown,
): Promise<{ ok: true; empresa: ClienteOdoo; contacto: ContactoOdoo } | Fallo> {
  await exigirCotizaciones();
  if (!odooConfigurado()) return fallo(ODOO_NO_CONFIGURADO);
  if (typeof contactoId !== "number" || !Number.isInteger(contactoId) || contactoId <= 0) {
    return fallo("Falta el contacto.");
  }
  try {
    const contacto = await leerContacto(contactoId);
    const empresa = contacto ? await leerCliente(contacto.empresaId) : null;
    if (!contacto || !empresa) return fallo("No se encontró la empresa de ese contacto en Odoo.");
    return { ok: true, empresa, contacto };
  } catch (e) {
    return fallo(mensajeOdoo(e));
  }
}
