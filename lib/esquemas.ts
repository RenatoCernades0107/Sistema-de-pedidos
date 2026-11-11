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
import { rucValido, soloDigitos, tipoDeDocumento } from "./busqueda-inteligente";
import { PLANCHAS_MAXIMAS, hastaDosDecimales } from "./pedido-lineas";

/* ── Piezas sueltas ─────────────────────────────────────────────────────────── */

/** DNI peruano y carné de extranjería. Lo mismo que el CHECK de `envios_provincia`. */
export const FORMATO_DOCUMENTO = {
  DNI: { regex: /^\d{8}$/, largo: 8, ayuda: "8 dígitos" },
  CE: { regex: /^[A-Za-z0-9]{9,12}$/, largo: 12, ayuda: "9 a 12 caracteres" },
} as const;

/**
 * La numeración de la SUNAT (factura `F`, boleta `B`) más dos comprobantes internos
 * (proforma `P`, nota de venta `NV`): letra(s) del tipo, serie de 3 y correlativo de
 * hasta 8. El mismo patrón que el CHECK `pedidos_comprobante_formato`.
 */
export const FORMATO_COMPROBANTE = {
  regex: /^(?:[FBP]|NV)\d{3}-\d{1,8}$/,
  ejemplo: "F001-004512",
  ayuda:
    "Formato esperado: F001-004512 (factura), B001-004512 (boleta), P001-004512 (proforma) o NV001-004512 (nota de venta)",
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

/**
 * Registro de un pedido (`components/nuevo-pedido-form.tsx`).
 *
 * El cliente y las líneas —productos de Odoo y cortes a medida— no están aquí:
 * se arman con los buscadores, no con campos de texto, y el formulario los lleva
 * aparte. Esto es lo demás: a dónde va, cuándo y cómo se paga.
 */
export const esquemaFormNuevoPedido = z
  .object({
    tipos: z.array(tipoPedido).min(1, "Elige al menos un tipo de pedido"),
    producto: productoTerminado.optional(),
    destino: z.enum(["local", "provincia"]),
    entrega: lugarEntrega,
    // Llega sin valor a propósito: quien registra tiene que decir si va para el
    // taller o para la tienda.
    ubicacion: z.enum(["taller", "tienda"], { error: "Elige si el pedido va para el taller o para la tienda" }),
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
    abono: z.coerce.number().min(0, "No puede ser negativo").optional(),
    responsableId: z.string().optional(),
    indicaciones: z.string().trim().max(1000, "Las indicaciones son demasiado largas").optional(),
    observaciones: z.string().trim().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.tipos.includes("PT") && !v.producto) {
      ctx.addIssue({ code: "custom", path: ["producto"], message: "Un producto terminado necesita su tipo" });
    }
    if (v.destino === "local" && v.entrega === "domicilio" && !v.direccion) {
      ctx.addIssue({ code: "custom", path: ["direccion"], message: "Falta la dirección" });
    }
    if (v.destino === "provincia" && !v.departamentoId) {
      ctx.addIssue({ code: "custom", path: ["departamentoId"], message: "Elige el departamento" });
    }
    reglaDelDocumento(v, ctx);
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
 * El campo vacío es válido aquí: el motivo lo exige el estado de destino y el
 * comprobante es siempre opcional. Sin el `or(literal(""))`, el valor inicial "" fallaría el regex y el
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

/* El alta de un pedido (`esquemaRegistroPedido`) está al final: depende de las
   líneas de la cotización, que se definen más abajo. */

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

const planchasUsadas = z.object({
  posicion: z.number().int().min(0).max(32767),
  planchas: z
    .number({ error: "Escribe cuántas planchas se usaron" })
    .min(0, "No pueden ser menos de cero planchas")
    .max(PLANCHAS_MAXIMAS, "Son demasiadas planchas")
    .refine(hastaDosDecimales, "Hasta dos decimales"),
});

export const esquemaCambioEstado = z.object({
  codigo,
  estado: estadoPedido,
  // El motivo es obligatorio según el destino, y eso lo decide la acción. El
  // comprobante es opcional; la acción solo lo guarda si quien entrega es Administración.
  motivo: z.string().trim().min(8, "Explica el motivo en al menos 8 caracteres").nullable(),
  numeroComprobante: z
    .string()
    .trim()
    .regex(FORMATO_COMPROBANTE.regex, FORMATO_COMPROBANTE.ayuda)
    .nullable(),
  /**
   * Al pasar a Listo: cuántas planchas se usaron de verdad en cada corte, por la
   * posición de su línea. Lo que se descuenta del stock en Odoo.
   */
  planchas: z.array(planchasUsadas).max(100).optional(),
});

export const esquemaUbicacion = z.object({ codigo, ubicacion });

export const esquemaCodigo = z.object({ codigo });

export const esquemaPlanchasUsadas = z.object({
  codigo,
  planchas: z.array(planchasUsadas).min(1).max(100),
});

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

/* ── Cotizaciones ───────────────────────────────────────────────────────────── */

/**
 * Lo que viaja a `crearCotizacion`. Del navegador llegan ids, cantidades y
 * precios; el nombre y el código de cada producto, y el nombre del cliente, los
 * vuelve a leer el servidor de Odoo: no se guarda lo que diga el POST.
 */
export const esquemaLineaCotizacion = z.object({
  // Opcional: una línea sin tipo es un producto, como siempre.
  tipo: z.literal("producto").optional(),
  productoId: z.number().int().positive(),
  cantidad: z
    .number({ error: "La cantidad tiene que ser un número" })
    .positive("La cantidad tiene que ser mayor que cero")
    .max(1_000_000, "Esa cantidad no es razonable")
    .refine((n) => decimalesDe(n) <= 3, "La cantidad admite hasta 3 decimales"),
  precioUnitario: z
    .number({ error: "El precio tiene que ser un número" })
    .min(0, "El precio no puede ser negativo")
    .max(10_000_000, "Ese precio no es razonable")
    .refine((n) => decimalesDe(n) <= 2, "El precio admite hasta 2 decimales"),
  descripcion: z.string().trim().max(500, "El detalle es demasiado largo").nullable(),
});

const medidaDePieza = z
  .number({ error: "Las medidas de cada pieza son números, en centímetros" })
  .positive("Las medidas de cada pieza tienen que ser mayores que cero")
  .max(2000, "Esa medida no es razonable")
  .refine((n) => decimalesDe(n) <= 2, "Las medidas admiten hasta 2 decimales");

/**
 * Un corte a medida. Del navegador llegan el material (por su grupo del
 * catálogo), las piezas y el formato de plancha elegido; el precio, las planchas
 * y el acomodo los calcula el servidor con el mismo motor (`lib/cortes/`).
 */
export const esquemaLineaCorte = z.object({
  tipo: z.literal("corte"),
  grupoId: z.uuid("Elige el material del corte"),
  /** Solo cuando el código de Odoo es de varios colores: cuál se pidió. */
  color: z.string().trim().max(60, "El color es demasiado largo").nullable(),
  modalidad: z.enum(["laser", "manual"]),
  piezas: z
    .array(
      z.object({
        ancho: medidaDePieza,
        alto: medidaDePieza,
        cantidad: z
          .number({ error: "La cantidad de piezas tiene que ser un número" })
          .int("La cantidad de piezas es un número entero")
          .positive("La cantidad de piezas tiene que ser mayor que cero")
          .max(2000, "Son demasiadas piezas de una misma medida"),
      }),
    )
    .min(1, "Un corte necesita al menos una pieza")
    .max(40, "Son demasiadas medidas distintas para un solo corte"),
  formatoCodigo: z.string().trim().min(1, "Elige el formato de plancha").max(40),
  /**
   * El total que la pantalla le enseñó a quien cotiza. Si el servidor calcula
   * otro —cambió un precio mientras tanto—, no se guarda a ciegas.
   */
  totalMostrado: z.number().min(0),
});

export const esquemaNuevaCotizacion = z.object({
  canal: z.enum(["tienda", "whatsapp"]),
  clienteId: z.number({ error: "Elige el cliente" }).int().positive("Elige el cliente"),
  lineas: z
    .array(z.union([esquemaLineaCorte, esquemaLineaCotizacion]))
    .min(1, "Agrega al menos un producto")
    .max(100, "Son demasiados productos para una cotización"),
  notas: z.string().trim().max(2000, "Las notas son demasiado largas").nullable(),
});

/**
 * Un cliente nuevo, creado desde el buscador. El documento es opcional —hay quien
 * cotiza sin dar RUC—, pero si viene tiene que ser un DNI de 8 dígitos o un RUC
 * que pase el dígito verificador: un número mal tecleado en Odoo es un cliente
 * duplicado más adelante.
 */
export const esquemaNuevoClienteOdoo = z.object({
  nombre: z
    .string()
    .trim()
    .min(2, "Escribe el nombre o la razón social")
    .max(200, "El nombre es demasiado largo"),
  documento: z
    .string()
    .trim()
    .transform((d) => soloDigitos(d))
    .refine(
      (d) => d === "" || tipoDeDocumento(d) !== null,
      "El documento es un DNI (8 dígitos) o un RUC (11 dígitos)",
    )
    .refine((d) => tipoDeDocumento(d) !== "RUC" || rucValido(d), "Ese RUC no es válido: revisa los dígitos")
    .transform((d) => d || null),
  telefono: z
    .string()
    .trim()
    .max(30, "El teléfono es demasiado largo")
    .transform((t) => t || null),
  email: z
    .union([z.literal(""), z.email("Ese correo no es válido").max(200)])
    .transform((e) => e || null),
});

/* ── Registrar un pedido ────────────────────────────────────────────────────── */

const lineasDePedido = z
  .array(z.union([esquemaLineaCorte, esquemaLineaCotizacion]))
  .min(1, "Agrega al menos un producto o un corte")
  .max(100, "Son demasiados productos para un pedido");

/**
 * Lo que viaja a `registrarPedido`.
 *
 * Un pedido es una cotización más lo propio del pedido: a dónde va, cuándo y
 * cómo se paga. O llega la cotización de la que sale (`cotizacionId`), o llegan
 * el cliente y las líneas para crearla aquí mismo. El nombre del cliente, la
 * cantidad, el detalle y el total no vienen: salen de las líneas, y los pone el
 * servidor.
 */
export const esquemaRegistroPedido = z
  .object({
    cotizacionId: z.uuid().nullable(),
    clienteId: z.number().int().positive().nullable(),
    lineas: lineasDePedido.nullable(),
    tipos: z
      .array(tipoPedido)
      .min(1, "Elige al menos un tipo de pedido")
      .refine((t) => new Set(t).size === t.length, "Hay un tipo repetido"),
    producto: productoTerminado.nullable(),
    esProvincia: z.boolean(),
    entrega: lugarEntrega,
    direccion: z.string().trim().nullable(),
    envio: esquemaEnvio.nullable(),
    fechaPrometida: fecha,
    tipoPago,
    plazoCredito: plazoCredito.nullable(),
    abonoInicial: dinero,
    metodoPago,
    responsableId: z.uuid().nullable(),
    // Para dónde va: lo que lo pone en la vista del taller o en la de la tienda.
    ubicacion,
    /** Lo que el taller tiene que saber y no sale de las líneas. */
    indicaciones: z.string().trim().max(1000, "Las indicaciones son demasiado largas").nullable(),
    observaciones: z.string().trim().nullable(),
  })
  .superRefine((v, ctx) => {
    if (!v.cotizacionId) {
      if (!v.clienteId) ctx.addIssue({ code: "custom", path: ["clienteId"], message: "Elige el cliente" });
      if (!v.lineas) {
        ctx.addIssue({ code: "custom", path: ["lineas"], message: "Agrega al menos un producto o un corte" });
      }
    }
    if (v.tipos.includes("PT") && !v.producto) {
      ctx.addIssue({ code: "custom", path: ["producto"], message: "Un producto terminado necesita su tipo" });
    }
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
      ctx.addIssue({ code: "custom", path: ["plazoCredito"], message: "Solo un pedido al crédito tiene plazo" });
    }
    if (v.tipoPago === "credito" && v.plazoCredito === null) {
      ctx.addIssue({ code: "custom", path: ["plazoCredito"], message: "Elige el plazo del crédito" });
    }
    if (v.tipoPago === "credito" && v.abonoInicial > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["abonoInicial"],
        message: "Un pedido al crédito no cobra nada al registrarse",
      });
    }
  });

export type NuevaCotizacion = z.output<typeof esquemaNuevaCotizacion>;
export type NuevaLineaCorte = z.output<typeof esquemaLineaCorte>;
export type NuevoClienteOdoo = z.output<typeof esquemaNuevoClienteOdoo>;
export type FormNuevoClienteOdoo = z.input<typeof esquemaNuevoClienteOdoo>;

export type RegistroPedido = z.output<typeof esquemaRegistroPedido>;
export type DatosEditables = z.output<typeof esquemaDatosEditables>;
export type DatosEnvio = z.output<typeof esquemaEnvio>;
export type CambioEstado = z.output<typeof esquemaCambioEstado>;
export type CambioPassword = z.output<typeof esquemaCambioPassword>;
