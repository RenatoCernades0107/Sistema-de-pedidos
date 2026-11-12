/**
 * La producción de un corte en Odoo, para los materiales con el piloto de
 * sobrantes encendido.
 *
 * Sin piloto, un corte se vende como planchas y al terminar se entregan las
 * planchas. Con piloto, el corte es un producto en sí, "Corte a medida" de su
 * material, en m², que se fabrica:
 *
 *   orden de fabricación (sin lista de materiales: la arma la app, pieza por pieza)
 *     consume   las planchas nuevas del formato
 *     produce   el corte a medida, en m² de piezas
 *     y además  un sobrante por cada pedazo que vuelve al almacén, cada uno su
 *               propio lote con largo y ancho
 *
 * La orden se crea y se confirma con el pedido (eso reserva las planchas); se
 * cierra al pasar a Listo, con lo que el taller confirma que usó y que guardó.
 * Después, la entrega de la venta saca el corte a medida.
 *
 * Lo que cambia entre versiones y aquí se detecta: la cantidad hecha de un
 * movimiento (`quantity` + `picked` desde la 17, `quantity_done` / `qty_done`
 * antes), si el movimiento lleva `name` y si los subproductos tienen
 * `cost_share`.
 */

import {
  asegurarCamposDeLote,
  esConocimientoViejo,
  modeloDeLote,
  olvidarSobrantes,
  productoSobrante,
  type MaterialDeSobrante,
} from "./sobrantes";
import { camposExistentes, ejecutar, ErrorOdoo, registrarReinicio, texto } from "./rpc";

type Fila = Record<string, unknown>;

export const PREFIJO_CORTE = "CAM-";

/* ── Lo que se aprende de este Odoo ────────────────────────────────────────── */

let uomM2: Promise<number> | null = null;
let ubicacionProduccion: Promise<number> | null = null;
let ubicacionStock: Promise<number> | null = null;
const productosCorte = new Map<string, Promise<number>>();

function olvidarTodo() {
  uomM2 = null;
  ubicacionProduccion = null;
  ubicacionStock = null;
  productosCorte.clear();
}

registrarReinicio(olvidarTodo);

/** Como en los sobrantes: si Odoo dice que algo ya no existe, se olvida lo aprendido y se reintenta una vez. */
async function alDia<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!esConocimientoViejo(e)) throw e;
    olvidarTodo();
    olvidarSobrantes();
    return fn();
  }
}

function recordar<T>(p: Promise<T>, olvidar: () => void): Promise<T> {
  p.catch(olvidar);
  return p;
}

/** La unidad m² de Odoo (en la categoría de superficie). */
export function unidadM2(): Promise<number> {
  uomM2 ??= recordar(
    (async () => {
      const [id] = await ejecutar<number[]>("uom.uom", "search", [[["name", "in", ["m²", "m2", "M2", "m^2"]]]], {
        limit: 1,
      });
      if (!id) {
        throw new ErrorOdoo(
          "Odoo no tiene la unidad m². Actívala en Inventario → Configuración → Unidades de medida.",
        );
      }
      return id;
    })(),
    () => (uomM2 = null),
  );
  return uomM2;
}

async function ubicacionDe(uso: "production" | "internal"): Promise<number> {
  if (uso === "internal") {
    const almacenes = await ejecutar<Fila[]>("stock.warehouse", "search_read", [[]], {
      fields: ["lot_stock_id"],
      limit: 1,
    });
    const id = Array.isArray(almacenes[0]?.lot_stock_id) ? (almacenes[0].lot_stock_id as [number])[0] : null;
    if (id) return id;
  }
  const [id] = await ejecutar<number[]>("stock.location", "search", [[["usage", "=", uso]]], { limit: 1 });
  if (!id) throw new ErrorOdoo(`Odoo no tiene una ubicación de ${uso === "production" ? "producción" : "stock"}.`);
  return id;
}

const produccion = () =>
  (ubicacionProduccion ??= recordar(ubicacionDe("production"), () => (ubicacionProduccion = null)));
const stock = () => (ubicacionStock ??= recordar(ubicacionDe("internal"), () => (ubicacionStock = null)));

async function valoresAlmacenable(): Promise<Record<string, unknown>> {
  const [storable, detailed] = await Promise.all([
    camposExistentes("product.template", ["is_storable"]),
    camposExistentes("product.template", ["detailed_type"]),
  ]);
  if (storable.length) return { type: "consu", is_storable: true };
  if (detailed.length) return { detailed_type: "product" };
  return { type: "product" };
}

/**
 * El producto "Corte a medida" de un material: almacenable, en m², vendible.
 * Su código es el de la plancha de referencia: CAM-F7E024.
 */
export function productoCorte(m: MaterialDeSobrante): Promise<number> {
  const codigo = `${PREFIJO_CORTE}${m.codigoBase}`;
  let p = productosCorte.get(codigo);
  if (!p) {
    p = recordar(
      (async () => {
        const buscar = () =>
          ejecutar<number[]>("product.product", "search", [[["default_code", "=", codigo]]], { limit: 1 });
        const [existente] = await buscar();
        if (existente) return existente;
        const uom = await unidadM2();
        const conCompra = (await camposExistentes("product.template", ["uom_po_id"])).length > 0;
        await ejecutar("product.template", "create", [
          {
            name: m.nombre.replace(/^SOBRANTE /, "CORTE A MEDIDA "),
            default_code: codigo,
            sale_ok: true,
            purchase_ok: false,
            uom_id: uom,
            ...(conCompra ? { uom_po_id: uom } : {}),
            ...(await valoresAlmacenable()),
          },
        ]);
        const [creado] = await buscar();
        if (!creado) throw new ErrorOdoo("Odoo creó el producto Corte a medida pero no lo devolvió.");
        return creado;
      })(),
      () => productosCorte.delete(codigo),
    );
    productosCorte.set(codigo, p);
  }
  return p;
}

/* ── La orden de fabricación ───────────────────────────────────────────────── */

export interface ProduccionNueva {
  /** Lo que la identifica para no duplicarla: "App Plexiacril <cotización> #<posición>". */
  origen: string;
  material: MaterialDeSobrante;
  /** m² de piezas: lo que se vende. */
  areaM2: number;
  /** La plancha del formato elegido (`product.product`) y cuántas nuevas se abren. */
  planchaId: number;
  planchas: number;
  /** Cuántos sobrantes se prevé que vuelvan al almacén, y su área (para repartir el costo). */
  sobrantesPrevistos: { areaM2: number }[];
  /** Los lotes de los sobrantes del almacén que el corte consume. */
  consumidos?: number[];
}

export interface ProduccionCreada {
  id: number;
  nombre: string;
}

/** Los valores de un movimiento: con `name` solo si esta versión lo pide. */
async function movimiento(v: Record<string, unknown>, nombre: string) {
  const conNombre = (await camposExistentes("stock.move", ["name"])).length > 0;
  return conNombre ? { name: nombre, ...v } : v;
}

/**
 * Crea y confirma la orden de fabricación de un corte. Se puede repetir: si ya
 * hay una con ese origen, la devuelve (y la confirma si había quedado en
 * borrador).
 */
export function crearProduccion(p: ProduccionNueva): Promise<ProduccionCreada> {
  return alDia(() => crear(p));
}

async function crear(p: ProduccionNueva): Promise<ProduccionCreada> {
  const previas = await ejecutar<Fila[]>("mrp.production", "search_read", [[["origin", "=", p.origen]]], {
    fields: ["name", "state"],
    limit: 1,
  });
  if (previas[0]) {
    if (previas[0].state === "draft") await ejecutar("mrp.production", "action_confirm", [[previas[0].id]]);
    return { id: previas[0].id as number, nombre: texto(previas[0].name) ?? `#${previas[0].id}` };
  }

  await asegurarCamposDeLote();
  const [corteId, sobranteId, uom, origenProduccion, destinoStock, conCosto] = await Promise.all([
    productoCorte(p.material),
    productoSobrante(p.material),
    unidadM2(),
    produccion(),
    stock(),
    camposExistentes("stock.move", ["cost_share"]).then((c) => c.length > 0),
  ]);
  const planchaUom = await uomDe(p.planchaId);
  const sobranteUom = await uomDe(sobranteId);

  /* El costo de las planchas se reparte por área entre lo vendido y lo que
     vuelve al almacén: un sobrante no es gratis, se lleva su parte. */
  const areaSobrantes = p.sobrantesPrevistos.reduce((s, x) => s + x.areaM2, 0);
  const total = p.areaM2 + areaSobrantes;
  const parteSobrantes = total > 0 ? Math.round((areaSobrantes / total) * 10000) / 100 : 0;

  const crudo = await movimiento(
    {
      product_id: p.planchaId,
      product_uom_qty: p.planchas,
      product_uom: planchaUom,
      location_id: destinoStock,
      location_dest_id: origenProduccion,
    },
    "Planchas del corte",
  );
  const subproductos = p.sobrantesPrevistos.length
    ? [
        [
          0,
          0,
          await movimiento(
            {
              product_id: sobranteId,
              product_uom_qty: p.sobrantesPrevistos.length,
              product_uom: sobranteUom,
              location_id: origenProduccion,
              location_dest_id: destinoStock,
              ...(conCosto ? { cost_share: parteSobrantes } : {}),
            },
            "Sobrantes del corte",
          ),
        ],
      ]
    : [];

  // Los sobrantes del almacén que se usan: un componente más, uno por lote.
  const consumidos = p.consumidos ?? [];
  const crudoSobrantes = consumidos.length
    ? [
        [
          0,
          0,
          await movimiento(
            {
              product_id: sobranteId,
              product_uom_qty: consumidos.length,
              product_uom: sobranteUom,
              location_id: destinoStock,
              location_dest_id: origenProduccion,
            },
            "Sobrantes que usa el corte",
          ),
        ],
      ]
    : [];

  const id = await ejecutar<number>("mrp.production", "create", [
    {
      product_id: corteId,
      product_qty: Math.round(p.areaM2 * 10000) / 10000,
      product_uom_id: uom,
      origin: p.origen,
      location_src_id: destinoStock,
      location_dest_id: destinoStock,
      move_raw_ids: [...(p.planchas > 0 ? [[0, 0, crudo]] : []), ...crudoSobrantes],
      ...(subproductos.length ? { move_byproduct_ids: subproductos } : {}),
    },
  ]);
  await ejecutar("mrp.production", "action_confirm", [[id]]);
  const [leida] = await ejecutar<Fila[]>("mrp.production", "read", [[id]], { fields: ["name"] });
  return { id, nombre: texto(leida?.name) ?? `#${id}` };
}

async function uomDe(productoId: number): Promise<number> {
  const [f] = await ejecutar<Fila[]>("product.product", "read", [[productoId]], { fields: ["uom_id"] });
  const uom = Array.isArray(f?.uom_id) ? (f.uom_id as [number])[0] : null;
  if (!uom) throw new ErrorOdoo("No se pudo leer la unidad de un producto en Odoo.");
  return uom;
}

export interface SobranteReal {
  /** El nombre del lote: SOB-00042. */
  nombre: string;
  largo: number;
  ancho: number;
  nota: string | null;
}

export interface Cierre {
  /** El material: hace falta si hay que agregar el subproducto que no se previó. */
  material: MaterialDeSobrante;
  /** Las planchas nuevas que de verdad se usaron. */
  planchas: number;
  /** Los lotes de los sobrantes del almacén que se consumieron. */
  consumidos?: number[];
  /** Los pedazos que de verdad se guardaron, con su medida real. */
  sobrantes: SobranteReal[];
}

/**
 * Cierra la orden con lo real: las planchas consumidas, los m² producidos y un
 * lote por sobrante guardado. Devuelve el id del lote de cada sobrante. Se puede
 * repetir: una orden ya cerrada no se toca, y solo se devuelven sus lotes.
 */
export function cerrarProduccion(id: number, c: Cierre): Promise<Map<string, number>> {
  return alDia(() => cerrar(id, c));
}

async function cerrar(id: number, c: Cierre): Promise<Map<string, number>> {
  const [mo] = await ejecutar<Fila[]>("mrp.production", "read", [[id]], {
    fields: ["state", "product_qty", "move_raw_ids", "move_byproduct_ids"],
  });
  if (!mo) throw new ErrorOdoo("La orden de fabricación ya no existe en Odoo.");
  const estado = texto(mo.state);
  if (estado === "cancel") throw new ErrorOdoo("La orden de fabricación está cancelada en Odoo.");

  await asegurarCamposDeLote();
  const modeloLote = await modeloDeLote();
  const lotes = new Map<string, number>();

  const sobranteId = await productoSobrante(c.material);
  const leerSubproductos = async () => {
    const [actual] = await ejecutar<Fila[]>("mrp.production", "read", [[id]], { fields: ["move_byproduct_ids"] });
    const ids = (actual?.move_byproduct_ids as number[]) ?? [];
    const movs = ids.length
      ? await ejecutar<Fila[]>("stock.move", "read", [ids], { fields: ["product_id", "location_id", "location_dest_id"] })
      : [];
    return movs.filter((m) => Array.isArray(m.product_id) && (m.product_id as [number])[0] === sobranteId);
  };
  let movsSub = estado === "done" ? [] : await leerSubproductos();

  /* Quedó un pedazo que el cálculo no previó: se agrega el subproducto a la
     orden, que todavía está abierta. */
  if (estado !== "done" && c.sobrantes.length && movsSub.length === 0) {
    const [desde, hacia, uom] = await Promise.all([produccion(), stock(), uomDe(sobranteId)]);
    await ejecutar("mrp.production", "write", [
      [id],
      {
        move_byproduct_ids: [
          [
            0,
            0,
            await movimiento(
              { product_id: sobranteId, product_uom_qty: c.sobrantes.length, product_uom: uom, location_id: desde, location_dest_id: hacia },
              "Sobrantes del corte",
            ),
          ],
        ],
      },
    ]);
    movsSub = await leerSubproductos();
  }

  // Los lotes primero, con sus medidas: así la línea del movimiento solo los nombra.
  for (const s of c.sobrantes) {
    const [previo] = await ejecutar<number[]>(
      modeloLote,
      "search",
      [[["name", "=", s.nombre], ["product_id", "=", sobranteId]]],
      { limit: 1 },
    );
    const valores = { x_largo: s.largo, x_ancho: s.ancho, ...(s.nota ? { note: s.nota } : {}) };
    if (previo) {
      await ejecutar(modeloLote, "write", [[previo], valores]);
      lotes.set(s.nombre, previo);
    } else {
      lotes.set(s.nombre, await ejecutar<number>(modeloLote, "create", [{ name: s.nombre, product_id: sobranteId, ...valores }]));
    }
  }
  if (estado === "done") return lotes;

  const [picked, nuevo] = await Promise.all([
    camposExistentes("stock.move", ["picked"]).then((x) => x.length > 0),
    camposExistentes("stock.move.line", ["quantity"]).then((x) => x.length > 0),
  ]);
  const campoMov = picked ? "quantity" : "quantity_done";
  const campoLinea = nuevo ? "quantity" : "qty_done";

  // Lo consumido: las planchas nuevas por cantidad, y los sobrantes lote por lote.
  const crudos = ((mo.move_raw_ids as number[]) ?? []).length
    ? await ejecutar<Fila[]>("stock.move", "read", [mo.move_raw_ids as number[]], {
        fields: ["product_id", "location_id", "location_dest_id"],
      })
    : [];
  const consumidos = c.consumidos ?? [];
  for (const m of crudos) {
    const producto = Array.isArray(m.product_id) ? (m.product_id as [number])[0] : null;
    if (producto !== sobranteId) {
      await ejecutar("stock.move", "write", [[m.id], { [campoMov]: c.planchas, ...(picked ? { picked: c.planchas > 0 } : {}) }]);
      continue;
    }
    const desde = Array.isArray(m.location_id) ? (m.location_id as [number])[0] : null;
    const hacia = Array.isArray(m.location_dest_id) ? (m.location_dest_id as [number])[0] : null;
    for (const lote of consumidos) {
      await ejecutar("stock.move.line", "create", [
        {
          move_id: m.id,
          product_id: sobranteId,
          lot_id: lote,
          location_id: desde,
          location_dest_id: hacia,
          [campoLinea]: 1,
          ...(picked ? { picked: true } : {}),
        },
      ]);
    }
    if (picked) await ejecutar("stock.move", "write", [[m.id], { picked: consumidos.length > 0 }]);
  }

  // Lo producido: los m² de la orden, y una línea por sobrante con su lote.
  await ejecutar("mrp.production", "write", [[id], { qty_producing: mo.product_qty }]);
  const sub = movsSub[0];
  if (sub) {
    const desde = Array.isArray(sub.location_id) ? (sub.location_id as [number])[0] : null;
    const hacia = Array.isArray(sub.location_dest_id) ? (sub.location_dest_id as [number])[0] : null;
    for (const s of c.sobrantes) {
      await ejecutar("stock.move.line", "create", [
        {
          move_id: sub.id,
          product_id: sobranteId,
          lot_id: lotes.get(s.nombre),
          location_id: desde,
          location_dest_id: hacia,
          [campoLinea]: 1,
          ...(picked ? { picked: true } : {}),
        },
      ]);
    }
    if (picked) await ejecutar("stock.move", "write", [[sub.id], { picked: c.sobrantes.length > 0 }]);
  }

  const r = await ejecutar("mrp.production", "button_mark_done", [[id]], {
    context: { skip_consumption: true, skip_backorder: true, mo_ids_to_backorder: [], skip_immediate: true },
  });
  if (typeof r === "object" && r !== null && "res_model" in r) {
    throw new ErrorOdoo("Odoo pidió confirmar algo más para cerrar la orden de fabricación. Ciérrala desde Odoo.");
  }
  return lotes;
}

/** Cancela la orden de un pedido anulado. Se puede repetir. */
export async function cancelarProduccion(id: number): Promise<void> {
  const [mo] = await ejecutar<Fila[]>("mrp.production", "read", [[id]], { fields: ["state"] });
  const estado = texto(mo?.state);
  if (!estado || estado === "cancel") return;
  if (estado === "done") throw new ErrorOdoo("La orden de fabricación ya se cerró: deshacerla se hace en Odoo.");
  await ejecutar("mrp.production", "action_cancel", [[id]]);
}

/* ── Productos terminados ──────────────────────────────────────────────────── */

/** El producto de Odoo de los personalizados: no tienen código de catálogo. */
export const CODIGO_PERSONALIZADO = "PT-PERSONALIZADO";
export const NOMBRE_PERSONALIZADO = "PRODUCTO TERMINADO PERSONALIZADO";

const productosTerminados = new Map<string, Promise<number>>();
registrarReinicio(() => productosTerminados.clear());

/**
 * El producto de Odoo con el que se vende un producto terminado: uno por
 * producto del catálogo, con su mismo código (CAJ-001), y uno genérico para los
 * personalizados. Almacenable y vendible, en unidades; si no existe, se crea.
 */
export function productoTerminado(codigo: string, nombre: string): Promise<number> {
  let p = productosTerminados.get(codigo);
  if (!p) {
    p = recordar(
      (async () => {
        const buscar = () =>
          ejecutar<number[]>("product.product", "search", [[["default_code", "=", codigo]]], { limit: 1 });
        const [existente] = await buscar();
        if (existente) return existente;
        await ejecutar("product.template", "create", [
          {
            name: nombre.toUpperCase(),
            default_code: codigo,
            sale_ok: true,
            purchase_ok: false,
            ...(await valoresAlmacenable()),
          },
        ]);
        const [creado] = await buscar();
        if (!creado) throw new ErrorOdoo(`Odoo creó el producto ${codigo} pero no lo devolvió.`);
        return creado;
      })(),
      () => productosTerminados.delete(codigo),
    );
    productosTerminados.set(codigo, p);
  }
  return p;
}

export interface Componente {
  productoId: number;
  cantidad: number;
}

export interface FabricacionNueva {
  /** Lo que la identifica para no duplicarla: "App Plexiacril <cotización> #<posición>". */
  origen: string;
  /** El producto terminado (`product.product`) y cuántas unidades. */
  productoId: number;
  cantidad: number;
  /** Lo que se prevé consumir: es lo que la orden reserva al confirmarse. */
  componentes: Componente[];
}

async function movimientoCrudo(c: Componente, desde: number, hacia: number) {
  return movimiento(
    {
      product_id: c.productoId,
      product_uom_qty: c.cantidad,
      product_uom: await uomDe(c.productoId),
      location_id: desde,
      location_dest_id: hacia,
    },
    "Material del producto terminado",
  );
}

/**
 * Crea y confirma la orden de fabricación de un producto terminado, con los
 * materiales que se le pasen (sin lista de materiales: la arma la app). Se puede
 * repetir: si ya hay una con ese origen, la devuelve.
 */
export function crearFabricacion(p: FabricacionNueva): Promise<ProduccionCreada> {
  return alDia(async () => {
    const previas = await ejecutar<Fila[]>("mrp.production", "search_read", [[["origin", "=", p.origen]]], {
      fields: ["name", "state"],
      limit: 1,
    });
    if (previas[0]) {
      if (previas[0].state === "draft") await ejecutar("mrp.production", "action_confirm", [[previas[0].id]]);
      return { id: previas[0].id as number, nombre: texto(previas[0].name) ?? `#${previas[0].id}` };
    }

    const [aProduccion, deStock, uom] = await Promise.all([produccion(), stock(), uomDe(p.productoId)]);
    const crudos = [];
    for (const c of p.componentes) {
      if (c.cantidad > 0) crudos.push([0, 0, await movimientoCrudo(c, deStock, aProduccion)]);
    }

    const id = await ejecutar<number>("mrp.production", "create", [
      {
        product_id: p.productoId,
        product_qty: p.cantidad,
        product_uom_id: uom,
        origin: p.origen,
        location_src_id: deStock,
        location_dest_id: deStock,
        move_raw_ids: crudos,
      },
    ]);
    await ejecutar("mrp.production", "action_confirm", [[id]]);
    const [leida] = await ejecutar<Fila[]>("mrp.production", "read", [[id]], { fields: ["name"] });
    return { id, nombre: texto(leida?.name) ?? `#${id}` };
  });
}

/**
 * Cierra la orden de un producto terminado con lo que de verdad se usó: cada
 * material consume su cantidad real, lo previsto que no se usó consume cero, y
 * lo que se usó sin estar previsto se agrega. Se puede repetir: una orden ya
 * cerrada no se toca.
 */
export function cerrarFabricacion(id: number, usados: Componente[]): Promise<void> {
  return alDia(async () => {
    const leer = async () => {
      const [mo] = await ejecutar<Fila[]>("mrp.production", "read", [[id]], {
        fields: ["state", "product_qty", "move_raw_ids"],
      });
      return mo;
    };
    let mo = await leer();
    if (!mo) throw new ErrorOdoo("La orden de fabricación ya no existe en Odoo.");
    const estado = texto(mo.state);
    if (estado === "done") return;
    if (estado === "cancel") throw new ErrorOdoo("La orden de fabricación está cancelada en Odoo.");

    const leerCrudos = async (ids: number[]) =>
      ids.length ? await ejecutar<Fila[]>("stock.move", "read", [ids], { fields: ["product_id"] }) : [];
    const productoDe = (m: Fila) => (Array.isArray(m.product_id) ? (m.product_id as [number])[0] : null);

    let crudos = await leerCrudos((mo.move_raw_ids as number[]) ?? []);
    const previstos = new Set(crudos.map(productoDe));
    const nuevos = usados.filter((u) => u.cantidad > 0 && !previstos.has(u.productoId));
    if (nuevos.length) {
      const [aProduccion, deStock] = await Promise.all([produccion(), stock()]);
      const agregar = [];
      for (const c of nuevos) agregar.push([0, 0, await movimientoCrudo(c, deStock, aProduccion)]);
      await ejecutar("mrp.production", "write", [[id], { move_raw_ids: agregar }]);
      mo = await leer();
      crudos = await leerCrudos((mo?.move_raw_ids as number[]) ?? []);
    }

    const picked = (await camposExistentes("stock.move", ["picked"])).length > 0;
    const campoMov = picked ? "quantity" : "quantity_done";
    const cuanto = new Map(usados.map((u) => [u.productoId, u.cantidad]));
    const vistos = new Set<number>();
    for (const m of crudos) {
      const producto = productoDe(m);
      // Dos movimientos del mismo material: el primero se lleva todo.
      const cantidad = producto !== null && !vistos.has(producto) ? (cuanto.get(producto) ?? 0) : 0;
      if (producto !== null) vistos.add(producto);
      await ejecutar("stock.move", "write", [[m.id], { [campoMov]: cantidad, ...(picked ? { picked: cantidad > 0 } : {}) }]);
    }

    await ejecutar("mrp.production", "write", [[id], { qty_producing: mo!.product_qty }]);
    const r = await ejecutar("mrp.production", "button_mark_done", [[id]], {
      context: { skip_consumption: true, skip_backorder: true, mo_ids_to_backorder: [], skip_immediate: true },
    });
    if (typeof r === "object" && r !== null && "res_model" in r) {
      throw new ErrorOdoo("Odoo pidió confirmar algo más para cerrar la orden de fabricación. Ciérrala desde Odoo.");
    }
  });
}
