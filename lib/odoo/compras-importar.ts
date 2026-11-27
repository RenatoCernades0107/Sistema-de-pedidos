/**
 * Leer de Odoo las órdenes de compra confirmadas, tal cual, para que
 * `planificarImportacion` (lib/compras-importar.ts) decida cuáles entran a la app.
 *
 * Solo lee. Pide en pocas rondas —órdenes, líneas, productos, tipos de operación
 * y recepciones— y no una por orden, para que traer cientos no sea lento.
 */

import type { LineaOrdenOdoo, OrdenOdoo } from "../compras-importar";
import { nombreSinCodigo } from "./productos";
import { camposExistentes, ejecutar, idDe, nombreDe, texto } from "./rpc";

type Fila = Record<string, unknown>;

/** Más que esto en una sola vez es mucho para revisar a ojo: se dice que hay más. */
const LIMITE = 1000;

const unico = <T,>(xs: T[]) => [...new Set(xs)];

/** La fecha de Odoo, o null si viene `false`. */
const fecha = (v: unknown) => texto(v);

/**
 * Las órdenes de compra confirmadas o cerradas, menos las de `conocidas` (las que
 * la app ya tiene), pedidas desde `desde` (YYYY-MM-DD) si se da. El filtro va en la
 * consulta y no después: si no, con muchas órdenes el tope se llenaría de las más
 * viejas y las nuevas nunca se verían. Se leen las más recientes primero;
 * `truncado` avisa que había más de las que se leyeron.
 */
export async function leerOrdenesDeCompra(
  conocidas: number[],
  desde: string | null = null,
): Promise<{ ordenes: OrdenOdoo[]; truncado: boolean }> {
  const campos = await camposExistentes("purchase.order", [
    "name", "partner_id", "origin", "partner_ref", "picking_type_id", "order_line", "picking_ids",
    "state", "date_order", "date_approve", "date_planned", "currency_id", "currency_rate",
  ]);
  const dominio: unknown[] = [["state", "in", ["purchase", "done"]]];
  if (conocidas.length) dominio.push(["id", "not in", conocidas]);
  if (desde) dominio.push(["date_order", ">=", `${desde} 00:00:00`]);
  const filas = await ejecutar<Fila[]>("purchase.order", "search_read", [dominio], {
    fields: campos,
    order: "id desc",
    limit: LIMITE + 1,
  });
  const truncado = filas.length > LIMITE;
  const ordenes = filas.slice(0, LIMITE).reverse(); // de la más vieja a la más nueva
  if (ordenes.length === 0) return { ordenes: [], truncado: false };

  // Las líneas, con la referencia interna de sus productos.
  const idsLineas = unico(ordenes.flatMap((o) => (o.order_line as number[]) ?? []));
  const camposLinea = await camposExistentes("purchase.order.line", ["order_id", "product_id", "name", "product_qty", "qty_received", "price_unit", "display_type"]);
  const lineas = idsLineas.length ? await ejecutar<Fila[]>("purchase.order.line", "read", [idsLineas], { fields: camposLinea }) : [];
  const idsProductos = unico(lineas.map((l) => idDe(l.product_id)).filter((x): x is number => x !== null));
  const productos = idsProductos.length
    ? await ejecutar<Fila[]>("product.product", "read", [idsProductos], { fields: ["default_code", "display_name"] })
    : [];
  const codigoDe = new Map(productos.map((p) => [p.id as number, texto(p.default_code)]));
  const nombreProducto = new Map(productos.map((p) => [p.id as number, texto(p.display_name) ?? ""]));

  // De cada tipo de operación, el almacén al que pertenece.
  const idsTipos = unico(ordenes.map((o) => idDe(o.picking_type_id)).filter((x): x is number => x !== null));
  const tipos = idsTipos.length ? await ejecutar<Fila[]>("stock.picking.type", "read", [idsTipos], { fields: ["warehouse_id"] }) : [];
  const almacenDeTipo = new Map(tipos.map((t) => [t.id as number, idDe(t.warehouse_id)]));

  // La última recepción hecha de cada orden.
  const idsRecepciones = unico(ordenes.flatMap((o) => (o.picking_ids as number[]) ?? []));
  const recepciones = idsRecepciones.length ? await ejecutar<Fila[]>("stock.picking", "read", [idsRecepciones], { fields: ["state"] }) : [];
  const hecha = new Set(recepciones.filter((r) => texto(r.state) === "done").map((r) => r.id as number));

  const lineasDe = new Map<number, LineaOrdenOdoo[]>();
  for (const l of lineas) {
    const producto = idDe(l.product_id);
    const orden = idDe(l.order_id);
    // Las secciones y notas del pedido no son un producto.
    if (!producto || !orden || texto(l.display_type)) continue;
    const arr = lineasDe.get(orden) ?? [];
    const codigo = codigoDe.get(producto) ?? null;
    // El código viene del producto; el texto de la línea puede tener uno viejo, y no se usa.
    arr.push({
      productoId: producto,
      nombre: nombreSinCodigo(nombreProducto.get(producto) || nombreDe(l.product_id) || "Producto", codigo),
      codigo,
      cantidad: Number(l.product_qty) || 0,
      recibida: Number(l.qty_received) || 0,
      precio: Number(l.price_unit) || 0,
    });
    lineasDe.set(orden, arr);
  }

  return {
    truncado,
    ordenes: ordenes.map((o): OrdenOdoo => {
      const tipo = idDe(o.picking_type_id);
      // `currency_rate` es cuántas unidades de la moneda de la orden vale 1 sol.
      const tasa = Number(o.currency_rate);
      const entregadas = ((o.picking_ids as number[]) ?? []).filter((id) => hecha.has(id));
      return {
        id: o.id as number,
        nombre: texto(o.name) ?? `Orden ${o.id}`,
        origen: texto(o.origin),
        proveedorId: idDe(o.partner_id),
        proveedorNombre: nombreDe(o.partner_id) ?? "(sin proveedor)",
        referencia: texto(o.partner_ref),
        moneda: nombreDe(o.currency_id),
        tasaPorDolar: tasa > 0 && tasa !== 1 ? Math.round((1 / tasa) * 10_000) / 10_000 : null,
        almacenOdooId: tipo ? (almacenDeTipo.get(tipo) ?? null) : null,
        fechaPedido: fecha(o.date_order),
        confirmadaEn: fecha(o.date_approve),
        fechaPrevista: fecha(o.date_planned),
        ultimaRecepcionId: entregadas.length ? Math.max(...entregadas) : null,
        lineas: lineasDe.get(o.id as number) ?? [],
      };
    }),
  };
}

/** El número de cada orden en Odoo ("P01727"), por su id. */
export async function nombresDeOrdenes(ids: number[]): Promise<Map<number, string>> {
  if (ids.length === 0) return new Map();
  const filas = await ejecutar<Fila[]>("purchase.order", "read", [unico(ids)], { fields: ["name"] });
  return new Map(filas.map((f) => [f.id as number, texto(f.name)]).filter((x): x is [number, string] => x[1] !== null));
}
