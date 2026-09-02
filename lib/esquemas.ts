/**
 * Las reglas del modelo, en Zod, en un solo sitio.
 *
 * Hay dos capas y no sobra ninguna:
 *
 *   - Los esquemas `Form…` validan lo que se escribe en pantalla, donde todo llega
 *     como texto y los campos vacíos son `""`. Los consume `zodResolver`.
 *   - Los esquemas de *payload* validan lo que viaja a una Server Action, ya con
 *     tipos de verdad y `null` en vez de `""`. Se vuelven a comprobar en el
 *     servidor porque una Server Action es un POST público: que el formulario haya
 *     validado no dice nada de quien manda el POST a mano.
 *
 * Las reglas comunes viven en `reglasDelPedido` y `reglaDelDocumento`, así que
 * cambiarlas una vez las cambia en las dos capas. Lo que valide Postgres después
 * es la última palabra; esto solo evita el viaje.
 */

import { z } from "zod";
import { admiteDecimales, type TipoPedido } from "./dominio";

/* ── Piezas sueltas ─────────────────────────────────────────────────────────── */

/** DNI peruano y carné de extranjería. Lo mismo que el CHECK de `envios_provincia`. */
export const FORMATO_DOCUMENTO = {
  DNI: { regex: /^\d{8}$/, largo: 8, ayuda: "8 dígitos" },
  CE: { regex: /^[A-Za-z0-9]{9,12}$/, largo: 12, ayuda: "9 a 12 caracteres" },
} as const;

/**
 * La numeración de la SUNAT: letra del tipo, serie de 3 y correlativo de hasta 8.
 * `F001-004512` es factura, `B001-004512` boleta. El mismo patrón que el CHECK
 * `pedidos_comprobante_formato`.
 */
export const FORMATO_COMPROBANTE = {
  regex: /^[FB]\d{3}-\d{1,8}$/,
  ejemplo: "F001-004512",
  ayuda: "Formato esperado: F001-004512 (factura) o B001-004512 (boleta)",
} as const;

/** `LCL_2026_H4TP`. El mismo regex que `pedidos_codigo_formato`. */
export const FORMATO_CODIGO = /^[LP](CL|CM|SP|PT|AC|MX)_\d{4}_[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/;

/** Cuántos decimales trae un número tal como lo escribió quien lo tecleó. */
export const decimalesDe = (n: number) => (String(n).split(".")[1] ?? "").length;

const tipoPedido = z.enum(["CL", "CM", "SP", "PT", "AC"]);
const productoTerminado = z.enum([
  "cajas",
  "porta_afiches",
  "pivotante",
  "letreros",
  "letras",
  "displays",
  "otro",
]);
const lugarEntrega = z.enum(["tienda", "taller", "domicilio", "agencia"]);
const ubicacion = z.enum(["tienda", "taller", "agencia"]);
const estadoPedido = z.enum([
  "registrado",
  "en_proceso",
  "observado",
  "listo",
  "en_transito",
  "entregado",
  "anulado",
]);
const tipoPago = z.enum(["contado", "a_cuenta", "credito"]);
const metodoPago = z.enum(["efectivo", "yape_plin", "transferencia", "tarjeta", "otro"]);
const tipoDocumento = z.enum(["DNI", "CE"]);
const plazoCredito = z.union([
  z.literal(1),
  z.literal(7),
  z.literal(15),
  z.literal(30),
  z.literal(90),
]);

const codigo = z.string().regex(FORMATO_CODIGO, "Código de pedido inválido");
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida");
/** Un `numeric(10,2)`: dos decimales y no más de 8 enteros. */
const dinero = z
  .number()
  .min(0, "No puede ser negativo")
  .max(99_999_999.99, "El monto es demasiado grande")
  .refine((n) => decimalesDe(n) <= 2, "Como máximo 2 decimales");

/* ── Reglas compartidas por las dos capas ───────────────────────────────────── */

interface DatosDeTrabajo {
  tipos: TipoPedido[];
  producto?: string | null;
  cantidad: number;
}

/** Producto terminado y decimales: las dos reglas que dependen de `tipos`. */
function reglasDelPedido(v: DatosDeTrabajo, ctx: z.RefinementCtx) {
  if (v.tipos.includes("PT") && !v.producto) {
    ctx.addIssue({
      code: "custom",
      path: ["producto"],
      message: "Un producto terminado necesita su tipo",
    });
  }
  // Media plancha se corta; media caja no existe.
  if (!admiteDecimales(v.tipos) && !Number.isInteger(v.cantidad)) {
    ctx.addIssue({
      code: "custom",
      path: ["cantidad"],
      message: "Solo números enteros. Los decimales son para las planchas.",
    });
  }
  if (admiteDecimales(v.tipos) && decimalesDe(v.cantidad) > 2) {
    ctx.addIssue({ code: "custom", path: ["cantidad"], message: "Como máximo 2 decimales" });
  }
}

function reglaDelDocumento(
  v: { tipoDocumento: "DNI" | "CE"; numeroDocumento?: string | null },
  ctx: z.RefinementCtx,
) {
  if (v.numeroDocumento && !FORMATO_DOCUMENTO[v.tipoDocumento].regex.test(v.numeroDocumento)) {
    ctx.addIssue({
      code: "custom",
      path: ["numeroDocumento"],
      message: `El ${v.tipoDocumento} tiene ${FORMATO_DOCUMENTO[v.tipoDocumento].ayuda}`,
    });
  }
}

/* ── Capa 1: formularios ────────────────────────────────────────────────────── */

/** Registro de un pedido (`components/nuevo-pedido-form.tsx`). */
export const esquemaFormNuevoPedido = z
  .object({
    cliente: z.string().trim().min(3, "Escribe el nombre del cliente"),
    telefonoCliente: z.string().trim().optional(),
    tipos: z.array(tipoPedido).min(1, "Elige al menos un tipo de pedido"),
    producto: productoTerminado.optional(),
    cantidad: z.coerce.number().positive("La cantidad tiene que ser mayor que cero"),
    destino: z.enum(["local", "provincia"]),
    entrega: lugarEntrega,
    ubicacion,
    direccion: z.string().trim().optional(),
    departamentoId: z.coerce.number().int().positive().optional(),
    provinciaId: z.coerce.number().int().positive().optional(),
    agencia: z.string().trim().optional(),
    personaQueRecoge: z.string().trim().optional(),
    tipoDocumento,
    numeroDocumento: z.string().trim().optional(),
    telefono: z.string().trim().optional(),
    flete: z.coerce.number().min(0).optional(),
    fletePagado: z.boolean().optional(),
    observacionesEnvio: z.string().trim().optional(),
    fechaPrometida: z.string().min(1, "La fecha prometida es obligatoria"),
    tipoPago,
    plazoCredito: z.coerce.number().optional(),
    metodoPago,
    montoTotal: z.coerce.number().min(0, "No puede ser negativo"),
    abono: z.coerce.number().min(0).optional(),
    responsableId: z.string().optional(),
    detalle: z.string().trim().optional(),
    observaciones: z.string().trim().optional(),
  })
  .superRefine((v, ctx) => {
    reglasDelPedido({ tipos: v.tipos, producto: v.producto, cantidad: v.cantidad }, ctx);
    if (v.destino === "local" && v.entrega === "domicilio" && !v.direccion) {
      ctx.addIssue({ code: "custom", path: ["direccion"], message: "Falta la dirección" });
    }
    if (v.destino === "provincia" && !v.departamentoId) {
      ctx.addIssue({ code: "custom", path: ["departamentoId"], message: "Elige el departamento" });
    }
    reglaDelDocumento(v, ctx);
    if (v.tipoPago === "a_cuenta" && (v.abono ?? 0) > v.montoTotal) {
      ctx.addIssue({ code: "custom", path: ["abono"], message: "El abono supera el total" });
    }
    if (v.tipoPago === "credito" && !v.plazoCredito) {
      ctx.addIssue({ code: "custom", path: ["plazoCredito"], message: "Elige el plazo del crédito" });
    }
  });

/** Corrección de los datos de un pedido ya registrado (`components/editar-pedido.tsx`). */
export const esquemaFormDatos = z
  .object({
    cliente: z.string().trim().min(3, "Escribe el nombre del cliente"),
    telefonoCliente: z.string().trim().optional(),
    tipos: z.array(tipoPedido).min(1, "Elige al menos un tipo de pedido"),
    producto: productoTerminado.optional(),
    cantidad: z.coerce.number().positive("La cantidad tiene que ser mayor que cero"),
    entrega: lugarEntrega,
    direccion: z.string().trim().optional(),
    detalle: z.string().trim().optional(),
    observaciones: z.string().trim().optional(),
    plazoCredito: z.coerce.number().optional(),
  })
  .superRefine((v, ctx) => {
    reglasDelPedido({ tipos: v.tipos, producto: v.producto, cantidad: v.cantidad }, ctx);
    if (v.entrega === "domicilio" && !v.direccion) {
      ctx.addIssue({ code: "custom", path: ["direccion"], message: "Falta la dirección" });
    }
  });

/** Datos de la agencia y de quien recoge (`components/editar-pedido.tsx`). */
export const esquemaFormEnvio = z
  .object({
    departamentoId: z.coerce.number().int().positive("Elige el departamento"),
    provinciaId: z.coerce.number().int().positive().optional(),
    agencia: z.string().trim().optional(),
    personaQueRecoge: z.string().trim().optional(),
    tipoDocumento,
    numeroDocumento: z.string().trim().optional(),
    telefono: z.string().trim().optional(),
    montoFlete: z.coerce.number().min(0, "No puede ser negativo"),
    fletePagado: z.boolean(),
    observacionesEnvio: z.string().trim().optional(),
  })
  .superRefine(reglaDelDocumento);

/**
 * Abono (`components/registrar-abono.tsx`). Es una fábrica porque el tope es el
 * saldo del pedido, que solo se conoce al pintar el diálogo.
 */
export const esquemaFormAbono = (saldo: number) =>
  z.object({
    monto: z.coerce
      .number()
      .positive("El monto tiene que ser mayor que cero")
      .max(saldo, `Como máximo el saldo: S/ ${saldo.toFixed(2)}`),
    metodo: metodoPago,
  });

/**
 * Motivo y comprobante del diálogo de cambio de estado (`components/acciones-pedido.tsx`).
 * El campo vacío es válido aquí: lo que hace obligatorio a cada uno es el estado de
 * destino. Sin el `or(literal(""))`, el valor inicial "" fallaría el regex y el
 * formulario no llegaría a enviarse nunca.
 */
export const esquemaFormEstado = z.object({
  motivo: z
    .string()
    .trim()
    .min(8, "Explica el motivo en al menos 8 caracteres")
    .or(z.literal(""))
    .optional(),
  numeroComprobante: z
    .string()
    .trim()
    .regex(FORMATO_COMPROBANTE.regex, FORMATO_COMPROBANTE.ayuda)
    .or(z.literal(""))
    .optional(),
});

/* ── Capa 2: lo que viaja a las Server Actions ──────────────────────────────── */

/**
 * El envío a provincia se escribe por id, no por nombre: `provincia_id` cuelga de
 * `departamento_id` con una FK compuesta, y mandar el nombre obligaría a resolverlo
 * dos veces y a confiar en que coincide.
 */
export const esquemaEnvio = z
  .object({
    departamentoId: z.number().int().positive(),
    provinciaId: z.number().int().positive().nullable(),
    agencia: z.string().trim().nullable(),
    personaQueRecoge: z.string().trim().nullable(),
    tipoDocumento,
    numeroDocumento: z.string().trim().nullable(),
    telefono: z.string().trim().nullable(),
    montoFlete: dinero,
    fletePagado: z.boolean(),
    observacionesEnvio: z.string().trim().nullable(),
  })
  .superRefine(reglaDelDocumento);

export const esquemaNuevoPedido = z
  .object({
    cliente: z.string().trim().min(3),
    telefonoCliente: z.string().trim().nullable(),
    tipos: z
      .array(tipoPedido)
      .min(1)
      .refine((t) => new Set(t).size === t.length, "Hay un tipo repetido"),
    producto: productoTerminado.nullable(),
    cantidad: z.number().positive(),
    esProvincia: z.boolean(),
    entrega: lugarEntrega,
    direccion: z.string().trim().nullable(),
    envio: esquemaEnvio.nullable(),
    fechaPrometida: fecha,
    tipoPago,
    plazoCredito: plazoCredito.nullable(),
    montoTotal: dinero,
    abonoInicial: dinero,
    metodoPago,
    responsableId: z.uuid().nullable(),
    // Dónde queda físicamente el pedido al registrarlo. No se deduce del lugar de
    // entrega: un pedido que se entrega en tienda puede nacer en el taller.
    ubicacion,
    detalle: z.string(),
    observaciones: z.string().trim().nullable(),
  })
  .superRefine((v, ctx) => {
    reglasDelPedido(v, ctx);
    // Los mismos CHECK de `pedidos`, para no gastar un viaje a Postgres.
    if ((v.entrega === "agencia") !== v.esProvincia) {
      ctx.addIssue({
        code: "custom",
        path: ["entrega"],
        message: "Un pedido a provincia se entrega en agencia, y solo esos",
      });
    }
    if (v.entrega === "domicilio" && !v.direccion) {
      ctx.addIssue({ code: "custom", path: ["direccion"], message: "Falta la dirección" });
    }
    if (v.esProvincia && !v.envio) {
      ctx.addIssue({ code: "custom", path: ["envio"], message: "Faltan los datos del envío" });
    }
    if (v.plazoCredito !== null && v.tipoPago !== "credito") {
      ctx.addIssue({
        code: "custom",
        path: ["plazoCredito"],
        message: "Solo un pedido al crédito tiene plazo",
      });
    }
    if (v.tipoPago === "credito" && v.abonoInicial > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["abonoInicial"],
        message: "Un pedido al crédito no cobra nada al registrarse",
      });
    }
    if (v.abonoInicial > v.montoTotal) {
      ctx.addIssue({
        code: "custom",
        path: ["abonoInicial"],
        message: "El abono supera el total",
      });
    }
  });

export const esquemaDatosEditables = z
  .object({
    cliente: z.string().trim().min(3),
    telefonoCliente: z.string().trim().nullable(),
    tipos: z
      .array(tipoPedido)
      .min(1)
      .refine((t) => new Set(t).size === t.length, "Hay un tipo repetido"),
    producto: productoTerminado.nullable(),
    cantidad: z.number().positive(),
    entrega: lugarEntrega,
    direccion: z.string().trim().nullable(),
    detalle: z.string(),
    observaciones: z.string().trim().nullable(),
    plazoCredito: plazoCredito.nullable(),
  })
  .superRefine((v, ctx) => {
    reglasDelPedido(v, ctx);
    if (v.entrega === "domicilio" && !v.direccion) {
      ctx.addIssue({ code: "custom", path: ["direccion"], message: "Falta la dirección" });
    }
  });

export const esquemaCambioEstado = z.object({
  codigo,
  estado: estadoPedido,
  // El motivo y el comprobante son obligatorios según el destino, pero eso lo decide
  // la acción, que es la que sabe el rol y si el pedido ya tenía comprobante.
  motivo: z.string().trim().min(8, "Explica el motivo en al menos 8 caracteres").nullable(),
  numeroComprobante: z
    .string()
    .trim()
    .regex(FORMATO_COMPROBANTE.regex, FORMATO_COMPROBANTE.ayuda)
    .nullable(),
});

export const esquemaUbicacion = z.object({ codigo, ubicacion });

export const esquemaResponsable = z.object({
  codigo,
  responsableId: z.uuid().nullable(),
});

export const esquemaAbono = z.object({
  codigo,
  monto: dinero.refine((n) => n > 0, "El monto tiene que ser mayor que cero"),
  metodo: metodoPago,
});

/* ── Avisos ─────────────────────────────────────────────────────────────────── */

/**
 * Lo que devuelve `pushManager.subscribe()` en el navegador, ya aplanado.
 *
 * `endpoint` es una URL del servicio de push (FCM, Mozilla, Apple) y llega del
 * cliente, así que se comprueba que sea https: la fila termina en una tabla que
 * la Edge Function usa como destino de un POST.
 */
export const esquemaSuscripcion = z.object({
  endpoint: z.url({ protocol: /^https$/ }).max(1000),
  p256dh: z.string().min(1).max(200),
  auth: z.string().min(1).max(200),
  navegador: z.string().max(300).nullable(),
});

export const esquemaBajaSuscripcion = z.object({
  endpoint: z.url({ protocol: /^https$/ }).max(1000),
});

/** `usuarioId: null` desenlaza al trabajador; es un estado válido, no un borrado. */
export const esquemaEnlaceTrabajador = z.object({
  trabajadorId: z.uuid(),
  usuarioId: z.uuid().nullable(),
});

/* ── Contraseña ─────────────────────────────────────────────────────────────── */

/**
 * Supabase Auth se conforma con 6 caracteres. Aquí se piden 8 porque la primera
 * contraseña de una cuenta la eligió otra persona y ya circuló por un chat: la
 * que la reemplaza no puede ser igual de corta que la que hubo que tirar.
 *
 * El techo no es una preferencia: bcrypt solo mira los primeros 72 bytes, y
 * GoTrue rechaza lo que pase de ahí con un error que no explica nada.
 */
export const LARGO_MINIMO_PASSWORD = 8;
export const LARGO_MAXIMO_PASSWORD = 72;

export const esquemaCambioPassword = z
  .object({
    password: z
      .string()
      .min(LARGO_MINIMO_PASSWORD, `Al menos ${LARGO_MINIMO_PASSWORD} caracteres`)
      .max(LARGO_MAXIMO_PASSWORD, `Como máximo ${LARGO_MAXIMO_PASSWORD} caracteres`),
    confirmacion: z.string(),
  })
  .refine((v) => v.password === v.confirmacion, {
    path: ["confirmacion"],
    message: "Las dos contraseñas no coinciden",
  });

export type NuevoPedido = z.output<typeof esquemaNuevoPedido>;
export type DatosEditables = z.output<typeof esquemaDatosEditables>;
export type DatosEnvio = z.output<typeof esquemaEnvio>;
export type CambioEstado = z.output<typeof esquemaCambioEstado>;
export type CambioPassword = z.output<typeof esquemaCambioPassword>;
