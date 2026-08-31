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
export type Vista = "admin" | "taller" | "tienda" | "logistica" | "historial";
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
  numeroFactura: string | null;
  /** Si el pedido ya está facturado. Lo ven los tres roles; el número, solo Admin:
   *  sin esto el taller no puede saber si le dejarán entregar hasta que falle. */
  tieneFactura: boolean;
  esProvincia: boolean;
  envio?: EnvioProvincia;
  adjuntos: Adjunto[];
  abonos: Abono[];
  historial: CambioEstado[];
  auditoria: EntradaAuditoria[];
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
  vistas: Vista[];
  vistaInicial: Vista;
  /** El nombre del cliente es dato comercial: el taller produce sin saberlo. */
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
}

export const ROLES: Record<Rol, PermisosRol> = {
  administracion: {
    nombre: "Administración",
    descripcion: "CRUD completo de los pedidos",
    vistas: ["admin", "taller", "tienda", "logistica", "historial"],
    vistaInicial: "admin",
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
  },
  logistica: {
    nombre: "Logística",
    descripcion: "Ve el pedido completo · edita estado, ubicación y responsable",
    vistas: ["logistica", "taller", "historial"],
    vistaInicial: "logistica",
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
  },
  operaciones: {
    nombre: "Operaciones",
    descripcion: "Ve datos de producción sin el cliente · solo edita el estado",
    vistas: ["taller"],
    vistaInicial: "taller",
    verCliente: false,
    verTelefonoCliente: false,
    verMontos: false,
    verEnvioCompleto: false,
    verAuditoria: false,
    crearPedido: false,
    editarTodo: false,
    editarUbicacion: false,
    asignarResponsable: false,
    editarEnvio: false,
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
export const requiereFactura = (e: Estado) => e === "entregado";

/* ── Derivados ── */

export const saldoDe = (p: Pedido) => p.montoTotal - p.montoPagado;
export const estaPagado = (p: Pedido) => saldoDe(p) <= 0;
export const esTerminal = (e: Estado) => e === "entregado" || e === "anulado";

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

/* ── Vistas ──
   Van al final porque `historial` usa `esTerminal`. */

export interface ConfigVista {
  titulo: string;
  descripcion: string;
  filtro: (p: Pedido) => boolean;
  /**
   * Vista de archivo: muestra los cerrados sin importar cuándo se cerraron.
   * En el resto de vistas, un entregado o anulado solo se ve el día en que se cerró.
   */
  archivo?: boolean;
  /** Qué chips de estado tiene sentido ofrecer. Por defecto, todos. */
  estadosChip?: Estado[];
}

export const VISTAS: Record<Vista, ConfigVista> = {
  admin: {
    titulo: "Todos los pedidos",
    descripcion: "Absolutamente todos los pedidos registrados",
    filtro: () => true,
  },
  taller: {
    titulo: "Taller",
    descripcion: "Pedidos que se producen o están en el taller",
    filtro: (p) => p.entrega === "taller" || p.ubicacion === "taller",
  },
  tienda: {
    titulo: "Tienda",
    descripcion: "Pedidos que se entregan o están en tienda",
    filtro: (p) => p.entrega === "tienda" || p.ubicacion === "tienda",
  },
  logistica: {
    titulo: "Logística",
    descripcion: "Pedidos que van a provincia",
    filtro: (p) => p.esProvincia,
  },
  historial: {
    titulo: "Historial",
    descripcion: "Todos los pedidos entregados y anulados",
    filtro: (p) => esTerminal(p.estado),
    archivo: true,
    estadosChip: ["entregado", "anulado"],
  },
};
