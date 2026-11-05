/**
 * Las cotizaciones del sistema, en el idioma de la pantalla.
 *
 * No confundir con `lib/cotizaciones-tipos.ts`, que es el idioma de la Quote
 * Agent API (el chat del asistente). Esto es lo que vive en la tabla
 * `cotizaciones` de Supabase, con su espejo en Odoo.
 */

export type Canal = "tienda" | "whatsapp";
export type Sincronizacion = "pendiente" | "sincronizada" | "error";

export const CANALES: Record<Canal, string> = {
  tienda: "Tienda",
  whatsapp: "WhatsApp",
};

export const SINCRONIZACION: Record<Sincronizacion, string> = {
  pendiente: "Creándose en Odoo",
  sincronizada: "En Odoo",
  error: "No se creó en Odoo",
};

export interface LineaGuardada {
  posicion: number;
  productoId: number;
  nombre: string;
  codigo: string | null;
  descripcion: string | null;
  cantidad: number;
  precioUnitario: number;
}

export interface Cotizacion {
  id: string;
  canal: Canal;
  cliente: {
    id: number;
    nombre: string;
    documento: string | null;
    telefono: string | null;
  };
  odooOrderId: number | null;
  /** La referencia de Odoo (`S04254`): es como se nombra la cotización. */
  odooOrderName: string | null;
  sincronizacion: Sincronizacion;
  errorSincronizacion: string | null;
  montoSinImpuestos: number | null;
  montoImpuestos: number | null;
  montoTotal: number | null;
  notas: string | null;
  chatAgenteId: string | null;
  creadoPor: string | null;
  creadoEn: string;
  lineas: LineaGuardada[];
}

/** El nombre con que se muestra: la referencia de Odoo o, mientras no la hay, una provisional. */
export const referenciaDe = (c: Pick<Cotizacion, "odooOrderName" | "id">) =>
  c.odooOrderName ?? `Borrador ${c.id.slice(0, 8)}`;

/** La suma de las líneas, para cuando Odoo todavía no puso su total. */
export const sumaLineas = (lineas: Pick<LineaGuardada, "cantidad" | "precioUnitario">[]) =>
  Math.round(lineas.reduce((s, l) => s + l.cantidad * l.precioUnitario, 0) * 100) / 100;

/** Lo que se busca en la lista. */
export const textoBuscable = (c: Cotizacion) =>
  [
    c.odooOrderName,
    c.cliente.nombre,
    c.cliente.documento,
    c.cliente.telefono,
    CANALES[c.canal],
    c.notas,
    ...c.lineas.flatMap((l) => [l.nombre, l.codigo, l.descripcion]),
  ]
    .filter(Boolean)
    .join(" ");
