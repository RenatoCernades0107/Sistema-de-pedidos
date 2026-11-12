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
 * auditoría, `monto_pagado` y las fechas de cierre los escribe Postgres. Los
 * archivos tienen su propio archivo, `adjuntos-acciones.ts`: el binario no pasa
 * por el servidor de Next, solo la fila que lo registra.
 */

import { refresh } from "next/cache";
import { after } from "next/server";
import { clienteServidor } from "@/lib/supabase-servidor";
import { despacharNotificaciones } from "./notificaciones-acciones";
import {
  confirmarEnOdoo,
  leerCotizacion,
  olvidarPopularidad,
  sincronizarConOdoo,
} from "@/lib/cotizaciones-servidor";
import { mensajeOdoo, registrarCotizacion } from "@/lib/cotizaciones-registro";
import { productosPorId } from "@/lib/odoo/catalogos";
import { cancelarVentaDePedido, descontarStockDePedido, leerLineasDePedido } from "@/lib/pedido-odoo-servidor";
import { guardarSobrantesDeCorte, reservarSobrantes } from "@/lib/produccion-servidor";
import { detalleDesdeLineas, referenciaDe, sumaLineas } from "@/lib/cotizaciones";
import { totalPiezas } from "@/lib/cortes/guardado";
import { etiquetaDeTipo } from "@/lib/terminados/catalogo";
import { ODOO_NO_CONFIGURADO, odooConfigurado } from "@/lib/odoo/rpc";
import { exigirCrearPedido, exigirSesion, type Perfil } from "@/lib/sesion";
import { ROLES, admiteDecimales, ofreceComprobante, requiereMotivo, tiposDeLineas } from "@/lib/dominio";
import { ERROR_SIN_FILAS, mensajeDeError } from "@/lib/errores";
import {
  esquemaAbono,
  esquemaCambioEstado,
  esquemaCodigo,
  esquemaPlanchasUsadas,
  esquemaMaterialesUsados,
  esquemaDatosEditables,
  esquemaEnvio,
  esquemaRegistroPedido,
  esquemaResponsable,
  esquemaUbicacion,
} from "@/lib/esquemas";
import type { z } from "zod";
import type { Json, TablesUpdate } from "@/lib/supabase-tipos";

/** Las columnas de `pedidos` que se pueden mandar en un UPDATE. */
type CambiosPedido = TablesUpdate<"pedidos">;

export type Resultado =
  | {
      ok: true;
      codigo?: string;
      /** Salió bien, pero algo de fuera no: por ejemplo, Odoo no confirmó la cotización. */
      aviso?: string;
      /** Al registrar un pedido: el total con el que quedó. */
      total?: number;
    }
  | { ok: false; error: string };

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

const redondear2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Registra un pedido con su cliente de Odoo y sus líneas (productos y cortes).
 *
 * Detrás de cada pedido hay una cotización: es la que guarda el cliente y las
 * líneas, y la que existe en Odoo como orden de venta. O ya existía —el pedido
 * sale de una cotización— o se crea aquí con lo que llega del formulario.
 *
 * El orden importa:
 *   1. Se guarda la cotización y se crea en Odoo. De ahí sale el total con
 *      impuestos, que es el que se le cobra al cliente.
 *   2. Se registra el pedido, enlazado en la misma transacción.
 *   3. Se confirma la orden en Odoo, que es lo que reserva el stock.
 *
 * Odoo puede fallar en 1 o en 3 sin tumbar el alta: el pedido queda registrado,
 * con el total sin impuestos si no hubo otro, y se reintenta desde la cotización.
 */
export async function registrarPedido(entrada: unknown): Promise<Resultado> {
  const perfil = await exigirCrearPedido();
  if (!ROLES[perfil.rol].gestionarCotizaciones) return fallo("Tu rol no registra pedidos con productos.");

  const datos = esquemaRegistroPedido.safeParse(entrada);
  if (!datos.success) return falloDeEsquema(datos.error);
  const v = datos.data;

  let cotizacionId = v.cotizacionId;
  let aviso: string | undefined;
  let enOdoo = true;

  if (!cotizacionId) {
    if (!odooConfigurado()) return fallo(ODOO_NO_CONFIGURADO);
    const guardada = await registrarCotizacion({
      canal: "tienda",
      clienteId: v.clienteId!,
      lineas: v.lineas!,
      notas: null,
    });
    if (!guardada.ok) return fallo(guardada.error);
    cotizacionId = guardada.id;

    const creada = await sincronizarConOdoo(cotizacionId);
    olvidarPopularidad();
    if (!creada.ok) {
      enOdoo = false;
      aviso = `No se creó en Odoo: ${creada.error} El total del pedido quedó sin los impuestos de Odoo.`;
    }
  }

  const c = await leerCotizacion(cotizacionId);
  if (!c) return fallo("Esa cotización ya no existe.");
  if (c.pedido) return fallo(`Esa cotización ya tiene el pedido ${c.pedido.codigo}.`);

  /* Las indicaciones de cada línea. Quien las escribe las ve por su posición; se
     ligan a las líneas de la cotización antes de armar el detalle, y viajan a
     `crear_pedido`, que las guarda en la misma transacción del alta. */
  const indicacionesLineas = v.indicacionesLineas.filter(
    (i) => i.texto && c.lineas.some((l) => l.posicion === i.posicion),
  );
  const lineasConIndicaciones = c.lineas.map((l) => ({
    ...l,
    indicaciones: indicacionesLineas.find((i) => i.posicion === l.posicion)?.texto ?? null,
  }));

  // Lo que el pedido dice de sí mismo sale de las líneas, no del formulario.
  const total = c.montoTotal ?? sumaLineas(c.lineas);
  const unidades = c.lineas.reduce((s, l) => s + (l.corte ? totalPiezas(l.corte.piezas) : l.cantidad), 0);
  /* El tipo del pedido lo dicen las líneas. Su producto terminado es el de la
     línea ("otro" si hay de varios o es un personalizado sin tipo). */
  const tipos = tiposDeLineas(c.lineas);
  const terminados = c.lineas.flatMap((l) => (l.terminado ? [l.terminado] : []));
  const etiquetas = new Set(terminados.map((t) => etiquetaDeTipo(t.tipoCodigo)));
  const producto = terminados.length ? (etiquetas.size === 1 ? [...etiquetas][0] : "otro") : null;
  // Media plancha existe; media pieza no. Es la misma regla que el CHECK de `pedidos`.
  const cantidad = admiteDecimales(tipos) ? redondear2(unidades) : Math.max(1, Math.ceil(unidades));
  const detalle = [detalleDesdeLineas(lineasConIndicaciones), v.notas].filter(Boolean).join("\n\n");

  /* Al contado se cobra el total en el acto, a cuenta lo que se haya adelantado, y
     al crédito no entra nada todavía. Lo decide el servidor: el importe cobrado no
     es algo que deba llegar del navegador. */
  const abono =
    v.tipoPago === "contado" ? total : v.tipoPago === "a_cuenta" ? Math.min(v.abonoInicial, total) : 0;

  /* Los argumentos opcionales de `crear_pedido` van sin `null`: los tipos generados
     los declaran `?: T`, y en la función todos tienen `default null`. Omitir uno y
     mandarlo en null es lo mismo, así que lo que aquí no viaja se queda en null. */
  const sinValor = <T,>(valor: T | null) => valor ?? undefined;

  const supabase = await clienteServidor();
  const { data, error } = await supabase.rpc("crear_pedido", {
    p_es_provincia: v.esProvincia,
    p_nombre_cliente: c.cliente.nombre,
    p_telefono_cliente: sinValor(c.cliente.telefono),
    p_tipos_pedido: tipos,
    p_tipo_producto_terminado: sinValor(tipos.includes("PT") ? producto : null),
    p_cantidad: cantidad,
    p_tipo_pago: v.tipoPago,
    p_plazo_credito_dias: sinValor(v.tipoPago === "credito" ? v.plazoCredito : null),
    p_monto_total: total,
    p_lugar_entrega: v.entrega,
    p_direccion_entrega: sinValor(v.entrega === "domicilio" ? v.direccion : null),
    // Para dónde va el pedido, tal como lo eligió quien lo registra.
    p_ubicacion_actual: v.ubicacion,
    p_fecha_prometida: v.fechaPrometida,
    p_detalle: detalle,
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
    // `crear_pedido` la vincula en la misma transacción, o falla entera.
    p_cotizacion_id: cotizacionId,
    p_indicaciones_lineas: indicacionesLineas,
  });

  if (error) {
    // Lo cotizado no se pierde: quedó como cotización, y de ahí se puede reintentar.
    const queda = v.cotizacionId ? "" : ` Lo que armaste quedó guardado como la cotización ${referenciaDe(c)}.`;
    refresh();
    return fallo(`${mensajeDeError(error)}${queda}`);
  }

  /* Con el piloto de sobrantes, el acomodo de cada corte se rehace con los
     sobrantes disponibles ahora, y esos quedan reservados para este pedido. */
  const reserva = await reservarSobrantes(cotizacionId, c.lineas);
  if (!reserva.ok) aviso = reserva.error;

  /* La cotización pasa a pedido de venta en Odoo, que es lo que reserva el stock.
     Va después del alta y no la deshace si falla: el pedido ya está, y la
     cotización se queda con el motivo para reintentar desde su detalle. */
  if (enOdoo) {
    const r = await confirmarEnOdoo(cotizacionId);
    if (!r.ok) aviso = `Odoo no confirmó la orden: ${r.error}`;
  }

  /* El trigger `pedidos_notificar` ya encoló el aviso para el responsable. Esto
     solo lo apura: after() corre cuando la respuesta ya salió, así que quien
     registra el pedido no espera al push. Si no llega a correr, el cron del
     minuto vacía la cola igual. */
  if (v.responsableId) after(despacharNotificaciones);

  refresh();
  return { ok: true, codigo: data ?? undefined, aviso, total };
}

/* ── Mover el estado ────────────────────────────────────────────────────────── */

/**
 * El estado, el motivo y el comprobante viajan en un solo UPDATE, así el historial
 * los registra como un solo movimiento.
 *
 * Dos estados además tocan Odoo, después de guardar y sin deshacer nada si Odoo
 * falla (queda el motivo, y el detalle ofrece reintentar):
 *   - **Listo**: el trabajo salió del taller, y con él las planchas. Se anotan
 *     antes las que de verdad se usaron en cada corte, y se descuenta el stock.
 *   - **Anulado**: si las planchas seguían reservadas, se cancela la venta para
 *     soltarlas.
 */
export async function cambiarEstado(entrada: unknown): Promise<Resultado> {
  const perfil = await exigirSesion();

  const datos = esquemaCambioEstado.safeParse(entrada);
  if (!datos.success) return falloDeEsquema(datos.error);
  const { codigo, estado, motivo, numeroComprobante, planchas, sobrantes, materiales } = datos.data;

  if (requiereMotivo(estado) && !motivo) {
    return fallo("Explica el motivo: queda en el historial del pedido.");
  }

  if (estado === "listo" && materiales?.length) {
    const anotados = await anotarMateriales(codigo, materiales);
    if (!anotados.ok) return anotados;
  }

  if (estado === "listo" && planchas?.length) {
    const anotadas = await anotarPlanchas(codigo, planchas);
    if (!anotadas.ok) return anotadas;
  }

  /* Los sobrantes que el taller guardó se registran antes de mover el pedido: si
     algo no cuadra (un retazo), se corrige en el diálogo sin haber movido nada. */
  if (estado === "listo" && sobrantes?.length) {
    const lineas = await leerLineasDePedido(codigo);
    for (const s of sobrantes) {
      const linea = lineas.find((l) => l.posicion === s.posicion);
      if (!linea) return fallo("Uno de los cortes ya no está en el pedido.");
      const r = await guardarSobrantesDeCorte(codigo, linea, s.piezas);
      if (!r.ok) return r;
    }
  }

  const cambios: CambiosPedido = {
    estado,
    // Salir de observado o anulado limpia el motivo: si no, se queda pegado el de
    // la vez anterior y el historial cuenta otra cosa.
    motivo: requiereMotivo(estado) ? motivo : null,
  };

  /* El comprobante solo lo escribe Administración: es la única que puede leerlo y
     la única que lo tiene en `permitidas`. Es opcional: los demás roles entregan
     sin él. */
  if (ofreceComprobante(estado) && numeroComprobante && ROLES[perfil.rol].editarTodo) {
    cambios.numero_comprobante = numeroComprobante;
  }

  const movido = await actualizarPedido(codigo, cambios);
  if (!movido.ok) return movido;

  if (estado === "listo") {
    const r = await descontarStockDePedido(codigo);
    if (!r.ok) return { ok: true, aviso: `No se descontó el stock en Odoo: ${r.error}` };
  }
  if (estado === "anulado") {
    // Los sobrantes que tenía reservados vuelven a estar disponibles.
    const supabase = await clienteServidor();
    await supabase.rpc("soltar_sobrantes_de_pedido", { p_codigo: codigo, p_consumir: false });
    const r = await cancelarVentaDePedido(codigo);
    if (!r.ok) return { ok: true, aviso: `No se canceló la venta en Odoo: ${r.error}` };
  }
  return movido;
}

async function anotarPlanchas(
  codigo: string,
  planchas: { posicion: number; planchas: number }[],
): Promise<Resultado> {
  const supabase = await clienteServidor();
  for (const p of planchas) {
    const { error } = await supabase.rpc("anotar_planchas_usadas", {
      p_codigo: codigo,
      p_posicion: p.posicion,
      p_planchas: p.planchas,
    });
    if (error) return fallo(mensajeDeError(error));
  }
  return { ok: true };
}

/**
 * Lo que de verdad se usó en cada producto terminado. Del navegador llegan ids
 * de Odoo y cantidades; el nombre, el código y la unidad se leen de Odoo aquí.
 */
async function anotarMateriales(
  codigo: string,
  materiales: { posicion: number; usados: { productoId: number; cantidad: number }[] }[],
): Promise<Resultado> {
  let productos: Awaited<ReturnType<typeof productosPorId>>;
  try {
    productos = await productosPorId(materiales.flatMap((m) => m.usados.map((u) => u.productoId)));
  } catch (e) {
    return fallo(mensajeOdoo(e));
  }

  const supabase = await clienteServidor();
  for (const m of materiales) {
    const usados = [];
    for (const u of m.usados) {
      const p = productos.get(u.productoId);
      if (!p) return fallo("Uno de los materiales usados ya no existe en Odoo. Quítalo y vuelve a buscarlo.");
      usados.push({ productoId: p.id, codigo: p.codigo, nombre: p.nombre, unidad: p.unidad, cantidad: u.cantidad });
    }
    const { error } = await supabase.rpc("anotar_materiales_de_terminado", {
      p_codigo: codigo,
      p_posicion: m.posicion,
      p_materiales: usados as unknown as Json,
    });
    if (error) return fallo(mensajeDeError(error));
  }
  return { ok: true };
}

/** Los materiales usados de los productos terminados de un pedido, sin moverlo de estado. */
export async function anotarMaterialesUsados(entrada: unknown): Promise<Resultado> {
  await exigirSesion();
  const datos = esquemaMaterialesUsados.safeParse(entrada);
  if (!datos.success) return falloDeEsquema(datos.error);

  const r = await anotarMateriales(datos.data.codigo, datos.data.materiales);
  if (r.ok) refresh();
  return r;
}

/** Las planchas usadas de los cortes de un pedido, sin moverlo de estado. */
export async function anotarPlanchasUsadas(entrada: unknown): Promise<Resultado> {
  await exigirSesion();
  const datos = esquemaPlanchasUsadas.safeParse(entrada);
  if (!datos.success) return falloDeEsquema(datos.error);

  const r = await anotarPlanchas(datos.data.codigo, datos.data.planchas);
  if (r.ok) refresh();
  return r;
}

/** Vuelve a intentar lo que Odoo no hizo al mover el pedido: descontar el stock o cancelar la venta. */
export async function reintentarOdooDePedido(entrada: unknown): Promise<Resultado> {
  await exigirSesion();
  const datos = esquemaCodigo.safeParse(entrada);
  if (!datos.success) return falloDeEsquema(datos.error);
  const { codigo } = datos.data;

  const supabase = await clienteServidor();
  const { data } = await supabase.from("pedidos").select("estado").eq("codigo", codigo).maybeSingle();
  if (!data) return fallo(ERROR_SIN_FILAS);

  let r: Awaited<ReturnType<typeof descontarStockDePedido>>;
  if (data.estado === "anulado") r = await cancelarVentaDePedido(codigo);
  else if (["listo", "en_transito", "entregado"].includes(data.estado)) r = await descontarStockDePedido(codigo);
  else return fallo("El stock se descuenta cuando el pedido pasa a Listo.");

  refresh();
  return r.ok ? { ok: true } : fallo(r.error);
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

  const resultado = await actualizarPedido(datos.data.codigo, {
    responsable_id: datos.data.responsableId,
  });

  // Quitar el responsable no avisa a nadie: dejar de serlo no es una tarea.
  if (resultado.ok && datos.data.responsableId) after(despacharNotificaciones);

  return resultado;
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
