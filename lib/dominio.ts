/**
 * Modelo de dominio de Plexiacril.
 * Los tipos y las reglas viven aquí para que la UI no invente estados ni permisos.
 * Cuando entre Supabase (Fase 1), estos tipos son el contrato del cliente.
 */

export type Rol = "administracion" | "logistica" | "operaciones";
export type TipoPedido = "CL" | "CM" | "SP" | "PT" | "AC";
export type ProductoTerminado =
  | "cajas"
  | "porta_afiches"
  | "pivotante"
  | "letreros"
  | "letras"
  | "displays"
  | "otro";
export type Estado =
  | "registrado"
  | "en_proceso"
  | "observado"
  | "listo"
  | "en_transito"
  | "entregado"
  | "anulado";
export type LugarEntrega = "tienda" | "taller" | "domicilio" | "agencia";
export type Ubicacion = "tienda" | "taller" | "agencia";
export type TipoPago = "contado" | "a_cuenta" | "credito";
export type MetodoPago = "efectivo" | "yape_plin" | "transferencia" | "tarjeta" | "otro";
export type TipoAdjunto = "diseno" | "factura" | "guia" | "foto_entrega";
/** Los filtros de la vista de pedidos: a qué parte del trabajo se mira. */
export type Alcance = "todos" | "mios" | "taller" | "tienda" | "logistica";
export type TipoDocumento = "DNI" | "CE";
/** Días de crédito que la empresa concede. No hay plazos a medida. */
export type PlazoCredito = 1 | 7 | 15 | 30 | 90;

export interface EnvioProvincia {
  departamento: string;
  provincia: string | null;
  /** Los ids del ubigeo. Se pinta el nombre, pero se escribe el id: la FK compuesta
   *  de `envios_provincia` exige que la provincia cuelgue de su departamento. */
  departamentoId: number | null;
  provinciaId: number | null;
  agencia: string | null;
  /** Quien retira el pedido en la agencia de destino. */
  personaQueRecoge: string | null;
  tipoDocumento: TipoDocumento;
  numeroDocumento: string | null;
  telefono: string | null;
  montoFlete: number;
  fletePagado: boolean;
  /** Indicaciones para la agencia. Distinto de `Pedido.observaciones`. */
  observacionesEnvio?: string | null;
}

export interface Abono {
  fecha: string;
  monto: number;
  metodo: MetodoPago;
  usuario: string;
}

export interface CambioEstado {
  estado: Estado;
  usuario: string;
  rol: Rol;
  fecha: string;
  motivo?: string | null;
}

export interface EntradaAuditoria {
  usuario: string;
  campo: string;
  anterior: string;
  nuevo: string;
  fecha: string;
}

export interface Adjunto {
  /** El uuid de la fila. Es lo que se manda para pedir la URL firmada o borrarlo:
   *  la ruta dentro del bucket no sale del servidor. */
  id: string;
  tipo: TipoAdjunto;
  nombre: string;
  peso: string;
}

export interface Pedido {
  codigo: string;
  cliente: string;
  /** Contacto para coordinar la entrega. Dato personal: no lo ve el taller. */
  telefonoCliente: string | null;
  /** Un pedido puede combinar trabajos: corte láser más accesorios, por ejemplo. */
  tipos: TipoPedido[];
  producto: ProductoTerminado | null;
  cantidad: number;
  estado: Estado;
  motivo?: string | null;
  ubicacion: Ubicacion;
  entrega: LugarEntrega;
  direccion?: string | null;
  fechaPrometida: string;
  fechaCreacion: string;
  fechaEntrega?: string | null;
  /** Se escribe al anular. Junto a `fechaEntrega` da la fecha de cierre del pedido. */
  fechaAnulacion?: string | null;
  tipoPago: TipoPago;
  /** Solo tiene sentido con `tipoPago === "credito"`. */
  plazoCredito: PlazoCredito | null;
  montoTotal: number;
  montoPagado: number;
  /** El nombre, para pintarlo. Para escribirlo hace falta `responsableId`. */
  responsable: string | null;
  responsableId: string | null;
  detalle: string;
  /** Notas e incidencias del pedido. La especificación del trabajo va en `detalle`. */
  observaciones: string | null;
  numeroComprobante: string | null;
  /** Si el pedido ya tiene comprobante. Lo ven los tres roles; el número, solo Admin:
   *  sin esto el taller no puede saber si le dejarán entregar hasta que falle. */
  tieneComprobante: boolean;
  esProvincia: boolean;
  envio?: EnvioProvincia;
  adjuntos: Adjunto[];
  abonos: Abono[];
  historial: CambioEstado[];
  auditoria: EntradaAuditoria[];
  /** Si lo registró quien tiene la sesión abierta. No es un dato del pedido sino de
   *  quien lo mira: lo resuelve el servidor comparando `creado_por` con la sesión. */
  creadoPorMi: boolean;
}

/* ── Etiquetas ── */

export const TIPOS: Record<TipoPedido, string> = {
  CL: "Corte láser",
  CM: "Corte manual",
  SP: "Solo planchas",
  PT: "Productos terminados",
  AC: "Accesorio",
};

export const PRODUCTOS: Record<ProductoTerminado, string> = {
  cajas: "Cajas",
  porta_afiches: "Porta afiches",
  pivotante: "Pivotante",
  letreros: "Letreros",
  letras: "Letras",
  displays: "Displays",
  otro: "Otro",
};

export const ESTADOS: Record<Estado, string> = {
  registrado: "Registrado",
  en_proceso: "En proceso",
  observado: "Observado",
  listo: "Listo",
  en_transito: "En tránsito",
  entregado: "Entregado",
  anulado: "Anulado",
};

export const ORDEN_ESTADOS: Estado[] = [
  "registrado",
  "en_proceso",
  "observado",
  "listo",
  "en_transito",
  "entregado",
  "anulado",
];

export const LUGARES: Record<LugarEntrega, string> = {
  tienda: "En tienda",
  taller: "En taller",
  domicilio: "A domicilio",
  agencia: "Agencia",
};

export const UBICACIONES: Record<Ubicacion, string> = {
  tienda: "En tienda",
  taller: "En taller",
  agencia: "En agencia",
};

export const PAGOS: Record<TipoPago, string> = {
  contado: "Al contado",
  a_cuenta: "A cuenta",
  credito: "Al crédito",
};

export const METODOS: Record<MetodoPago, string> = {
  efectivo: "Efectivo",
  yape_plin: "Yape / Plin",
  transferencia: "Transferencia",
  tarjeta: "Tarjeta",
  otro: "Otro",
};

/** Cómo se llama cada archivo en pantalla. La sigla vive en la base. */
export const ADJUNTOS: Record<TipoAdjunto, string> = {
  diseno: "Diseño",
  factura: "Factura",
  guia: "Guía de remisión",
  foto_entrega: "Foto de entrega",
};

export const DOCUMENTOS: Record<TipoDocumento, string> = {
  DNI: "DNI",
  CE: "Carné de extranjería",
};

export const PLAZOS: PlazoCredito[] = [1, 7, 15, 30, 90];

/* Los trabajadores del taller ya no son una constante: `responsable_id` es una FK a
   la tabla `trabajadores`, así que salen de la base con su uuid
   (`lib/catalogos-servidor.ts`). Lo mismo el ubigeo. */

/* ── Roles y permisos ── */

export interface PermisosRol {
  nombre: string;
  descripcion: string;
  /**
   * Los filtros de alcance que el rol puede elegir en `/pedidos`. El primero es
   * con el que abre. Con uno solo, no se ofrece selector.
   */
  alcances: Alcance[];
  /** Qué pedidos le tocan al rol. Ningún filtro sale de aquí. */
  base: (p: Pedido) => boolean;
  /** El nombre del cliente. Lo ven los tres roles: el taller atiende llamadas
   *  por el pedido y con el código solo no sabe de cuál le hablan. */
  verCliente: boolean;
  /**
   * El teléfono del cliente lo leen quienes coordinan la entrega. Corregirlo va
   * con `editarTodo`, así que solo Administración lo escribe.
   */
  verTelefonoCliente: boolean;
  verMontos: boolean;
  verEnvioCompleto: boolean;
  verAuditoria: boolean;
  crearPedido: boolean;
  editarTodo: boolean;
  editarUbicacion: boolean;
  asignarResponsable: boolean;
  /** Corregir los datos de la agencia y de quien recoge en un envío a provincia. */
  editarEnvio: boolean;
  /** Subir y borrar los archivos del pedido. Es la misma condición que impone la
   *  política `adjuntos_storage_escritura`: el taller lee planos, no los cambia. */
  adjuntarArchivos: boolean;
  /** Chatear con el agente de cotizaciones (Quote Agent API) en `/cotizaciones/asistente`. */
  usarAgenteCotizacion: boolean;
  /** Registrar y ver las cotizaciones del sistema en `/cotizaciones`. Cada una se crea también en Odoo. */
  gestionarCotizaciones: boolean;
  /** Ver el dashboard de ventas, cobranza y cumplimiento en `/metricas`. */
  verMetricas: boolean;
  /** Cambiar los precios de corte y el catálogo de planchas en `/configuracion`. */
  configurar: boolean;
}

export const ROLES: Record<Rol, PermisosRol> = {
  administracion: {
    nombre: "Administración",
    descripcion: "CRUD completo de los pedidos",
    alcances: ["todos", "mios", "taller", "tienda", "logistica"],
    base: () => true,
    verCliente: true,
    verTelefonoCliente: true,
    verMontos: true,
    verEnvioCompleto: true,
    verAuditoria: true,
    crearPedido: true,
    editarTodo: true,
    editarUbicacion: true,
    asignarResponsable: true,
    editarEnvio: true,
    adjuntarArchivos: true,
    usarAgenteCotizacion: true,
    gestionarCotizaciones: true,
    verMetricas: true,
    configurar: true,
  },
  logistica: {
    nombre: "Logística",
    descripcion: "Ve el pedido completo · edita estado, ubicación y responsable",
    alcances: ["logistica", "taller", "todos"],
    base: (p) => ALCANCES.logistica.filtro(p) || ALCANCES.taller.filtro(p),
    verCliente: true,
    verTelefonoCliente: true,
    verMontos: false,
    verEnvioCompleto: true,
    verAuditoria: false,
    crearPedido: false,
    editarTodo: false,
    editarUbicacion: true,
    asignarResponsable: true,
    editarEnvio: true,
    adjuntarArchivos: true,
    usarAgenteCotizacion: false,
    gestionarCotizaciones: false,
    verMetricas: false,
    configurar: false,
  },
  operaciones: {
    nombre: "Operaciones",
    descripcion: "Ve el cliente y los datos de producción · solo edita el estado",
    alcances: ["taller"],
    base: (p) => ALCANCES.taller.filtro(p),
    verCliente: true,
    verTelefonoCliente: false,
    verMontos: false,
    verEnvioCompleto: false,
    verAuditoria: false,
    crearPedido: false,
    editarTodo: false,
    editarUbicacion: false,
    asignarResponsable: false,
    editarEnvio: false,
    adjuntarArchivos: false,
    usarAgenteCotizacion: false,
    gestionarCotizaciones: false,
    verMetricas: false,
    configurar: false,
  },
};

/* ── Máquina de estados ──
   Las mismas transiciones que valida el trigger en Postgres. */

export function transicionesValidas(p: Pedido): Estado[] {
  if (p.estado === "entregado" || p.estado === "anulado") return [];
  switch (p.estado) {
    case "registrado":
      return ["en_proceso", "anulado"];
    case "en_proceso":
      return ["listo", "observado", "anulado"];
    case "observado":
      return ["en_proceso", "anulado"];
    case "listo":
      return p.esProvincia ? ["en_transito", "anulado"] : ["entregado", "anulado"];
    case "en_transito":
      return ["entregado", "anulado"];
    default:
      return [];
  }
}

export function pasosDelFlujo(esProvincia: boolean): Estado[] {
  return esProvincia
    ? ["registrado", "en_proceso", "listo", "en_transito", "entregado"]
    : ["registrado", "en_proceso", "listo", "entregado"];
}

export const requiereMotivo = (e: Estado) => e === "anulado" || e === "observado";
/** Al entregar, Administración puede anotar el comprobante. Es opcional. */
export const ofreceComprobante = (e: Estado) => e === "entregado";

/* ── Derivados ── */

export const saldoDe = (p: Pedido) => p.montoTotal - p.montoPagado;
export const estaPagado = (p: Pedido) => saldoDe(p) <= 0;
export const esTerminal = (e: Estado) => e === "entregado" || e === "anulado";

/**
 * `F` factura y `B` boleta son la numeración de la SUNAT; `P` proforma y `NV` nota
 * de venta son comprobantes internos. El prefijo del número es la única fuente: no
 * hay columna de tipo que pueda contradecirlo.
 */
export const tipoComprobante = (n: string) =>
  n.startsWith("NV")
    ? "nota_venta"
    : n.startsWith("P")
      ? "proforma"
      : n.startsWith("B")
        ? "boleta"
        : "factura";

const ETIQUETA_COMPROBANTE: Record<ReturnType<typeof tipoComprobante>, string> = {
  factura: "Factura",
  boleta: "Boleta",
  proforma: "Proforma",
  nota_venta: "Nota de venta",
};

/** `Boleta B001-004512`, para mostrar el número con su tipo. */
export const etiquetaComprobante = (n: string) => `${ETIQUETA_COMPROBANTE[tipoComprobante(n)]} ${n}`;

/**
 * Sigla que lleva el código del pedido. Un pedido que combina trabajos es "MX":
 * el código tiene que caber en una boleta y dictarse por teléfono, así que no
 * concatena siglas. El desglose real vive en `tipos`.
 */
export const siglaDe = (tipos: TipoPedido[]) => (tipos.length > 1 ? "MX" : (tipos[0] ?? "CL"));

export const etiquetaTipos = (tipos: TipoPedido[]) => tipos.map((t) => TIPOS[t]).join(" · ");

/** Media plancha se corta; media caja no existe. */
export const admiteDecimales = (tipos: TipoPedido[]) => tipos.includes("SP");
export const unidadDe = (tipos: TipoPedido[]) => (admiteDecimales(tipos) ? "planchas" : "unidades");

/** Un pedido cerrado tiene una de las dos fechas, nunca las dos. */
export const fechaCierreDe = (p: Pedido) => p.fechaEntrega ?? p.fechaAnulacion ?? null;

/**
 * Suma días a una fecha ISO. Se construye y se lee en hora local: pasar por UTC
 * corre la fecha un día en la mitad de los husos horarios.
 */
export function sumarDias(iso: string, dias: number) {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  d.setDate(d.getDate() + dias);
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/** Fecha en la que vence el crédito, contada desde que se registró el pedido. */
export function venceCreditoEl(p: Pedido): string | null {
  if (p.tipoPago !== "credito" || !p.plazoCredito) return null;
  return sumarDias(p.fechaCreacion, p.plazoCredito);
}

/* ── Vista de pedidos ──
   Una sola pantalla, `/pedidos`, con un filtro de alcance. Los cerrados conviven
   con los activos: el orden los deja al final y la lista va paginada. */

/** La única vista de pedidos. Raíz, login y guardas de permisos mandan aquí. */
export const RUTA_PEDIDOS = "/pedidos";

export interface ConfigAlcance {
  titulo: string;
  /** Para la barra del celular y los chips, donde no cabe el título. */
  corto: string;
  descripcion: string;
  filtro: (p: Pedido) => boolean;
}

export const ALCANCES: Record<Alcance, ConfigAlcance> = {
  todos: {
    titulo: "Todos los pedidos",
    corto: "Todos",
    descripcion: "Todos los pedidos que puedes ver",
    filtro: () => true,
  },
  mios: {
    titulo: "Mis pedidos",
    corto: "Míos",
    descripcion: "Los pedidos que registraste tú",
    filtro: (p) => p.creadoPorMi,
  },
  taller: {
    titulo: "Taller",
    corto: "Taller",
    descripcion: "Pedidos que se producen o están en el taller",
    filtro: (p) => p.entrega === "taller" || p.ubicacion === "taller",
  },
  tienda: {
    titulo: "Tienda",
    corto: "Tienda",
    descripcion: "Pedidos que se entregan o están en tienda",
    filtro: (p) => p.entrega === "tienda" || p.ubicacion === "tienda",
  },
  logistica: {
    titulo: "Logística",
    corto: "Logística",
    descripcion: "Pedidos que van a provincia",
    filtro: (p) => p.esProvincia,
  },
};

export const esAlcance = (v: unknown): v is Alcance =>
  typeof v === "string" && Object.prototype.hasOwnProperty.call(ALCANCES, v);

/** El alcance pedido si el rol lo tiene; si no, con el que abre el rol. */
export const alcanceDe = (permisos: PermisosRol, pedido: unknown): Alcance =>
  esAlcance(pedido) && permisos.alcances.includes(pedido) ? pedido : permisos.alcances[0];

/** La URL de la vista con un alcance; el inicial del rol no lleva parámetro. */
export const rutaAlcance = (permisos: PermisosRol, a: Alcance) =>
  a === permisos.alcances[0] ? RUTA_PEDIDOS : `${RUTA_PEDIDOS}?ver=${a}`;

/* ── Herramientas ──
   Lo que no es una vista de pedidos pero cuelga del mismo menú. Están aquí, y no
   escritas en el JSX de la navegación, porque las leen tres sitios: la barra
   lateral, el menú del celular y el buscador (⌘K). El icono no viene aquí: este
   archivo es el modelo, no la pantalla. */

export interface ConfigHerramienta {
  titulo: string;
  href: string;
  /** El permiso del rol que la habilita. */
  permiso: keyof PermisosRol;
}

export const HERRAMIENTAS: ConfigHerramienta[] = [
  { titulo: "Cotizaciones", href: "/cotizaciones", permiso: "gestionarCotizaciones" },
  { titulo: "Métricas", href: "/metricas", permiso: "verMetricas" },
  { titulo: "Configuración", href: "/configuracion", permiso: "configurar" },
];

export const herramientasDe = (permisos: PermisosRol) =>
  HERRAMIENTAS.filter((h) => permisos[h.permiso] === true);
