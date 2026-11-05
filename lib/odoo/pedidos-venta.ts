/**
 * Cotizaciones de Odoo (`sale.order` en borrador): crearlas y leerlas.
 *
 * En Odoo una cotización y un pedido de venta son el mismo registro en distinto
 * estado; aquí siempre se crea en borrador, que es la cotización.
 */

import { nombreSinCodigo } from "./productos";
import { ejecutar, ErrorOdoo, idDe, nombreDe, texto } from "./rpc";

const MODELO = "sale.order";

type Fila = Record<string, unknown>;

export interface LineaParaOdoo {
  productoId: number;
  nombreProducto: string;
  codigo: string | null;
  cantidad: number;
  precioUnitario: number;
  descripcion: string | null;
}

/**
 * Las líneas en el formato de comandos de Odoo: `[0, 0, valores]` es "crear esta
 * línea". El precio va explícito porque en la pantalla se puede cambiar; si no
 * fuera, Odoo pondría el de su lista de precios.
 *
 * El nombre de la línea solo se manda si hay detalle (medidas): sin él, Odoo
 * pone la descripción de venta del producto, que es lo que se quiere.
 */
export function lineasDeVenta(lineas: LineaParaOdoo[]): unknown[] {
  return lineas.map((l) => {
    const valores: Record<string, unknown> = {
      product_id: l.productoId,
      product_uom_qty: l.cantidad,
      price_unit: l.precioUnitario,
    };
    if (l.descripcion?.trim()) {
      const producto = `${l.codigo ? `[${l.codigo}] ` : ""}${l.nombreProducto}`;
      valores.name = `${producto}\n${l.descripcion.trim()}`;
    }
    return [0, 0, valores];
  });
}

/**
 * La marca que la cotización de Odoo lleva de vuelta a la fila de la app, en el
 * campo "Documento origen". Es lo que permite reintentar sin duplicar: si la
 * primera llamada creó la orden pero la respuesta se perdió por el camino, el
 * reintento la encuentra por aquí en vez de crear otra.
 */
export const origenDe = (cotizacionId: string) => `App Plexiacril ${cotizacionId}`;

export interface ResumenVenta {
  orderId: number;
  orderName: string;
  montoSinImpuestos: number | null;
  montoImpuestos: number | null;
  montoTotal: number | null;
}

const numero = (v: unknown) => (typeof v === "number" ? v : null);

function deResumen(f: Fila): ResumenVenta {
  return {
    orderId: f.id as number,
    orderName: texto(f.name) ?? `#${f.id}`,
    montoSinImpuestos: numero(f.amount_untaxed),
    montoImpuestos: numero(f.amount_tax),
    montoTotal: numero(f.amount_total),
  };
}

const CAMPOS_RESUMEN = ["name", "amount_untaxed", "amount_tax", "amount_total"];

export async function leerResumen(orderId: number): Promise<ResumenVenta | null> {
  const filas = await ejecutar<Fila[]>(MODELO, "read", [[orderId]], { fields: CAMPOS_RESUMEN });
  return filas[0] ? deResumen(filas[0]) : null;
}

export async function crearPedidoDeVenta(datos: {
  cotizacionId: string;
  clienteId: number;
  lineas: LineaParaOdoo[];
}): Promise<ResumenVenta & { yaExistia: boolean }> {
  const origen = origenDe(datos.cotizacionId);

  const previas = await ejecutar<Fila[]>(MODELO, "search_read", [[["origin", "=", origen]]], {
    fields: CAMPOS_RESUMEN,
    limit: 1,
  });
  if (previas[0]) return { ...deResumen(previas[0]), yaExistia: true };

  const id = await ejecutar<number>(MODELO, "create", [
    {
      partner_id: datos.clienteId,
      origin: origen,
      order_line: lineasDeVenta(datos.lineas),
    },
  ]);

  const resumen = await leerResumen(id);
  if (!resumen) throw new ErrorOdoo("Odoo creó la cotización pero no la devolvió.");
  return { ...resumen, yaExistia: false };
}

/* ── Leer lo que creó el asistente ─────────────────────────────────────────── */

export interface LineaLeida {
  productoId: number;
  nombre: string;
  codigo: string | null;
  cantidad: number;
  precioUnitario: number;
  descripcion: string | null;
}

export interface VentaLeida extends ResumenVenta {
  clienteId: number;
  lineas: LineaLeida[];
}

/**
 * Una línea de `sale.order.line` en el idioma de la app. `null` para las que no
 * son productos: secciones y notas (`display_type`) no van a la tabla.
 *
 * La descripción que vale guardar es lo que Odoo tiene *además* del nombre del
 * producto: el asistente escribe ahí las medidas ("5 piezas 30x50cm").
 */
export function deLineaVenta(f: Fila): LineaLeida | null {
  if (texto(f.display_type)) return null;
  const productoId = idDe(f.product_id);
  if (!productoId) return null;

  const etiqueta = nombreDe(f.product_id) ?? "";
  const codigo = etiqueta.match(/^\[([^\]]+)\]/)?.[1]?.trim() ?? null;
  const nombre = nombreSinCodigo(etiqueta, codigo) || "(sin nombre)";

  const lineasNombre = (texto(f.name) ?? "").split("\n");
  if (lineasNombre[0]?.trim() === etiqueta.trim() || lineasNombre[0]?.trim() === nombre.trim()) {
    lineasNombre.shift();
  }
  const descripcion = lineasNombre.join("\n").trim() || null;

  return {
    productoId,
    nombre,
    codigo,
    cantidad: numero(f.product_uom_qty) ?? 0,
    precioUnitario: numero(f.price_unit) ?? 0,
    descripcion,
  };
}

export async function leerPedidoDeVenta(orderId: number): Promise<VentaLeida | null> {
  const filas = await ejecutar<Fila[]>(MODELO, "read", [[orderId]], {
    fields: [...CAMPOS_RESUMEN, "partner_id", "order_line"],
  });
  const orden = filas[0];
  if (!orden) return null;

  const clienteId = idDe(orden.partner_id);
  if (!clienteId) return null;

  const idsLineas = Array.isArray(orden.order_line) ? (orden.order_line as number[]) : [];
  const lineas = idsLineas.length
    ? await ejecutar<Fila[]>("sale.order.line", "read", [idsLineas], {
        fields: ["product_id", "name", "product_uom_qty", "price_unit", "display_type", "sequence"],
      })
    : [];

  return {
    ...deResumen(orden),
    clienteId,
    lineas: lineas
      .sort((a, b) => ((a.sequence as number) ?? 0) - ((b.sequence as number) ?? 0))
      .map(deLineaVenta)
      .filter((l): l is LineaLeida => l !== null && l.cantidad > 0),
  };
}
