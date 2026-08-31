"use server";

/**
 * Todo lo que la app escribe en la base pasa por aquí.
 *
 * Tres reglas que se repiten en las siete acciones:
 *
 *   1. **Se escribe con la sesión de quien pide el cambio**, nunca con
 *      `service_role`. Con la clave de servicio `auth.uid()` es NULL, y entonces el
 *      historial y la auditoría quedan sin firmar y el trigger que reparte columnas
 *      por rol se rinde en su primera línea. La seguridad del sistema depende de
 *      que estas escrituras vayan autenticadas.
 *   2. **Del cliente llega la referencia y el cambio, no la fila.** Una Server
 *      Action es un POST público: que el formulario haya validado no dice nada de
 *      quien manda el POST a mano. De ahí que se revalide con el mismo esquema Zod
 *      y que el permiso se compruebe aquí y no al pintar el botón.
 *   3. **Solo se envían las columnas que el rol puede tocar.** El trigger
 *      `pedidos_escritura_por_rol` compara OLD contra NEW columna a columna, y una
 *      columna fuera del GRANT da 42501 aunque lleve el mismo valor que ya tenía.
 *
 * Lo que no está aquí es a propósito: el código del pedido, el historial, la
 * auditoría, `monto_pagado` y las fechas de cierre los escribe Postgres.
 */

import { refresh } from "next/cache";
import { clienteServidor } from "@/lib/supabase-servidor";
import { exigirCrearPedido, exigirSesion, type Perfil } from "@/lib/sesion";
import { ROLES, requiereFactura, requiereMotivo } from "@/lib/dominio";
import { ERROR_SIN_FILAS, mensajeDeError } from "@/lib/errores";
import {
  esquemaAbono,
  esquemaCambioEstado,
  esquemaDatosEditables,
  esquemaEnvio,
  esquemaNuevoPedido,
  esquemaResponsable,
  esquemaUbicacion,
} from "@/lib/esquemas";
import type { z } from "zod";
import type { TablesUpdate } from "@/lib/supabase-tipos";

/** Las columnas de `pedidos` que se pueden mandar en un UPDATE. */
type CambiosPedido = TablesUpdate<"pedidos">;

export type Resultado = { ok: true; codigo?: string } | { ok: false; error: string };

const fallo = (error: string): Resultado => ({ ok: false, error });

/** El primer mensaje de Zod, que es el que el formulario ya habría enseñado. */
function falloDeEsquema(error: z.ZodError): Resultado {
  return fallo(error.issues[0]?.message ?? "Los datos no son válidos.");
}

/**
 * El uuid interno del pedido a partir del código. `id` y `codigo` están en el
 * GRANT SELECT de la tabla, así que esta consulta la puede hacer cualquier rol.
 */
async function idDePedido(codigo: string) {
  const supabase = await clienteServidor();
  const { data } = await supabase
    .from("pedidos")
    .select("id")
    .eq("codigo", codigo)
    .maybeSingle();
  return data?.id ?? null;
}

/**
 * Un UPDATE bloqueado por la RLS no lanza error: afecta a cero filas. Sin este
 * `select` la app cantaría un éxito que no ocurrió.
 */
async function actualizarPedido(codigo: string, cambios: CambiosPedido) {
  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from("pedidos")
    .update(cambios)
    .eq("codigo", codigo)
    .select("id");

  if (error) return fallo(mensajeDeError(error));
  if (!data || data.length === 0) return fallo(ERROR_SIN_FILAS);

  refresh();
  return { ok: true } as const;
}

/* ── Registrar un pedido ────────────────────────────────────────────────────── */

export async function crearPedido(entrada: unknown): Promise<Resultado> {
  await exigirCrearPedido();

  const datos = esquemaNuevoPedido.safeParse(entrada);
  if (!datos.success) return falloDeEsquema(datos.error);
  const v = datos.data;

  /* Al contado se cobra el total en el acto, a cuenta lo que se haya adelantado, y
     al crédito no entra nada todavía. Lo decide el servidor: el importe cobrado no
     es algo que deba llegar del navegador. */
  const abono =
    v.tipoPago === "contado"
      ? v.montoTotal
      : v.tipoPago === "a_cuenta"
        ? Math.min(v.abonoInicial, v.montoTotal)
        : 0;

  /* Los argumentos opcionales de `crear_pedido` van sin `null`: los tipos generados
     los declaran `?: T`, y en la función todos tienen `default null`. Omitir uno y
     mandarlo en null es lo mismo, así que lo que aquí no viaja se queda en null. */
  const sinValor = <T,>(valor: T | null) => valor ?? undefined;

  const supabase = await clienteServidor();
  const { data, error } = await supabase.rpc("crear_pedido", {
    p_es_provincia: v.esProvincia,
    p_nombre_cliente: v.cliente,
    p_telefono_cliente: sinValor(v.telefonoCliente),
    p_tipos_pedido: v.tipos,
    p_tipo_producto_terminado: sinValor(v.tipos.includes("PT") ? v.producto : null),
    p_cantidad: v.cantidad,
    p_tipo_pago: v.tipoPago,
    p_plazo_credito_dias: sinValor(v.tipoPago === "credito" ? v.plazoCredito : null),
    p_monto_total: v.montoTotal,
    p_lugar_entrega: v.entrega,
    p_direccion_entrega: sinValor(v.entrega === "domicilio" ? v.direccion : null),
    // Un pedido nace donde se registra; el taller lo mueve cuando lo recoge.
    p_ubicacion_actual: v.entrega === "taller" ? "taller" : "tienda",
    p_fecha_prometida: v.fechaPrometida,
    p_detalle: v.detalle,
    p_observaciones: sinValor(v.observaciones),
    p_responsable_id: sinValor(v.responsableId),
    p_departamento_id: sinValor(v.envio?.departamentoId ?? null),
    p_provincia_id: sinValor(v.envio?.provinciaId ?? null),
    p_nombre_agencia: sinValor(v.envio?.agencia ?? null),
    p_nombre_persona_recoge: sinValor(v.envio?.personaQueRecoge ?? null),
    p_tipo_documento: v.envio?.tipoDocumento ?? "DNI",
    p_numero_documento: sinValor(v.envio?.numeroDocumento ?? null),
    p_telefono_persona_recoge: sinValor(v.envio?.telefono ?? null),
    p_monto_flete: v.envio?.montoFlete ?? 0,
    p_flete_pagado: v.envio?.fletePagado ?? false,
    p_observaciones_envio: sinValor(v.envio?.observacionesEnvio ?? null),
    p_abono_inicial: abono,
    p_metodo_pago: v.metodoPago,
  });

  if (error) return fallo(mensajeDeError(error));

  refresh();
  return { ok: true, codigo: data ?? undefined };
}

/* ── Mover el estado ────────────────────────────────────────────────────────── */

/**
 * El estado, el motivo y la factura viajan en un solo UPDATE. Tienen que ir juntos:
 * el CHECK que exige factura para entregar mira la fila entera, así que enviarlos
 * en dos sentencias haría fallar la primera.
 */
export async function cambiarEstado(entrada: unknown): Promise<Resultado> {
  const perfil = await exigirSesion();

  const datos = esquemaCambioEstado.safeParse(entrada);
  if (!datos.success) return falloDeEsquema(datos.error);
  const { codigo, estado, motivo, numeroFactura } = datos.data;

  if (requiereMotivo(estado) && !motivo) {
    return fallo("Explica el motivo: queda en el historial del pedido.");
  }

  const cambios: CambiosPedido = {
    estado,
    // Salir de observado o anulado limpia el motivo: si no, se queda pegado el de
    // la vez anterior y el historial cuenta otra cosa.
    motivo: requiereMotivo(estado) ? motivo : null,
  };

  /* La factura solo la escribe Administración: es la única que puede leerla y la
     única que la tiene en `permitidas`. Para los demás roles el pedido ya tiene
     que venir facturado, y de eso avisa la UI con `tieneFactura`. */
  if (requiereFactura(estado) && numeroFactura && ROLES[perfil.rol].editarTodo) {
    cambios.numero_factura = numeroFactura;
  }

  return actualizarPedido(codigo, cambios);
}

/* ── Ubicación y responsable ────────────────────────────────────────────────── */

export async function cambiarUbicacion(entrada: unknown): Promise<Resultado> {
  const perfil = await exigirSesion();
  if (!ROLES[perfil.rol].editarUbicacion) return fallo("Tu rol no cambia la ubicación.");

  const datos = esquemaUbicacion.safeParse(entrada);
  if (!datos.success) return falloDeEsquema(datos.error);

  return actualizarPedido(datos.data.codigo, { ubicacion_actual: datos.data.ubicacion });
}

export async function asignarResponsable(entrada: unknown): Promise<Resultado> {
  const perfil = await exigirSesion();
  if (!ROLES[perfil.rol].asignarResponsable) return fallo("Tu rol no asigna el responsable.");

  const datos = esquemaResponsable.safeParse(entrada);
  if (!datos.success) return falloDeEsquema(datos.error);

  return actualizarPedido(datos.data.codigo, { responsable_id: datos.data.responsableId });
}

/* ── Corregir los datos del pedido ──────────────────────────────────────────── */

/**
 * Se mandan todos los campos editables, cambien o no: el trigger de auditoría ya
 * compara OLD contra NEW columna a columna y solo deja una fila por lo que de
 * verdad cambió. Diferenciar aquí sería hacer dos veces el mismo trabajo, y con
 * datos más viejos que los de la base.
 */
export async function editarDatos(codigo: string, entrada: unknown): Promise<Resultado> {
  const perfil = await exigirSesion();
  if (!ROLES[perfil.rol].editarTodo) return fallo("Solo Administración corrige los datos.");

  const datos = esquemaDatosEditables.safeParse(entrada);
  if (!datos.success) return falloDeEsquema(datos.error);
  const v = datos.data;

  return actualizarPedido(codigo, {
    nombre_cliente: v.cliente,
    telefono_cliente: v.telefonoCliente,
    tipos_pedido: v.tipos,
    tipo_producto_terminado: v.tipos.includes("PT") ? v.producto : null,
    cantidad: v.cantidad,
    lugar_entrega: v.entrega,
    direccion_entrega: v.entrega === "domicilio" ? v.direccion : null,
    detalle: v.detalle,
    observaciones: v.observaciones,
    plazo_credito_dias: v.plazoCredito,
  });
}

/* ── Envío a provincia ──────────────────────────────────────────────────────── */

export async function editarEnvio(codigo: string, entrada: unknown): Promise<Resultado> {
  const perfil = await exigirSesion();
  if (!ROLES[perfil.rol].editarEnvio) return fallo("Tu rol no edita los datos del envío.");

  const datos = esquemaEnvio.safeParse(entrada);
  if (!datos.success) return falloDeEsquema(datos.error);
  const v = datos.data;

  const pedidoId = await idDePedido(codigo);
  if (!pedidoId) return fallo(ERROR_SIN_FILAS);

  const supabase = await clienteServidor();
  /* `upsert` y no `update`: la fila de envío nace con el pedido, pero un pedido a
     provincia importado o creado antes de la Fase 4 puede no tenerla, y entonces
     un UPDATE no fallaría, simplemente no haría nada. */
  const { error } = await supabase.from("envios_provincia").upsert(
    {
      pedido_id: pedidoId,
      departamento_id: v.departamentoId,
      provincia_id: v.provinciaId,
      nombre_agencia: v.agencia,
      nombre_persona_recoge: v.personaQueRecoge,
      tipo_documento: v.tipoDocumento,
      numero_documento: v.numeroDocumento,
      telefono_persona_recoge: v.telefono,
      monto_flete: v.montoFlete,
      flete_pagado: v.fletePagado,
      observaciones_envio: v.observacionesEnvio,
    },
    { onConflict: "pedido_id" },
  );

  if (error) return fallo(mensajeDeError(error));

  refresh();
  return { ok: true };
}

/* ── Abonos ─────────────────────────────────────────────────────────────────── */

/**
 * El sobrepago no lo rechaza `pagos`, lo rechaza `pedidos`: el trigger recalcula
 * `monto_pagado` y ahí choca contra `monto_pagado <= monto_total`. Llega como un
 * 23514 de otra tabla, y por eso `errores.ts` lo traduce por nombre de constraint.
 */
export async function registrarAbono(entrada: unknown): Promise<Resultado> {
  const perfil: Perfil = await exigirSesion();
  if (!ROLES[perfil.rol].verMontos) return fallo("Solo Administración registra abonos.");

  const datos = esquemaAbono.safeParse(entrada);
  if (!datos.success) return falloDeEsquema(datos.error);
  const { codigo, monto, metodo } = datos.data;

  const pedidoId = await idDePedido(codigo);
  if (!pedidoId) return fallo(ERROR_SIN_FILAS);

  const supabase = await clienteServidor();
  const { error } = await supabase.from("pagos").insert({
    pedido_id: pedidoId,
    monto,
    metodo,
    registrado_por: perfil.id,
  });

  if (error) return fallo(mensajeDeError(error));

  refresh();
  return { ok: true };
}
