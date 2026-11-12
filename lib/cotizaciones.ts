/**
 * Las cotizaciones del sistema, en el idioma de la pantalla.
 *
 * No confundir con `lib/cotizaciones-tipos.ts`, que es el idioma de la Quote
 * Agent API (el chat del asistente). Esto es lo que vive en la tabla
 * `cotizaciones` de Supabase, con su espejo en Odoo.
 */

import {
  planchasTexto,
  resumenPiezas,
  tituloCorte,
  totalPiezas,
  type CorteGuardado,
} from "./cortes/guardado";
import { descripcionDeTerminado, tituloTerminado, type TerminadoGuardado } from "./terminados/guardado";

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
  /**
   * Si la línea es un corte a medida, su cálculo. Entonces el producto es la
   * plancha de la que sale y la cantidad, cuántas planchas se abren.
   */
  corte: CorteGuardado | null;
  /**
   * Si la línea es un producto terminado, su ficha. Entonces el producto es el
   * de Odoo con que se vende y la cantidad, cuántas unidades.
   */
  terminado: TerminadoGuardado | null;
  /** La orden de fabricación de la línea en Odoo, si ya tiene una. */
  produccionId?: number | null;
  /** Lo que se cobra por la línea. En un producto, cantidad × precio. */
  importe: number;
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
  /** El pedido que salió de esta cotización. Uno como mucho. */
  pedido: { codigo: string } | null;
  /** Si la `sale.order` ya pasó de cotización a pedido de venta en Odoo. */
  confirmadaEnOdoo: boolean;
  /** Por qué no se pudo confirmar en Odoo, hasta que se reintente. */
  errorConfirmacion: string | null;
}

/** El nombre con que se muestra: la referencia de Odoo o, mientras no la hay, una provisional. */
export const referenciaDe = (c: Pick<Cotizacion, "odooOrderName" | "id">) =>
  c.odooOrderName ?? `Borrador ${c.id.slice(0, 8)}`;

/** La suma de las líneas, para cuando Odoo todavía no puso su total. */
export const sumaLineas = (lineas: Pick<LineaGuardada, "importe">[]) =>
  Math.round(lineas.reduce((s, l) => s + l.importe, 0) * 100) / 100;

/** El importe de una línea de producto: céntimos sin arrastre. */
export const importeDeProducto = (cantidad: number, precioUnitario: number) =>
  Math.round((cantidad * precioUnitario + Number.EPSILON) * 100) / 100;

/**
 * El detalle del pedido a partir de lo cotizado: una línea por producto, con
 * cantidad, código y medidas. Es texto libre que el taller lee tal cual.
 */
export const detalleDesdeLineas = (lineas: LineaGuardada[]) =>
  lineas
    .map((l) => {
      if (l.corte) {
        const piezas = totalPiezas(l.corte.piezas);
        return (
          `${tituloCorte(l.corte)}: ${piezas} ${piezas === 1 ? "pieza" : "piezas"} ` +
          `(${resumenPiezas(l.corte.piezas)}) — ${planchasTexto(l.corte)}`
        );
      }
      const cantidad = String(+l.cantidad.toFixed(3));
      if (l.terminado) {
        const ficha = descripcionDeTerminado(l.terminado);
        return `${cantidad} × ${tituloTerminado(l.terminado)}${ficha ? ` — ${ficha}` : ""}`;
      }
      const producto = l.codigo ? `[${l.codigo}] ${l.nombre}` : l.nombre;
      const medidas = l.descripcion?.replace(/\s+/g, " ").trim();
      return `${cantidad} × ${producto}${medidas ? ` — ${medidas}` : ""}`;
    })
    .join("\n");

/** Lo que se busca en la lista. */
export const textoBuscable = (c: Cotizacion) =>
  [
    c.odooOrderName,
    c.cliente.nombre,
    c.cliente.documento,
    c.cliente.telefono,
    CANALES[c.canal],
    c.notas,
    c.pedido?.codigo,
    ...c.lineas.flatMap((l) => [
      l.nombre,
      l.codigo,
      l.descripcion,
      l.corte?.material,
      l.corte?.color,
      l.terminado?.productoCodigo,
      l.terminado?.tipoNombre,
    ]),
  ]
    .filter(Boolean)
    .join(" ");
