/**
 * Traer a la app las órdenes de compra que ya existen en Odoo.
 *
 * Una compra de la app nace como pre-compra y TERMINA en Odoo. Pero hay órdenes
 * que se hicieron directo en Odoo (Compras → Pedidos) y la app no las conoce:
 * no salen en Compras, Almacén no las puede recibir y su costo no se liquida.
 * Esto decide, orden por orden, si se puede traer y cómo queda. Sin red ni base
 * de datos: recibe lo leído de Odoo y devuelve el plan.
 *
 * Las que creó una compra de la app (origen CMP-…) no se importan: ya existen. Las que
 * creó un ingreso de Almacén (origen ING-…) sí, porque Compras no las tiene.
 *
 * Qué es una "orden de Odoo" aquí: la confirmada (`purchase`) o cerrada (`done`).
 * Las solicitudes de cotización (borrador) y las canceladas no son compras.
 *
 * Qué se infiere, porque Odoo no lo sabe (todo se puede corregir en Odoo, no en
 * la app, después de traerla):
 *   - tipo: en dólares → importación; en soles → nacional.
 *   - condición de pago: contado (nacional) o adelantado (importación).
 *   - incoterm: ninguno. Sin incoterm la liquidación trata el flete y el seguro
 *     como gastos aparte, igual que en FOB.
 */

import { estadoPorRecepcion, type CondicionPago, type EstadoCompra } from "./compras";
import type { Moneda, TipoCompra } from "./costeo";

/** El origen de lo que la propia app crea en Odoo (`origenDe`). */
export const PREFIJO_ORIGEN_APP = "App Plexiacril";

/**
 * ¿La orden la creó una compra de este módulo ("App Plexiacril CMP-00012")? Esas ya
 * tienen su compra en la app: se enlazan, no se importan. El mismo prefijo lo llevan
 * los ingresos de Almacén ("App Plexiacril ING-00003", también "ING-00002 + ING-00003"):
 * son órdenes de compra de verdad que Compras no tiene, y esas SÍ se importan.
 */
export const esOrdenDeCompraDeApp = (origen: string | null | undefined): origen is string =>
  !!origen && new RegExp(`^${PREFIJO_ORIGEN_APP} CMP-\\d+$`).test(origen.trim());

export interface LineaOrdenOdoo {
  productoId: number;
  nombre: string;
  /** La referencia interna del producto en Odoo (`default_code`). */
  codigo: string | null;
  cantidad: number;
  recibida: number;
  /** En la moneda de la orden. */
  precio: number;
}

export interface OrdenOdoo {
  id: number;
  /** "P00012" */
  nombre: string;
  origen: string | null;
  proveedorId: number | null;
  proveedorNombre: string;
  /** La referencia del proveedor (su proforma o cotización). */
  referencia: string | null;
  moneda: string | null;
  /** Soles por dólar según la propia orden, si Odoo la trae. */
  tasaPorDolar: number | null;
  /** El `stock.warehouse` donde recibe, el de su tipo de operación. */
  almacenOdooId: number | null;
  /** "YYYY-MM-DD HH:MM:SS", en UTC como lo da Odoo. */
  fechaPedido: string | null;
  confirmadaEn: string | null;
  fechaPrevista: string | null;
  /** La última recepción hecha, si ya llegó algo. */
  ultimaRecepcionId: number | null;
  lineas: LineaOrdenOdoo[];
}

export interface CompraPorImportar {
  ordenId: number;
  ordenNombre: string;
  proveedorId: number;
  proveedorNombre: string;
  almacenId: string;
  tipo: TipoCompra;
  moneda: Moneda;
  tcMercaderia: number | null;
  condicionPago: CondicionPago;
  documento: string | null;
  fechaLlegadaEstimada: string | null;
  /** ISO, para `creado_en`. */
  creadaEn: string;
  confirmadaEn: string;
  nota: string;
  estado: EstadoCompra;
  ultimaRecepcionId: number | null;
  lineas: { productoId: number; codigo: string; nombre: string; cantidad: number; precio: number; recibida: number }[];
}

export interface OrdenOmitida {
  ordenId: number;
  ordenNombre: string;
  proveedor: string;
  motivo: string;
}

export interface PlanImportacion {
  porImportar: CompraPorImportar[];
  omitidas: OrdenOmitida[];
  /**
   * Las que nacieron en la app (su origen es el de la app, "App Plexiacril CMP-00012") y
   * que la app no tiene enlazadas: la orden se creó en Odoo pero la compra no guardó su id.
   */
  deLaApp: { ordenId: number; ordenNombre: string; proveedor: string; origen: string }[];
}

export interface ContextoImportacion {
  /** Los almacenes activos de la app que ya existen en Odoo. */
  almacenes: { id: string; odooWarehouseId: number | null }[];
  /** Los códigos de planchas y accesorios del almacén. */
  catalogo: Set<string>;
  /** El tipo de cambio de hoy, para las órdenes en dólares que no traen el suyo. */
  tcActual: number | null;
}

const MAX_UNIDADES = 99_999;

/** "2026-12-01 15:30:00" (UTC de Odoo) → "2026-12-01T15:30:00Z". */
export const instanteDeOdoo = (v: string): string => `${v.replace(" ", "T")}Z`;

const r6 = (n: number) => Math.round(n * 1_000_000) / 1_000_000;

export function planificarImportacion(ordenes: OrdenOdoo[], ctx: ContextoImportacion): PlanImportacion {
  const plan: PlanImportacion = { porImportar: [], omitidas: [], deLaApp: [] };

  for (const o of ordenes) {
    if (esOrdenDeCompraDeApp(o.origen)) {
      plan.deLaApp.push({ ordenId: o.id, ordenNombre: o.nombre, proveedor: o.proveedorNombre, origen: o.origen });
      continue;
    }

    const omitir = (motivo: string) =>
      void plan.omitidas.push({ ordenId: o.id, ordenNombre: o.nombre, proveedor: o.proveedorNombre, motivo });

    if (!o.proveedorId) {
      omitir("No tiene proveedor.");
      continue;
    }
    const almacen = o.almacenOdooId ? ctx.almacenes.find((a) => a.odooWarehouseId === o.almacenOdooId) : undefined;
    if (!almacen) {
      omitir("Recibe en un almacén de Odoo que no está activo en la app.");
      continue;
    }
    if (o.moneda !== "PEN" && o.moneda !== "USD") {
      omitir(`Está en ${o.moneda ?? "una moneda desconocida"}: la app solo maneja soles y dólares.`);
      continue;
    }
    const moneda: Moneda = o.moneda;
    const tcMercaderia = moneda === "USD" ? (o.tasaPorDolar ?? ctx.tcActual) : null;
    if (moneda === "USD" && !tcMercaderia) {
      omitir("Está en dólares y no hay tipo de cambio: cárgalo en Odoo (Contabilidad → Monedas) y repite.");
      continue;
    }

    // Un producto en dos líneas se junta en una: la app guarda un ítem por producto.
    const porProducto = new Map<number, { codigo: string; nombre: string; cantidad: number; recibida: number; total: number }>();
    let problema: string | null = null;
    for (const l of o.lineas) {
      if (!(l.cantidad > 0)) continue;
      if (!l.codigo || !ctx.catalogo.has(l.codigo)) {
        problema = `${l.nombre} no es una plancha ni un accesorio del almacén.`;
        break;
      }
      if (!Number.isInteger(l.cantidad) || !Number.isInteger(l.recibida)) {
        problema = `${l.codigo}: la app maneja unidades enteras y Odoo tiene ${l.cantidad} (recibido ${l.recibida}).`;
        break;
      }
      const previo = porProducto.get(l.productoId);
      porProducto.set(l.productoId, {
        codigo: l.codigo,
        nombre: l.nombre,
        cantidad: (previo?.cantidad ?? 0) + l.cantidad,
        recibida: (previo?.recibida ?? 0) + Math.min(l.recibida, l.cantidad),
        total: (previo?.total ?? 0) + l.cantidad * l.precio,
      });
    }
    if (problema) {
      omitir(problema);
      continue;
    }
    if (porProducto.size === 0) {
      omitir("No tiene ítems con cantidad.");
      continue;
    }
    if ([...porProducto.values()].some((p) => p.cantidad > MAX_UNIDADES)) {
      omitir(`Hay un ítem de más de ${MAX_UNIDADES.toLocaleString("es-PE")} unidades.`);
      continue;
    }

    const lineas = [...porProducto].map(([productoId, p]) => ({
      productoId,
      codigo: p.codigo,
      nombre: p.nombre,
      cantidad: p.cantidad,
      precio: r6(p.total / p.cantidad),
      recibida: p.recibida,
    }));
    const creada = instanteDeOdoo(o.fechaPedido ?? o.confirmadaEn ?? "1970-01-01 00:00:00");
    const tipo: TipoCompra = moneda === "USD" ? "importacion" : "nacional";
    plan.porImportar.push({
      ordenId: o.id,
      ordenNombre: o.nombre,
      proveedorId: o.proveedorId,
      proveedorNombre: o.proveedorNombre,
      almacenId: almacen.id,
      tipo,
      moneda,
      tcMercaderia,
      condicionPago: tipo === "nacional" ? "contado" : "adelantado",
      documento: o.referencia ? o.referencia.slice(0, 60) : null,
      fechaLlegadaEstimada: o.fechaPrevista ? o.fechaPrevista.slice(0, 10) : null,
      creadaEn: creada,
      confirmadaEn: o.confirmadaEn ? instanteDeOdoo(o.confirmadaEn) : creada,
      nota: `Traída de Odoo: ${o.nombre}.${o.origen ? ` Origen: ${o.origen}.` : ""}`,
      estado: estadoPorRecepcion(lineas.map((l) => ({ cantidad: l.cantidad, recibida: l.recibida }))),
      ultimaRecepcionId: o.ultimaRecepcionId,
      lineas,
    });
  }
  return plan;
}
