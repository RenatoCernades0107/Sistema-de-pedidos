/**
 * Los almacenes en Odoo: crearlos, saber cuánto hay en cada uno y meterles
 * stock (una compra o un ajuste) o pasarlo de uno a otro.
 *
 * Cada almacén de la app es un `stock.warehouse`. Al crearlo, Odoo le arma su
 * ubicación de stock (`lot_stock_id`) y sus tipos de operación: recepción
 * (`in_type_id`), transferencia interna (`int_type_id`) y fabricación
 * (`manu_type_id`). La app guarda los ids y trabaja con ellos.
 *
 * Lo que cambia entre versiones, y aquí se detecta: la cantidad hecha de un
 * movimiento (`quantity` + `picked` desde la 17, `quantity_done` antes), igual
 * que en `entregas.ts`.
 */

import { camposExistentes, ejecutar, ErrorOdoo, idDe, texto } from "./rpc";

type Fila = Record<string, unknown>;

/* ── El almacén ────────────────────────────────────────────────────────────── */

export interface AlmacenOdoo {
  warehouseId: number;
  /** `lot_stock_id`: donde entran y salen las cosas. */
  ubicacionId: number;
  recepcionId: number | null;
  internoId: number | null;
  fabricacionId: number | null;
}

const CAMPOS_ALMACEN = ["lot_stock_id", "in_type_id", "int_type_id", "manu_type_id", "code", "name"];

function deAlmacen(f: Fila): AlmacenOdoo {
  const ubicacion = idDe(f.lot_stock_id);
  if (!ubicacion) throw new ErrorOdoo(`El almacén ${texto(f.name) ?? f.id} de Odoo no tiene ubicación de stock.`);
  return {
    warehouseId: f.id as number,
    ubicacionId: ubicacion,
    recepcionId: idDe(f.in_type_id),
    internoId: idDe(f.int_type_id),
    fabricacionId: idDe(f.manu_type_id),
  };
}

async function camposAlmacen() {
  return camposExistentes("stock.warehouse", CAMPOS_ALMACEN);
}

/**
 * El almacén de Odoo por su id, con sus ubicaciones y operaciones. Con `codigo`,
 * además comprueba que sea ese: si en ese id hay otro almacén, es como si no existiera.
 */
export async function leerAlmacen(warehouseId: number, codigo?: string): Promise<AlmacenOdoo> {
  const [f] = await ejecutar<Fila[]>("stock.warehouse", "read", [[warehouseId]], { fields: await camposAlmacen() });
  if (!f) throw new ErrorOdoo("Ese almacén ya no existe en Odoo. Vuelve a crearlo desde Almacenes.");
  if (codigo && texto(f.code) && texto(f.code) !== codigo) {
    throw new ErrorOdoo(`El almacén ${warehouseId} de Odoo ya no es ${codigo}.`);
  }
  return deAlmacen(f);
}

/**
 * El almacén con ese código, y si no existe, lo crea. Se puede repetir: un
 * intento anterior que se cortó a medias no deja dos.
 */
export async function asegurarAlmacen(a: { nombre: string; codigo: string }): Promise<AlmacenOdoo> {
  const buscar = async () =>
    ejecutar<Fila[]>("stock.warehouse", "search_read", [[["code", "=", a.codigo]]], {
      fields: await camposAlmacen(),
      limit: 1,
    });
  const [existente] = await buscar();
  if (existente) return deAlmacen(existente);

  try {
    await ejecutar("stock.warehouse", "create", [{ name: a.nombre, code: a.codigo }]);
  } catch (e) {
    if (e instanceof ErrorOdoo && /AccessError|UserError|ValidationError/.test(e.tipo ?? "")) {
      throw new ErrorOdoo(
        `Odoo no dejó crear el almacén ${a.nombre}: ${e.message} ` +
          "Revisa que Inventario → Ajustes → Almacenes (ubicaciones de almacenamiento) esté activado " +
          "y que el usuario de la app sea administrador de Inventario.",
        e.tipo,
      );
    }
    throw e;
  }
  const [creado] = await buscar();
  if (!creado) throw new ErrorOdoo(`Odoo creó el almacén ${a.nombre} pero no lo devolvió.`);
  return deAlmacen(creado);
}

/* ── Cuánto hay ────────────────────────────────────────────────────────────── */

export interface UbicacionDeAlmacen {
  /** El id del almacén en la app. */
  almacenId: string;
  ubicacionId: number;
}

export interface StockDeProducto {
  /** En la mano, por almacén de la app. */
  porAlmacen: Record<string, number>;
  /** Lo que hay en todas las ubicaciones internas de Odoo. */
  total: number;
  /** Lo que está fuera de los almacenes de la app (el almacén anterior de Odoo). */
  fuera: number;
}

const numero = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * El stock de unos productos en cada almacén. Odoo calcula `qty_available` para
 * una ubicación (y sus hijas) cuando se le pasa en el contexto: una consulta por
 * almacén, más una sin contexto para el total.
 */
export async function stockPorAlmacen(
  productoIds: number[],
  almacenes: UbicacionDeAlmacen[],
): Promise<Map<number, StockDeProducto>> {
  const mapa = new Map<number, StockDeProducto>();
  const ids = [...new Set(productoIds)].filter((id) => id > 0);
  if (ids.length === 0) return mapa;
  for (const id of ids) mapa.set(id, { porAlmacen: {}, total: 0, fuera: 0 });

  const leer = (contexto?: Record<string, unknown>) =>
    ejecutar<Fila[]>("product.product", "read", [ids], {
      fields: ["qty_available"],
      ...(contexto ? { context: contexto } : {}),
    });

  const [total, ...porAlmacen] = await Promise.all([
    leer(),
    ...almacenes.map((a) => leer({ location: a.ubicacionId })),
  ]);
  for (const f of total) {
    const s = mapa.get(f.id as number);
    if (s) s.total = numero(f.qty_available);
  }
  almacenes.forEach((a, i) => {
    for (const f of porAlmacen[i]) {
      const s = mapa.get(f.id as number);
      if (s) s.porAlmacen[a.almacenId] = numero(f.qty_available);
    }
  });
  for (const s of mapa.values()) {
    const enAlmacenes = Object.values(s.porAlmacen).reduce((t, x) => t + x, 0);
    s.fuera = Math.round((s.total - enAlmacenes) * 1e4) / 1e4;
  }
  return mapa;
}

/* ── Meter stock ───────────────────────────────────────────────────────────── */

export interface LineaDeIngreso {
  productoId: number;
  cantidad: number;
  /** El costo de una unidad: Odoo lo usa para valorar el inventario. */
  costo?: number | null;
}

const contextoValidar = (ids: number[]) => ({
  skip_backorder: true,
  picking_ids_not_to_backorder: ids,
  skip_immediate: true,
  skip_sms: true,
});

const esAsistente = (r: unknown) => typeof r === "object" && r !== null && "res_model" in r;

async function uomDe(productoId: number): Promise<number> {
  const [f] = await ejecutar<Fila[]>("product.product", "read", [[productoId]], { fields: ["uom_id"] });
  const uom = idDe(f?.uom_id);
  if (!uom) throw new ErrorOdoo("No se pudo leer la unidad de un producto en Odoo.");
  return uom;
}

/**
 * Un movimiento entre dos ubicaciones, lleno por completo y listo para validar.
 * Los valores van con `name` solo si esta versión lo pide.
 */
async function moverDentro(
  pickingId: number,
  desde: number,
  hacia: number,
  l: LineaDeIngreso,
  nombre: string,
): Promise<number> {
  const conNombre = (await camposExistentes("stock.move", ["name"])).length > 0;
  return ejecutar<number>("stock.move", "create", [
    {
      ...(conNombre ? { name: nombre } : {}),
      picking_id: pickingId,
      product_id: l.productoId,
      product_uom_qty: l.cantidad,
      product_uom: await uomDe(l.productoId),
      location_id: desde,
      location_dest_id: hacia,
      ...(l.costo !== undefined && l.costo !== null ? { price_unit: l.costo } : {}),
    },
  ]);
}

/** Pone en cada movimiento del picking lo que de verdad se movió, y lo valida. */
async function validarPicking(pickingId: number, cantidades: Map<number, number>) {
  await ejecutar("stock.picking", "action_confirm", [[pickingId]]);
  const picked = (await camposExistentes("stock.move", ["picked"])).length > 0;
  const campo = picked ? "quantity" : "quantity_done";
  for (const [moveId, cantidad] of cantidades) {
    await ejecutar("stock.move", "write", [[moveId], { [campo]: cantidad, ...(picked ? { picked: cantidad > 0 } : {}) }]);
  }
  const r = await ejecutar("stock.picking", "button_validate", [[pickingId]], { context: contextoValidar([pickingId]) });
  if (esAsistente(r)) {
    throw new ErrorOdoo("Odoo pidió confirmar algo más para validar la operación. Valídala desde Odoo.");
  }
}

/** La ubicación de los proveedores (de donde llega una compra). */
async function ubicacionProveedores(): Promise<number> {
  const [id] = await ejecutar<number[]>("stock.location", "search", [[["usage", "=", "supplier"]]], { limit: 1 });
  if (!id) throw new ErrorOdoo("Odoo no tiene la ubicación de proveedores.");
  return id;
}

/** El picking que ya tiene ese origen (un reintento), si lo hay. */
async function pickingPorOrigen(origen: string): Promise<{ id: number; estado: string | null } | null> {
  const [p] = await ejecutar<Fila[]>("stock.picking", "search_read", [[["origin", "=", origen]]], {
    fields: ["state"],
    limit: 1,
  });
  return p ? { id: p.id as number, estado: texto(p.state) } : null;
}

export interface Compra {
  almacen: AlmacenOdoo;
  /** El proveedor (`res.partner`). */
  proveedorId: number;
  /** Lo que la identifica: "App Plexiacril ING-00001". Reintentar no duplica. */
  origen: string;
  /** La guía o factura del proveedor, si la hay. */
  documento: string | null;
  lineas: LineaDeIngreso[];
}

/**
 * Una compra: la recepción del almacén, con el proveedor, el costo de cada
 * producto y todo recibido. Devuelve el id del picking.
 */
export async function ingresarCompra(c: Compra): Promise<number> {
  if (!c.almacen.recepcionId) throw new ErrorOdoo("El almacén no tiene operación de recepción en Odoo.");
  const previo = await pickingPorOrigen(c.origen);
  if (previo?.estado === "done") return previo.id;
  if (previo && previo.estado === "cancel") throw new ErrorOdoo("La recepción de este ingreso está cancelada en Odoo.");

  let pickingId = previo?.id ?? null;
  const cantidades = new Map<number, number>();
  if (pickingId) {
    const movs = await ejecutar<Fila[]>("stock.move", "search_read", [[["picking_id", "=", pickingId]]], {
      fields: ["product_uom_qty"],
    });
    for (const m of movs) cantidades.set(m.id as number, Number(m.product_uom_qty) || 0);
  } else {
    const desde = await ubicacionProveedores();
    const conRef = (await camposExistentes("stock.picking", ["partner_ref"])).length > 0;
    pickingId = await ejecutar<number>("stock.picking", "create", [
      {
        picking_type_id: c.almacen.recepcionId,
        partner_id: c.proveedorId,
        origin: c.origen,
        location_id: desde,
        location_dest_id: c.almacen.ubicacionId,
        ...(c.documento && conRef ? { partner_ref: c.documento } : {}),
      },
    ]);
    for (const l of c.lineas.filter((x) => x.cantidad > 0)) {
      const id = await moverDentro(pickingId, desde, c.almacen.ubicacionId, l, "Compra");
      cantidades.set(id, l.cantidad);
    }
  }
  if (cantidades.size === 0) throw new ErrorOdoo("La compra no tiene nada que recibir.");
  await validarPicking(pickingId, cantidades);
  return pickingId;
}

export interface Ajuste {
  ubicacionId: number;
  lineas: { productoId: number; cantidad: number }[];
}

/**
 * Un ajuste de inventario: lo contado pasa a ser lo que hay en la ubicación del
 * almacén. Devuelve lo que Odoo tenía antes, por producto.
 */
export async function ajustarInventario(a: Ajuste): Promise<Map<number, number>> {
  const ids = a.lineas.map((l) => l.productoId);
  const antes = new Map<number, number>();
  const filas = await ejecutar<Fila[]>("product.product", "read", [ids], {
    fields: ["qty_available"],
    context: { location: a.ubicacionId },
  });
  for (const f of filas) antes.set(f.id as number, numero(f.qty_available));

  const contexto = { context: { inventory_mode: true } };
  for (const l of a.lineas) {
    const [quant] = await ejecutar<Fila[]>(
      "stock.quant",
      "search_read",
      [[["product_id", "=", l.productoId], ["location_id", "=", a.ubicacionId], ["lot_id", "=", false]]],
      { fields: ["quantity"], limit: 1 },
    );
    const quantId = quant
      ? (quant.id as number)
      : await ejecutar<number>(
          "stock.quant",
          "create",
          [{ product_id: l.productoId, location_id: a.ubicacionId, inventory_quantity: l.cantidad }],
          contexto,
        );
    if (quant) await ejecutar("stock.quant", "write", [[quantId], { inventory_quantity: l.cantidad }], contexto);
    await ejecutar("stock.quant", "action_apply_inventory", [[quantId]], contexto);
  }
  return antes;
}

export interface Transferencia {
  desde: AlmacenOdoo;
  hacia: AlmacenOdoo;
  origen: string;
  lineas: { productoId: number; cantidad: number }[];
}

/**
 * Pasa productos de un almacén a otro con la transferencia interna del almacén
 * de origen. Se puede repetir por su origen. Para la fase de transferencias: hoy
 * no la llama ninguna pantalla.
 */
export async function transferirInterno(t: Transferencia): Promise<number> {
  if (!t.desde.internoId) throw new ErrorOdoo("El almacén de origen no tiene operación de transferencia interna.");
  const previo = await pickingPorOrigen(t.origen);
  if (previo?.estado === "done") return previo.id;
  if (previo) throw new ErrorOdoo("La transferencia quedó a medias en Odoo. Termínala desde Odoo.");

  const pickingId = await ejecutar<number>("stock.picking", "create", [
    {
      picking_type_id: t.desde.internoId,
      origin: t.origen,
      location_id: t.desde.ubicacionId,
      location_dest_id: t.hacia.ubicacionId,
    },
  ]);
  const cantidades = new Map<number, number>();
  for (const l of t.lineas.filter((x) => x.cantidad > 0)) {
    const id = await moverDentro(pickingId, t.desde.ubicacionId, t.hacia.ubicacionId, l, "Transferencia");
    cantidades.set(id, l.cantidad);
  }
  await validarPicking(pickingId, cantidades);
  return pickingId;
}
