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

import { campoCantidad, camposExistentes, ejecutar, ErrorOdoo, idDe, texto } from "./rpc";

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
 *
 * Con `libre`, lo que no está reservado (`free_qty`): lo que de verdad se puede
 * usar para un pedido nuevo.
 */
export async function stockPorAlmacen(
  productoIds: number[],
  almacenes: UbicacionDeAlmacen[],
  opciones: { libre?: boolean } = {},
): Promise<Map<number, StockDeProducto>> {
  const campo = opciones.libre ? "free_qty" : "qty_available";
  const mapa = new Map<number, StockDeProducto>();
  const ids = [...new Set(productoIds)].filter((id) => id > 0);
  if (ids.length === 0) return mapa;
  for (const id of ids) mapa.set(id, { porAlmacen: {}, total: 0, fuera: 0 });

  const leer = (contexto?: Record<string, unknown>) =>
    ejecutar<Fila[]>("product.product", "read", [ids], {
      fields: [campo],
      ...(contexto ? { context: contexto } : {}),
    });

  const [total, ...porAlmacen] = await Promise.all([
    leer(),
    ...almacenes.map((a) => leer({ location: a.ubicacionId })),
  ]);
  for (const f of total) {
    const s = mapa.get(f.id as number);
    if (s) s.total = numero(f[campo]);
  }
  almacenes.forEach((a, i) => {
    for (const f of porAlmacen[i]) {
      const s = mapa.get(f.id as number);
      if (s) s.porAlmacen[a.almacenId] = numero(f[campo]);
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

/** Un movimiento de un lote (un sobrante): se mueve por su línea, con ese lote y no otro. */
interface MovimientoDeLote {
  moveId: number;
  productoId: number;
  loteId: number;
  desde: number;
  hacia: number;
}

/**
 * Pone en cada movimiento del picking lo que de verdad se movió, y lo valida.
 * Los de un lote van por su línea: si Odoo reservó otro lote del mismo
 * producto, esa línea se quita.
 */
async function validarPicking(pickingId: number, cantidades: Map<number, number>, lotes: MovimientoDeLote[] = []) {
  await ejecutar("stock.picking", "action_confirm", [[pickingId]]);
  const { picked, campoMov: campo, campoLinea } = await campoCantidad();
  for (const [moveId, cantidad] of cantidades) {
    await ejecutar("stock.move", "write", [[moveId], { [campo]: cantidad, ...(picked ? { picked: cantidad > 0 } : {}) }]);
  }
  for (const m of lotes) {
    const lineas = await ejecutar<Fila[]>("stock.move.line", "search_read", [[["move_id", "=", m.moveId]]], {
      fields: ["lot_id"],
    });
    const otras = lineas.filter((l) => idDe(l.lot_id) !== m.loteId).map((l) => l.id as number);
    if (otras.length) await ejecutar("stock.move.line", "unlink", [otras]);
    const nuestra = lineas.find((l) => idDe(l.lot_id) === m.loteId);
    const valores = { [campoLinea]: 1, ...(picked ? { picked: true } : {}) };
    if (nuestra) {
      await ejecutar("stock.move.line", "write", [[nuestra.id as number], valores]);
    } else {
      await ejecutar("stock.move.line", "create", [
        {
          move_id: m.moveId,
          product_id: m.productoId,
          lot_id: m.loteId,
          location_id: m.desde,
          location_dest_id: m.hacia,
          ...valores,
        },
      ]);
    }
    if (picked) await ejecutar("stock.move", "write", [[m.moveId], { picked: true }]);
  }
  const r = await ejecutar("stock.picking", "button_validate", [[pickingId]], { context: contextoValidar([pickingId]) });
  if (esAsistente(r)) {
    throw new ErrorOdoo("Odoo pidió confirmar algo más para validar la operación. Valídala desde Odoo.");
  }
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
 * Si la app Compras está instalada en este Odoo. Se mira pidiendo los campos de
 * `purchase.order` y no leyendo `ir.model`: ese modelo solo lo ve un administrador,
 * y el usuario de la app no tiene por qué serlo. Si falla por permisos, ese error
 * se muestra tal cual.
 */
async function hayCompras(): Promise<boolean> {
  try {
    await ejecutar("purchase.order", "fields_get", [], { attributes: ["type"] });
    return true;
  } catch (e) {
    if (e instanceof ErrorOdoo && /doesn't exist|does not exist|KeyError/i.test(e.message)) return false;
    throw e;
  }
}

/** Las líneas de la orden de compra: producto, cantidad y costo, con la unidad que pide esta versión. */
async function lineasDeCompra(lineas: LineaDeIngreso[]): Promise<unknown[]> {
  const [campoUom] = await camposExistentes("purchase.order.line", ["product_uom", "product_uom_id"]);
  const productos = await ejecutar<Fila[]>("product.product", "read", [[...new Set(lineas.map((l) => l.productoId))]], {
    fields: ["display_name"],
  });
  const nombres = new Map(productos.map((p) => [p.id as number, texto(p.display_name) ?? ""]));
  const comandos: unknown[] = [];
  for (const l of lineas) {
    comandos.push([
      0,
      0,
      {
        product_id: l.productoId,
        name: nombres.get(l.productoId) || "Producto",
        product_qty: l.cantidad,
        ...(campoUom ? { [campoUom]: await uomDe(l.productoId) } : {}),
        ...(l.costo !== undefined && l.costo !== null ? { price_unit: l.costo } : {}),
      },
    ]);
  }
  return comandos;
}

/**
 * Una compra: la orden de compra de Odoo (módulo Compras), con el proveedor, el
 * costo de cada producto y la guía o factura como referencia. Se confirma, y la
 * recepción que Odoo arma se recibe por completo, así el stock entra y la compra
 * queda "recibida". Devuelve el id de esa recepción (picking).
 *
 * Reintentar no duplica: la orden se busca por su origen. Una compra hecha antes
 * de que existiera esto (una recepción sin orden) se deja como está; para darle su
 * orden de compra está `npm run odoo:vincular-compras`.
 */
export async function ingresarCompra(c: Compra): Promise<number> {
  if (!c.almacen.recepcionId) throw new ErrorOdoo("El almacén no tiene operación de recepción en Odoo.");
  if (!(await hayCompras())) {
    throw new ErrorOdoo("Odoo no tiene instalada la app Compras. Instálala (Aplicaciones → Compras) y reintenta el ingreso.");
  }

  // Una recepción suelta con este origen es de una compra de antes: ya entró el stock.
  const suelto = await pickingPorOrigen(c.origen);
  if (suelto?.estado === "done") return suelto.id;
  if (suelto && suelto.estado !== "cancel") {
    throw new ErrorOdoo("Hay una recepción a medias de este ingreso en Odoo. Valídala o cancélala desde Odoo y reintenta.");
  }

  const [previa] = await ejecutar<Fila[]>("purchase.order", "search_read", [[["origin", "=", c.origen]]], {
    fields: ["state"],
    limit: 1,
  });
  if (previa && texto(previa.state) === "cancel") throw new ErrorOdoo("La orden de compra de este ingreso está cancelada en Odoo.");

  let ordenId = previa?.id as number | undefined;
  if (!ordenId) {
    const lineas = c.lineas.filter((l) => l.cantidad > 0);
    if (lineas.length === 0) throw new ErrorOdoo("La compra no tiene nada que recibir.");
    ordenId = await ejecutar<number>("purchase.order", "create", [
      {
        partner_id: c.proveedorId,
        origin: c.origen,
        picking_type_id: c.almacen.recepcionId,
        ...(c.documento ? { partner_ref: c.documento } : {}),
        order_line: await lineasDeCompra(lineas),
      },
    ]);
  }

  if (!previa || ["draft", "sent"].includes(texto(previa.state) ?? "")) {
    await ejecutar("purchase.order", "button_confirm", [[ordenId]]);
  }
  const [orden] = await ejecutar<Fila[]>("purchase.order", "read", [[ordenId]], { fields: ["state", "picking_ids"] });
  if (!["purchase", "done"].includes(texto(orden?.state) ?? "")) {
    throw new ErrorOdoo("La orden de compra espera aprobación en Odoo. Apruébala desde Compras y reintenta el ingreso.");
  }

  const recepciones = await ejecutar<Fila[]>("stock.picking", "read", [(orden.picking_ids as number[]) ?? []], { fields: ["state"] });
  const hecha = recepciones.find((r) => texto(r.state) === "done");
  const pendiente = recepciones.find((r) => !["done", "cancel"].includes(texto(r.state) ?? ""));
  if (!pendiente) {
    if (hecha) return hecha.id as number;
    throw new ErrorOdoo("Odoo no armó la recepción de esta compra. Revisa la orden en Compras.");
  }

  const movs = await ejecutar<Fila[]>("stock.move", "search_read", [[["picking_id", "=", pendiente.id]]], {
    fields: ["product_uom_qty"],
  });
  const cantidades = new Map<number, number>(movs.map((m) => [m.id as number, Number(m.product_uom_qty) || 0]));
  if (cantidades.size === 0) throw new ErrorOdoo("La compra no tiene nada que recibir.");
  await validarPicking(pendiente.id as number, cantidades);
  return pendiente.id as number;
}

/* ── Compras en dos pasos: la orden y, después, lo que llega ──────────────── */

export interface OrdenDeCompra {
  almacen: AlmacenOdoo;
  proveedorId: number;
  /** "App Plexiacril CMP-00001": reintentar no duplica. */
  origen: string;
  /** La proforma o cotización del proveedor. */
  documento: string | null;
  /** La moneda de los precios. PEN es la de la empresa: no se manda. */
  moneda: "PEN" | "USD";
  /** La llegada estimada (AAAA-MM-DD), si se sabe. */
  fechaPrevista: string | null;
  lineas: LineaDeIngreso[];
}

/** El id de una moneda activa en Odoo, o un error que dice cómo activarla. */
async function monedaId(codigo: string): Promise<number> {
  const [m] = await ejecutar<Fila[]>("res.currency", "search_read", [[["name", "=", codigo]]], {
    fields: ["active"],
    limit: 1,
    context: { active_test: false },
  });
  if (!m || m.active === false) {
    throw new ErrorOdoo(`La moneda ${codigo} no está activa en Odoo. Actívala en Contabilidad → Configuración → Monedas y reintenta.`);
  }
  return m.id as number;
}

/**
 * Soles por dólar según Odoo (la tasa vigente de `res.currency`), o `null` si no
 * hay tasa cargada. Odoo guarda `rate` como dólares por sol; desde la 14 también
 * `inverse_rate`, que es lo que se quiere.
 */
export async function tipoDeCambioUsd(): Promise<number | null> {
  const [m] = await ejecutar<Fila[]>("res.currency", "search_read", [[["name", "=", "USD"]]], {
    fields: await camposExistentes("res.currency", ["rate", "inverse_rate"]),
    limit: 1,
  });
  if (!m) return null;
  const inversa = Number(m.inverse_rate);
  const tasa = Number(m.rate);
  // Una tasa de exactamente 1 es la que Odoo pone cuando no hay ninguna cargada.
  const tc = inversa > 0 && inversa !== 1 ? inversa : tasa > 0 && tasa !== 1 ? 1 / tasa : null;
  return tc ? Math.round(tc * 10_000) / 10_000 : null;
}

/**
 * La orden de compra confirmada, SIN recibir: la mercadería todavía no llegó.
 * Odoo le arma su recepción, que Almacén valida después (`recibirOrdenCompra`).
 * Devuelve el id de la orden. Reintentar no duplica: se busca por el origen.
 */
export async function crearOrdenCompra(c: OrdenDeCompra): Promise<number> {
  if (!c.almacen.recepcionId) throw new ErrorOdoo("El almacén no tiene operación de recepción en Odoo.");
  if (!(await hayCompras())) {
    throw new ErrorOdoo("Odoo no tiene instalada la app Compras. Instálala (Aplicaciones → Compras) y reintenta.");
  }
  const [previa] = await ejecutar<Fila[]>("purchase.order", "search_read", [[["origin", "=", c.origen], ["state", "!=", "cancel"]]], {
    fields: ["state"],
    limit: 1,
  });

  let ordenId = previa?.id as number | undefined;
  if (!ordenId) {
    const lineas = c.lineas.filter((l) => l.cantidad > 0);
    if (lineas.length === 0) throw new ErrorOdoo("La compra no tiene nada que pedir.");
    const opcionales = await camposExistentes("purchase.order", ["currency_id", "date_planned"]);
    ordenId = await ejecutar<number>("purchase.order", "create", [
      {
        partner_id: c.proveedorId,
        origin: c.origen,
        picking_type_id: c.almacen.recepcionId,
        ...(c.documento ? { partner_ref: c.documento } : {}),
        ...(c.moneda !== "PEN" && opcionales.includes("currency_id") ? { currency_id: await monedaId(c.moneda) } : {}),
        ...(c.fechaPrevista && opcionales.includes("date_planned") ? { date_planned: `${c.fechaPrevista} 12:00:00` } : {}),
        order_line: await lineasDeCompra(lineas),
      },
    ]);
  }
  if (!previa || ["draft", "sent"].includes(texto(previa.state) ?? "")) {
    await ejecutar("purchase.order", "button_confirm", [[ordenId]]);
  }
  const [orden] = await ejecutar<Fila[]>("purchase.order", "read", [[ordenId]], { fields: ["state"] });
  if (!["purchase", "done"].includes(texto(orden?.state) ?? "")) {
    throw new ErrorOdoo("La orden de compra espera aprobación en Odoo. Apruébala desde Compras y reintenta.");
  }
  return ordenId;
}

/** Cancela una orden de compra que todavía no recibió nada (una compra anulada). */
export async function cancelarOrdenCompra(ordenId: number): Promise<void> {
  const [orden] = await ejecutar<Fila[]>("purchase.order", "read", [[ordenId]], { fields: ["state"] });
  if (!orden || texto(orden.state) === "cancel") return;
  await ejecutar("purchase.order", "button_cancel", [[ordenId]]);
}

export interface LineaRecibida {
  productoId: number;
  /** Lo que llega ahora. */
  cantidad: number;
  /** Lo que ya se había recibido de este producto en recepciones anteriores. */
  recibidoAntes: number;
}

/**
 * Recibe lo que llegó de una orden de compra, aunque sea una parte: lo que falta
 * queda en otra recepción (backorder) para la próxima vez. Devuelve el id de la
 * recepción validada.
 *
 * Reintentar no duplica: si Odoo ya tiene recibido lo de antes más lo de ahora,
 * no se vuelve a validar.
 */
export async function recibirOrdenCompra(ordenId: number, lineas: LineaRecibida[]): Promise<number> {
  const [orden] = await ejecutar<Fila[]>("purchase.order", "read", [[ordenId]], { fields: ["state", "picking_ids", "order_line"] });
  if (!orden) throw new ErrorOdoo("La orden de compra no existe en Odoo.");
  if (!["purchase", "done"].includes(texto(orden.state) ?? "")) {
    throw new ErrorOdoo("La orden de compra no está confirmada en Odoo.");
  }

  const lineasOdoo = await ejecutar<Fila[]>("purchase.order.line", "read", [(orden.order_line as number[]) ?? []], {
    fields: ["product_id", "qty_received"],
  });
  const recibidoOdoo = new Map<number, number>();
  for (const l of lineasOdoo) {
    const p = idDe(l.product_id);
    if (p) recibidoOdoo.set(p, (recibidoOdoo.get(p) ?? 0) + (Number(l.qty_received) || 0));
  }
  const recepciones = await ejecutar<Fila[]>("stock.picking", "read", [(orden.picking_ids as number[]) ?? []], {
    fields: ["state"],
  });
  const ultimaHecha = () =>
    recepciones.filter((r) => texto(r.state) === "done").reduce((m, r) => Math.max(m, r.id as number), 0);

  const llegan = lineas.filter((l) => l.cantidad > 0);
  if (llegan.length === 0) throw new ErrorOdoo("No hay nada que recibir.");
  const yaEstaba = llegan.every((l) => (recibidoOdoo.get(l.productoId) ?? 0) >= l.recibidoAntes + l.cantidad);
  if (yaEstaba && ultimaHecha()) return ultimaHecha();
  const aMedias = llegan.some((l) => (recibidoOdoo.get(l.productoId) ?? 0) > l.recibidoAntes);
  if (aMedias) {
    throw new ErrorOdoo("En Odoo esta orden tiene recibido más de lo que la app sabe. Revisa sus recepciones en Odoo.");
  }

  const pendiente = recepciones.find((r) => !["done", "cancel"].includes(texto(r.state) ?? ""));
  if (!pendiente) throw new ErrorOdoo("La orden de compra no tiene recepción pendiente en Odoo.");
  const movs = await ejecutar<Fila[]>("stock.move", "search_read", [[["picking_id", "=", pendiente.id], ["state", "!=", "cancel"]]], {
    fields: ["product_id", "product_uom_qty"],
  });
  const porProducto = new Map(llegan.map((l) => [l.productoId, l.cantidad]));
  const cantidades = new Map<number, number>();
  let completa = true;
  for (const m of movs) {
    const p = idDe(m.product_id) ?? 0;
    const pedido = Number(m.product_uom_qty) || 0;
    const llega = Math.min(porProducto.get(p) ?? 0, pedido);
    porProducto.delete(p);
    cantidades.set(m.id as number, llega);
    if (llega < pedido) completa = false;
  }
  if (porProducto.size) throw new ErrorOdoo("Llegó un producto que la recepción de Odoo no espera.");
  if (![...cantidades.values()].some((c) => c > 0)) throw new ErrorOdoo("No hay nada que recibir.");

  const id = pendiente.id as number;
  if (completa) {
    await validarPicking(id, cantidades);
    return id;
  }
  // Una parte: Odoo pide qué hacer con el resto. Se le dice que quede pendiente.
  await ejecutar("stock.picking", "action_confirm", [[id]]);
  const { picked, campoMov } = await campoCantidad();
  for (const [moveId, cantidad] of cantidades) {
    await ejecutar("stock.move", "write", [[moveId], { [campoMov]: cantidad, ...(picked ? { picked: cantidad > 0 } : {}) }]);
  }
  const r = await ejecutar<Fila | boolean>("stock.picking", "button_validate", [[id]], { context: { skip_immediate: true, skip_sms: true } });
  if (esAsistente(r)) {
    const accion = r as Fila;
    if (texto(accion.res_model) !== "stock.backorder.confirmation") {
      throw new ErrorOdoo("Odoo pidió confirmar algo más para validar la recepción. Valídala desde Odoo.");
    }
    const contexto = { ...((accion.context as Fila | undefined) ?? {}), button_validate_picking_ids: [id] };
    const asistente = await ejecutar<number>("stock.backorder.confirmation", "create", [{ pick_ids: [[6, 0, [id]]] }], { context: contexto });
    const r2 = await ejecutar("stock.backorder.confirmation", "process", [[asistente]], { context: contexto });
    if (esAsistente(r2)) throw new ErrorOdoo("Odoo pidió confirmar algo más para validar la recepción. Valídala desde Odoo.");
  }
  return id;
}

/* ── Lo vendido en un período ──────────────────────────────────────────────── */

/**
 * Cuánto salió de cada producto hacia clientes entre `desde` (incluido) y
 * `hasta` (excluido), menos lo que los clientes devolvieron. Es la cantidad del
 * costo de ventas de un mes. Las fechas van como "AAAA-MM-DD HH:MM:SS" (UTC).
 */
export async function salidasAClientes(desde: string, hasta: string): Promise<Map<number, number>> {
  const { campoMov } = await campoCantidad();
  const leer = (lado: "location_dest_id" | "location_id") =>
    ejecutar<Fila[]>(
      "stock.move",
      "search_read",
      [[["state", "=", "done"], [`${lado}.usage`, "=", "customer"], ["date", ">=", desde], ["date", "<", hasta]]],
      { fields: ["product_id", campoMov] },
    );
  const [salen, vuelven] = await Promise.all([leer("location_dest_id"), leer("location_id")]);
  const neto = new Map<number, number>();
  for (const [lista, signo] of [[salen, 1], [vuelven, -1]] as const) {
    for (const m of lista) {
      const p = idDe(m.product_id);
      if (p) neto.set(p, (neto.get(p) ?? 0) + signo * (Number(m[campoMov]) || 0));
    }
  }
  for (const [p, q] of neto) if (q <= 0) neto.delete(p);
  return neto;
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

/* ── Pasar de un almacén a otro ────────────────────────────────────────────── */

const TRANSITO = "Tránsito Plexiacril";

/**
 * La ubicación donde está lo que va de un almacén a otro. Es de tránsito: no
 * pertenece a ningún almacén, así que lo que está ahí no cuenta en el stock de
 * ninguno hasta que se recibe. Si no existe, se crea.
 */
export async function asegurarTransito(): Promise<number> {
  const [id] = await ejecutar<number[]>("stock.location", "search", [[["usage", "=", "transit"], ["name", "=", TRANSITO]]], {
    limit: 1,
  });
  if (id) return id;
  return ejecutar<number>("stock.location", "create", [{ name: TRANSITO, usage: "transit" }]);
}

export interface LineaDeTransferencia {
  productoId: number;
  cantidad: number;
  /** Un sobrante: se mueve su lote (cantidad 1). */
  loteId?: number | null;
}

export interface Movimiento {
  /** El tipo de operación: la transferencia interna del almacén que hace el movimiento. */
  tipoOperacion: number | null;
  desde: number;
  hacia: number;
  /** "App Plexiacril TRF-00001 envío". Reintentar no duplica. */
  origen: string;
  lineas: LineaDeTransferencia[];
}

/**
 * Mueve productos (y lotes) entre dos ubicaciones con una transferencia interna
 * validada. Devuelve el id del picking. Se puede repetir por su origen.
 */
export async function moverEntreUbicaciones(m: Movimiento): Promise<number> {
  if (!m.tipoOperacion) throw new ErrorOdoo("El almacén no tiene operación de transferencia interna en Odoo.");
  const previo = await pickingPorOrigen(m.origen);
  if (previo?.estado === "done") return previo.id;
  if (previo) throw new ErrorOdoo(`La operación ${m.origen} quedó a medias en Odoo. Termínala o cancélala desde Odoo.`);
  const lineas = m.lineas.filter((x) => x.cantidad > 0);
  if (lineas.length === 0) throw new ErrorOdoo("No hay nada que mover.");

  const pickingId = await ejecutar<number>("stock.picking", "create", [
    { picking_type_id: m.tipoOperacion, origin: m.origen, location_id: m.desde, location_dest_id: m.hacia },
  ]);
  const cantidades = new Map<number, number>();
  const lotes: MovimientoDeLote[] = [];
  for (const l of lineas) {
    const id = await moverDentro(pickingId, m.desde, m.hacia, { productoId: l.productoId, cantidad: l.cantidad }, "Transferencia");
    if (l.loteId) lotes.push({ moveId: id, productoId: l.productoId, loteId: l.loteId, desde: m.desde, hacia: m.hacia });
    else cantidades.set(id, l.cantidad);
  }
  await validarPicking(pickingId, cantidades, lotes);
  return pickingId;
}

export interface Transferencia {
  desde: AlmacenOdoo;
  hacia: AlmacenOdoo;
  /** "App Plexiacril TRF-00001". */
  origen: string;
  lineas: LineaDeTransferencia[];
}

/** El primer paso: sale del almacén de origen y queda en tránsito. */
export async function enviarATransito(t: Transferencia): Promise<number> {
  return moverEntreUbicaciones({
    tipoOperacion: t.desde.internoId,
    desde: t.desde.ubicacionId,
    hacia: await asegurarTransito(),
    origen: `${t.origen} envío`,
    lineas: t.lineas,
  });
}

/** El segundo paso: llega del tránsito al almacén de destino. */
export async function recibirDeTransito(t: Transferencia): Promise<number> {
  return moverEntreUbicaciones({
    tipoOperacion: t.hacia.internoId,
    desde: await asegurarTransito(),
    hacia: t.hacia.ubicacionId,
    origen: `${t.origen} recepción`,
    lineas: t.lineas,
  });
}

/* ── Sacar stock: bajas y diferencias ──────────────────────────────────────── */

export interface Baja {
  ubicacionId: number;
  productoId: number;
  cantidad: number;
  /** Un sobrante: su lote. */
  loteId?: number | null;
  /** "App Plexiacril CAS-00001": reintentar no duplica. */
  origen: string;
}

/**
 * Da de baja: un desecho (`stock.scrap`) validado, desde la ubicación del
 * almacén. Devuelve su id. Si ya hay uno hecho con ese origen, es ese.
 */
export async function darDeBaja(b: Baja): Promise<number> {
  const [previo] = await ejecutar<Fila[]>("stock.scrap", "search_read", [[["origin", "=", b.origen]]], {
    fields: ["state"],
    limit: 1,
  });
  if (previo && texto(previo.state) === "done") return previo.id as number;

  const id =
    (previo?.id as number | undefined) ??
    (await ejecutar<number>("stock.scrap", "create", [
      {
        product_id: b.productoId,
        scrap_qty: b.cantidad,
        // Obligatorio en Odoo: sin la unidad, el desecho no se crea.
        product_uom_id: await uomDe(b.productoId),
        location_id: b.ubicacionId,
        origin: b.origen,
        ...(b.loteId ? { lot_id: b.loteId } : {}),
      },
    ]));
  const r = await ejecutar("stock.scrap", "action_validate", [[id]]);
  if (esAsistente(r)) {
    throw new ErrorOdoo("En Odoo no hay suficiente stock de eso en ese almacén para darlo de baja. Revisa el stock antes de cerrar el caso.");
  }
  return id;
}

/** La ubicación virtual de los ajustes de inventario (de donde sale lo que sobra y a donde va lo que falta). */
async function ubicacionDeAjustes(): Promise<number> {
  const [id] = await ejecutar<number[]>("stock.location", "search", [[["usage", "=", "inventory"]]], { limit: 1 });
  if (!id) throw new ErrorOdoo("Odoo no tiene la ubicación de ajustes de inventario.");
  return id;
}

export interface Diferencia {
  almacen: AlmacenOdoo;
  productoId: number;
  /** Lo que se suma (positivo) o se quita (negativo). */
  delta: number;
  loteId?: number | null;
  origen: string;
}

/**
 * Aplica una diferencia de conteo: suma o quita `delta` en el almacén, sin
 * importar lo que se movió desde que se contó (una venta en medio no se pisa).
 * Es una transferencia interna desde o hacia la ubicación de ajustes, con su
 * origen: queda en el kárdex con el código del caso y reintentar no duplica.
 * Devuelve el id del picking.
 */
export async function ajustarPorDiferencia(d: Diferencia): Promise<number> {
  if (d.delta === 0) throw new ErrorOdoo("No hay diferencia que aplicar.");
  const ajustes = await ubicacionDeAjustes();
  const sobra = d.delta > 0;
  return moverEntreUbicaciones({
    tipoOperacion: d.almacen.internoId,
    desde: sobra ? ajustes : d.almacen.ubicacionId,
    hacia: sobra ? d.almacen.ubicacionId : ajustes,
    origen: d.origen,
    lineas: [{ productoId: d.productoId, cantidad: Math.abs(d.delta), loteId: d.loteId ?? null }],
  });
}

/* ── El kárdex ─────────────────────────────────────────────────────────────── */

export interface MovimientoOdoo {
  id: number;
  fecha: string;
  cantidad: number;
  desde: number | null;
  hacia: number | null;
  loteId: number | null;
  /** "WH/OUT/00012", "SP/00003", "Cantidad de producto actualizada". */
  referencia: string | null;
  /** El origen del movimiento: "App Plexiacril ING-00001", "S00042"… */
  origen: string | null;
  baja: boolean;
  inventario: boolean;
  /** Si es de una orden de fabricación: su origen (la cotización y la línea). */
  origenProduccion: string | null;
}

/**
 * Los movimientos hechos de un producto que entran o salen de unas ubicaciones
 * (y sus hijas), del más nuevo al más viejo. Con `loteId`, solo los de ese lote.
 */
export async function movimientosDeProducto(f: {
  productoId: number;
  ubicaciones: number[];
  desde?: string | null;
  loteId?: number | null;
  limite?: number;
}): Promise<MovimientoOdoo[]> {
  if (f.ubicaciones.length === 0) return [];
  const { campoLinea } = await campoCantidad();
  const dominio: unknown[] = [
    ["product_id", "=", f.productoId],
    ["state", "=", "done"],
    "|",
    ["location_id", "child_of", f.ubicaciones],
    ["location_dest_id", "child_of", f.ubicaciones],
  ];
  if (f.loteId) dominio.push(["lot_id", "=", f.loteId]);
  if (f.desde) dominio.push(["date", ">=", f.desde]);
  const lineas = await ejecutar<Fila[]>("stock.move.line", "search_read", [dominio], {
    fields: ["date", campoLinea, "location_id", "location_dest_id", "lot_id", "reference", "move_id"],
    order: "date desc, id desc",
    limit: f.limite ?? 500,
  });

  const moveIds = [...new Set(lineas.map((l) => idDe(l.move_id)).filter((x): x is number => !!x))];
  const camposMov = await camposExistentes("stock.move", ["origin", "scrapped", "is_inventory", "raw_material_production_id", "production_id"]);
  const movs = moveIds.length ? await ejecutar<Fila[]>("stock.move", "read", [moveIds], { fields: camposMov }) : [];
  const deMov = new Map(movs.map((m) => [m.id as number, m]));
  const producciones = [
    ...new Set(movs.flatMap((m) => [idDe(m.raw_material_production_id), idDe(m.production_id)]).filter((x): x is number => !!x)),
  ];
  const origenesMo = producciones.length
    ? new Map(
        (await ejecutar<Fila[]>("mrp.production", "read", [producciones], { fields: ["origin"] })).map((p) => [
          p.id as number,
          texto(p.origin),
        ]),
      )
    : new Map<number, string | null>();

  return lineas
    .map((l): MovimientoOdoo => {
      const m = deMov.get(idDe(l.move_id) ?? 0);
      const mo = m ? (idDe(m.raw_material_production_id) ?? idDe(m.production_id)) : null;
      return {
        id: l.id as number,
        fecha: texto(l.date) ?? "",
        cantidad: numero(l[campoLinea]),
        desde: idDe(l.location_id),
        hacia: idDe(l.location_dest_id),
        loteId: idDe(l.lot_id),
        referencia: texto(l.reference),
        origen: m ? texto(m.origin) : null,
        baja: m?.scrapped === true,
        inventario: m?.is_inventory === true,
        origenProduccion: mo ? (origenesMo.get(mo) ?? null) : null,
      };
    })
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id);
}
