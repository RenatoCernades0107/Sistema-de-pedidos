/**
 * Errores de Postgres traducidos a algo que se pueda leer en el taller.
 *
 * La base es la que manda: casi ninguna regla se comprueba dos veces en la app, así
 * que cuando algo se rechaza llega como un SQLSTATE y un mensaje en inglés con el
 * nombre de un constraint dentro. Aquí se convierte en una frase que diga qué
 * hacer. Lo que no se reconozca se muestra tal cual antes que tragárselo: un error
 * raro visible se arregla; uno escondido, no.
 */

import type { PostgrestError } from "@supabase/supabase-js";

/**
 * Los CHECK que no llevan nombre explícito los bautizó Postgres como
 * `<tabla>_<columna>_check`, con sufijo numérico si la columna tiene más de uno.
 * Por eso se buscan por fragmento y no por igualdad.
 */
const POR_CONSTRAINT: ReadonlyArray<readonly [RegExp, string]> = [
  [/pedidos_monto_pagado_check/, "El abono supera el total del pedido."],
  [/pedidos_numero_factura_check/, "Sin número de factura no se puede entregar."],
  [/pedidos_motivo_check/, "Hace falta el motivo para anular u observar el pedido."],
  [
    /pedidos_tipo_producto_terminado_check/,
    "El tipo de producto terminado va si y solo si el pedido incluye PT.",
  ],
  [/pedidos_cantidad_check1/, "Solo los pedidos con planchas admiten decimales en la cantidad."],
  [/pedidos_cantidad_check/, "La cantidad tiene que ser mayor que cero."],
  [/pedidos_plazo_credito_dias_check/, "El plazo solo existe en pedidos al crédito: 1, 7, 15, 30 o 90 días."],
  [/pedidos_lugar_entrega_check/, "Un pedido a provincia se entrega en agencia, y solo esos."],
  [/pedidos_direccion_entrega_check/, "Falta la dirección de entrega."],
  [/pedidos_fecha_(entrega|anulacion)_check/, "Las fechas de cierre las pone la base; no se envían."],
  [/pedidos_tipos_pedido_check/, "Elige al menos un tipo de pedido, sin repetir."],
  [/pedidos_nombre_cliente_check/, "El nombre del cliente no puede quedar vacío."],
  [/pedidos_monto_total_check/, "El monto total no puede ser negativo."],
  [/pedidos_codigo_formato|pedidos_codigo_key/, "Problema con el código del pedido. Vuelve a intentarlo."],
  [/envios_provincia_pertenece_al_departamento/, "Esa provincia no pertenece al departamento elegido."],
  [/envios_provincia_numero_documento_check/, "El número de documento no tiene el formato del DNI o del CE."],
  [/envios_provincia_monto_flete_check/, "El flete no puede ser negativo."],
  [/pagos_monto_check/, "El abono tiene que ser mayor que cero."],
  [/trabajadores_nombre_key/, "Ya hay un trabajador con ese nombre."],
  [/usuarios_(usuario|email)_key/, "Ese usuario ya existe."],
];

/** Mensajes de los `raise exception` del esquema que conviene suavizar. */
const POR_MENSAJE: ReadonlyArray<readonly [RegExp, string]> = [
  [
    /^Transición inválida/,
    "Ese cambio de estado ya no es posible: alguien movió el pedido antes. Recarga la página.",
  ],
  [/^El rol .* no puede modificar/, "Tu rol no puede cambiar eso."],
  [/es inmutable/, "Ese dato se congela al registrar el pedido y no se puede cambiar."],
  [
    /No se pudo generar un código único/,
    "No se pudo generar el código del pedido. Vuelve a intentarlo.",
  ],
  [
    /no es a provincia: no puede tener datos de envío/,
    "El pedido no es a provincia, así que no lleva datos de envío.",
  ],
  [/Un pedido a provincia necesita su departamento/, "Elige el departamento de destino."],
];

const POR_CODIGO: Record<string, string> = {
  "23503": "Falta un dato relacionado o ya no existe (departamento, provincia o responsable).",
  "23505": "Ya existe un registro con ese valor.",
  "23514": "Los datos no cumplen una regla del pedido.",
  "428C9": "Se intentó escribir una columna que calcula la base.",
  "42501": "No tienes permiso para ese cambio.",
  "42703": "Se intentó escribir una columna que tu rol no puede tocar.",
  PGRST116: "El pedido ya no está disponible. Recarga la página.",
  PGRST301: "Tu sesión caducó. Vuelve a entrar.",
};

/** Lo que se muestra cuando la operación falla sin que Postgres diga por qué. */
export const ERROR_GENERICO = "No se pudo guardar el cambio. Vuelve a intentarlo.";

/** Un UPDATE que la RLS no deja pasar no da error: devuelve cero filas. */
export const ERROR_SIN_FILAS =
  "El pedido ya no está disponible o tu rol no puede cambiarlo. Recarga la página.";

export function mensajeDeError(error: PostgrestError | null | undefined): string {
  if (!error) return ERROR_GENERICO;

  const texto = `${error.message ?? ""} ${error.details ?? ""}`;

  for (const [patron, mensaje] of POR_CONSTRAINT) {
    if (patron.test(texto)) return mensaje;
  }

  // Los `raise exception` del esquema ya vienen en castellano; se pasan tal cual
  // salvo los de la lista, que dicen más de la mecánica interna que del problema.
  if (error.code === "P0001") {
    for (const [patron, mensaje] of POR_MENSAJE) {
      if (patron.test(error.message)) return mensaje;
    }
    return error.message;
  }

  if (/violates row-level security/i.test(texto)) {
    return "No tienes permiso para ese cambio.";
  }

  return POR_CODIGO[error.code] ?? error.message ?? ERROR_GENERICO;
}
