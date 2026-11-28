/**
 * La producción de un corte en Odoo, para los materiales con el piloto de
 * sobrantes encendido, tal como se hacía antes.
 *
 * Ya no se crean órdenes para cortes nuevos: la venta lleva las planchas (y las
 * piezas del almacén que usa) para poder facturarlas, y la entrega las descuenta.
 * Esto queda para cerrar las órdenes de los cortes que se cotizaron con el
 * esquema anterior, en el que el corte era un producto "Corte a medida" en m²:
 *
 *   orden de fabricación (sin lista de materiales: la arma la app, pieza por pieza)
 *     consume   las planchas nuevas del formato
 *     produce   el corte a medida, en m² de piezas
 *     y además  un sobrante por cada pedazo que vuelve al almacén, cada uno su
 *               propio lote con largo y ancho
 *
 * Los productos terminados sí siguen fabricándose (`crearFabricacion`).
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
import { campoCantidad, camposExistentes, ejecutar, ErrorOdoo, idDe, registrarReinicio, texto, valoresAlmacenable } from "./rpc";

type Fila = Record<string, unknown>;

export const PREFIJO_CORTE = "CAM-";

/* ── Lo que se aprende de este Odoo ────────────────────────────────────────── */

let uomM2: Promise<number> | null = null;
let ubicacionProduccion: Promise<number> | null = null;
const productosCorte = new Map<string, Promise<number>>();

function olvidarTodo() {
  uomM2 = null;
  ubicacionProduccion = null;
  productosCorte.clear();
}

registrarReinicio(olvidarTodo);

/**
 * Como en los sobrantes: si Odoo dice que algo ya no existe (el producto Corte a
 * medida o Sobrante de un material, que la app recuerda), se olvida lo aprendido
 * y se reintenta una vez, lo que lo vuelve a crear. Lo usa también la venta, que
 * lleva el producto Corte a medida.
 */
export async function alDia<T>(fn: () => Promise<T>): Promise<T> {
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

/** La ubicación virtual de producción: adonde van los materiales y de donde sale lo fabricado. */
async function leerUbicacionProduccion(): Promise<number> {
  const [id] = await ejecutar<number[]>("stock.location", "search", [[["usage", "=", "production"]]], { limit: 1 });
  if (!id) throw new ErrorOdoo("Odoo no tiene una ubicación de producción.");
  return id;
}

const produccion = () =>
  (ubicacionProduccion ??= recordar(leerUbicacionProduccion(), () => (ubicacionProduccion = null)));

/**
 * Dónde trabaja una orden. Se corta o se fabrica en un almacén (el taller, o la
 * tienda para un corte manual), y lo producido queda en el almacén de donde sale
 * la venta: así la entrega lo encuentra.
 */
export interface DondeProducir {
  /** La ubicación de stock del almacén donde se produce: de ahí salen los materiales. */
  ubicacionOrigen: number;
  /** La del almacén de donde sale la venta: ahí queda lo producido. */
  ubicacionDestino: number;
  /** La operación de fabricación del almacén donde se produce (`manu_type_id`). */
  tipoOperacion: number | null;
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
  /**
   * Si el corte mezcla formatos: las planchas de los demás formatos, cada una
   * con su producto. Cada una es un componente más de la orden.
   */
  otrasPlanchas?: { productoId: number; cantidad: number }[];
  /** Cuántos sobrantes se prevé que vuelvan al almacén, y su área (para repartir el costo). */
  sobrantesPrevistos: { areaM2: number }[];
  /** Los lotes de los sobrantes del almacén que el corte consume. */
  consumidos?: number[];
  donde: DondeProducir;
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
  const [corteId, sobranteId, uom, origenProduccion, conCosto] = await Promise.all([
    productoCorte(p.material),
    productoSobrante(p.material),
    unidadM2(),
    produccion(),
    camposExistentes("stock.move", ["cost_share"]).then((c) => c.length > 0),
  ]);
  // Las planchas y los sobrantes que usa salen de donde se corta; los sobrantes
  // previstos vuelven ahí mismo (al cerrar se corrige si alguno va a otro almacén).
  const deStock = p.donde.ubicacionOrigen;
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
      location_id: deStock,
      location_dest_id: origenProduccion,
    },
    "Planchas del corte",
  );
  // Las de los otros formatos, si el corte mezcla: un movimiento por producto.
  const otrosCrudos = [];
  for (const o of (p.otrasPlanchas ?? []).filter((x) => x.cantidad > 0 && x.productoId !== p.planchaId)) {
    otrosCrudos.push([
      0,
      0,
      await movimiento(
        {
          product_id: o.productoId,
          product_uom_qty: o.cantidad,
          product_uom: await uomDe(o.productoId),
          location_id: deStock,
          location_dest_id: origenProduccion,
        },
        "Planchas del corte",
      ),
    ]);
  }
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
              location_dest_id: deStock,
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
              location_id: deStock,
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
      ...(p.donde.tipoOperacion ? { picking_type_id: p.donde.tipoOperacion } : {}),
      location_src_id: deStock,
      location_dest_id: p.donde.ubicacionDestino,
      move_raw_ids: [...(p.planchas > 0 ? [[0, 0, crudo]] : []), ...otrosCrudos, ...crudoSobrantes],
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
  /** La ubicación de stock del almacén al que fue (`lot_stock_id`). */
  ubicacionId: number;
  /** Su material. Si falta, el de la orden (`Cierre.material`). */
  material?: MaterialDeSobrante;
}

export interface Cierre {
  /** El material: hace falta si hay que agregar el subproducto que no se previó. */
  material: MaterialDeSobrante;
  /** Las planchas nuevas que de verdad se usaron. */
  planchas: number;
  /**
   * Si el corte mezcla formatos: las usadas de cada producto de plancha. Manda
   * sobre `planchas` para los productos que nombra.
   */
  planchasPorProducto?: Record<number, number>;
  /** Los lotes de los sobrantes del almacén que se consumieron. */
  consumidos?: number[];
  /** Los pedazos que de verdad se guardaron, con su medida real y su almacén. */
  sobrantes: SobranteReal[];
}

/**
 * Los lotes de los sobrantes, con sus medidas: así la línea del movimiento solo
 * los nombra. Se puede repetir: un lote que ya existe se actualiza.
 */
async function lotesDeSobrantes(sobrantes: (SobranteReal & { productoId: number })[]): Promise<Map<string, number>> {
  const lotes = new Map<string, number>();
  if (sobrantes.length === 0) return lotes;
  await asegurarCamposDeLote();
  const modeloLote = await modeloDeLote();
  for (const s of sobrantes) {
    const [previo] = await ejecutar<number[]>(
      modeloLote,
      "search",
      [[["name", "=", s.nombre], ["product_id", "=", s.productoId]]],
      { limit: 1 },
    );
    const valores = { x_largo: s.largo, x_ancho: s.ancho, ...(s.nota ? { note: s.nota } : {}) };
    if (previo) {
      await ejecutar(modeloLote, "write", [[previo], valores]);
      lotes.set(s.nombre, previo);
    } else {
      lotes.set(s.nombre, await ejecutar<number>(modeloLote, "create", [{ name: s.nombre, product_id: s.productoId, ...valores }]));
    }
  }
  return lotes;
}

/**
 * Los sobrantes como subproductos de una orden abierta: un movimiento por
 * material y almacén de destino, y una línea por lote. Los movimientos previstos
 * se reutilizan (y se les cambia el destino si el pedazo fue a otro almacén); los
 * que faltan se agregan; los previstos que sobran quedan sin nada y Odoo los
 * cancela al cerrar.
 */
async function subproductosALaOrden(
  id: number,
  sobrantes: (SobranteReal & { productoId: number })[],
  lotes: Map<string, number>,
  nombreMovimiento: string,
) {
  const { picked, campoLinea } = await campoCantidad();
  const leer = async () => {
    const [actual] = await ejecutar<Fila[]>("mrp.production", "read", [[id]], { fields: ["move_byproduct_ids"] });
    const ids = (actual?.move_byproduct_ids as number[]) ?? [];
    return ids.length
      ? await ejecutar<Fila[]>("stock.move", "read", [ids], { fields: ["product_id", "location_id", "location_dest_id"] })
      : [];
  };

  const grupos = new Map<string, (SobranteReal & { productoId: number })[]>();
  for (const s of sobrantes) {
    const clave = `${s.productoId}:${s.ubicacionId}`;
    grupos.set(clave, [...(grupos.get(clave) ?? []), s]);
  }

  let movs = await leer();
  const usados = new Set<number>();
  for (const piezas of grupos.values()) {
    const { productoId, ubicacionId } = piezas[0];
    const delProducto = movs.filter((m) => idDe(m.product_id) === productoId && !usados.has(m.id as number));
    let mov: Fila | undefined = delProducto.find((m) => idDe(m.location_dest_id) === ubicacionId) ?? delProducto[0];
    if (mov && idDe(mov.location_dest_id) !== ubicacionId) {
      await ejecutar("stock.move", "write", [[mov.id], { location_dest_id: ubicacionId }]);
      mov = { ...mov, location_dest_id: [ubicacionId, ""] };
    }
    if (!mov) {
      const [desde, uom] = await Promise.all([produccion(), uomDe(productoId)]);
      await ejecutar("mrp.production", "write", [
        [id],
        {
          move_byproduct_ids: [
            [
              0,
              0,
              await movimiento(
                { product_id: productoId, product_uom_qty: piezas.length, product_uom: uom, location_id: desde, location_dest_id: ubicacionId },
                nombreMovimiento,
              ),
            ],
          ],
        },
      ]);
      const antes = new Set(movs.map((m) => m.id as number));
      movs = await leer();
      mov = movs.find((m) => !antes.has(m.id as number) && idDe(m.product_id) === productoId);
      if (!mov) throw new ErrorOdoo("Odoo no agregó el subproducto de los sobrantes a la orden.");
    }
    usados.add(mov.id as number);

    for (const s of piezas) {
      await ejecutar("stock.move.line", "create", [
        {
          move_id: mov.id,
          product_id: productoId,
          lot_id: lotes.get(s.nombre),
          location_id: idDe(mov.location_id),
          location_dest_id: ubicacionId,
          [campoLinea]: 1,
          ...(picked ? { picked: true } : {}),
        },
      ]);
    }
    // Hasta la 16 la cantidad hecha sale de las líneas; desde la 17 se marca `picked`.
    if (picked) await ejecutar("stock.move", "write", [[mov.id], { picked: true }]);
  }
}

/** Con el material de cada sobrante resuelto a su producto Sobrante. */
async function conProducto(sobrantes: SobranteReal[], porDefecto: MaterialDeSobrante | null) {
  const salida: (SobranteReal & { productoId: number })[] = [];
  for (const s of sobrantes) {
    const material = s.material ?? porDefecto;
    if (!material) throw new ErrorOdoo(`El sobrante ${s.nombre} no dice de qué material es.`);
    salida.push({ ...s, productoId: await productoSobrante(material) });
  }
  return salida;
}

async function marcarHecha(id: number) {
  const r = await ejecutar("mrp.production", "button_mark_done", [[id]], {
    context: { skip_consumption: true, skip_backorder: true, mo_ids_to_backorder: [], skip_immediate: true },
  });
  if (typeof r === "object" && r !== null && "res_model" in r) {
    throw new ErrorOdoo("Odoo pidió confirmar algo más para cerrar la orden de fabricación. Ciérrala desde Odoo.");
  }
}

/**
 * Cierra la orden con lo real: las planchas consumidas, los m² producidos y un
 * lote por sobrante guardado, en el almacén al que fue. Devuelve el id del lote
 * de cada sobrante. Se puede repetir: una orden ya cerrada no se toca, y solo se
 * devuelven sus lotes.
 */
export function cerrarProduccion(id: number, c: Cierre): Promise<Map<string, number>> {
  return alDia(() => cerrar(id, c));
}

async function cerrar(id: number, c: Cierre): Promise<Map<string, number>> {
  const [mo] = await ejecutar<Fila[]>("mrp.production", "read", [[id]], {
    fields: ["state", "product_qty", "move_raw_ids"],
  });
  if (!mo) throw new ErrorOdoo("La orden de fabricación ya no existe en Odoo.");
  const estado = texto(mo.state);
  if (estado === "cancel") throw new ErrorOdoo("La orden de fabricación está cancelada en Odoo.");

  const sobranteId = await productoSobrante(c.material);
  const sobrantes = await conProducto(c.sobrantes, c.material);
  const lotes = await lotesDeSobrantes(sobrantes);
  if (estado === "done") return lotes;

  const { picked, campoMov, campoLinea } = await campoCantidad();

  // Lo consumido: las planchas nuevas por cantidad, y los sobrantes lote por lote.
  const crudos = ((mo.move_raw_ids as number[]) ?? []).length
    ? await ejecutar<Fila[]>("stock.move", "read", [mo.move_raw_ids as number[]], {
        fields: ["product_id", "location_id", "location_dest_id"],
      })
    : [];
  const consumidos = c.consumidos ?? [];
  for (const m of crudos) {
    const producto = idDe(m.product_id);
    if (producto !== sobranteId) {
      const usadas = (producto !== null ? c.planchasPorProducto?.[producto] : undefined) ?? c.planchas;
      await ejecutar("stock.move", "write", [[m.id], { [campoMov]: usadas, ...(picked ? { picked: usadas > 0 } : {}) }]);
      continue;
    }
    for (const lote of consumidos) {
      await ejecutar("stock.move.line", "create", [
        {
          move_id: m.id,
          product_id: sobranteId,
          lot_id: lote,
          location_id: idDe(m.location_id),
          location_dest_id: idDe(m.location_dest_id),
          [campoLinea]: 1,
          ...(picked ? { picked: true } : {}),
        },
      ]);
    }
    if (picked) await ejecutar("stock.move", "write", [[m.id], { picked: consumidos.length > 0 }]);
  }

  // Lo producido: los m² de la orden, y una línea por sobrante con su lote.
  await ejecutar("mrp.production", "write", [[id], { qty_producing: mo.product_qty }]);
  if (sobrantes.length) await subproductosALaOrden(id, sobrantes, lotes, "Sobrantes del corte");

  await marcarHecha(id);
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
  /** Los sobrantes del almacén que se usan (sus lotes), con su material. */
  sobrantes?: SobrantesConsumidos;
  donde: DondeProducir;
}

/** Sobrantes del almacén que consume una orden: un lote por pedazo. */
export interface SobrantesConsumidos {
  material: MaterialDeSobrante;
  lotes: number[];
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

    const deStock = p.donde.ubicacionOrigen;
    const [aProduccion, uom] = await Promise.all([produccion(), uomDe(p.productoId)]);
    const crudos = [];
    for (const c of p.componentes) {
      if (c.cantidad > 0) crudos.push([0, 0, await movimientoCrudo(c, deStock, aProduccion)]);
    }
    // Los sobrantes elegidos: un componente más, que al cerrar se consume lote por lote.
    if (p.sobrantes?.lotes.length) {
      await asegurarCamposDeLote();
      const sobranteId = await productoSobrante(p.sobrantes.material);
      crudos.push([
        0,
        0,
        await movimiento(
          {
            product_id: sobranteId,
            product_uom_qty: p.sobrantes.lotes.length,
            product_uom: await uomDe(sobranteId),
            location_id: deStock,
            location_dest_id: aProduccion,
          },
          "Sobrantes que usa el producto terminado",
        ),
      ]);
    }

    const id = await ejecutar<number>("mrp.production", "create", [
      {
        product_id: p.productoId,
        product_qty: p.cantidad,
        product_uom_id: uom,
        origin: p.origen,
        ...(p.donde.tipoOperacion ? { picking_type_id: p.donde.tipoOperacion } : {}),
        location_src_id: deStock,
        location_dest_id: p.donde.ubicacionDestino,
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
 * lo que se usó sin estar previsto se agrega. Los pedazos de plancha que
 * quedaron vuelven como sobrantes, cada uno a su almacén. Devuelve el id del
 * lote de cada sobrante. Se puede repetir: una orden ya cerrada no se toca.
 */
export function cerrarFabricacion(
  id: number,
  usados: Componente[],
  sobrantesReales: SobranteReal[] = [],
  consumidos: SobrantesConsumidos | null = null,
): Promise<Map<string, number>> {
  return alDia(async () => {
    const leer = async () => {
      const [mo] = await ejecutar<Fila[]>("mrp.production", "read", [[id]], {
        fields: ["state", "product_qty", "move_raw_ids", "location_src_id"],
      });
      return mo;
    };
    let mo = await leer();
    if (!mo) throw new ErrorOdoo("La orden de fabricación ya no existe en Odoo.");
    const estado = texto(mo.state);
    if (estado === "cancel") throw new ErrorOdoo("La orden de fabricación está cancelada en Odoo.");
    const sobrantes = await conProducto(sobrantesReales, null);
    const lotes = await lotesDeSobrantes(sobrantes);
    if (estado === "done") return lotes;

    const leerCrudos = async (ids: number[]) =>
      ids.length ? await ejecutar<Fila[]>("stock.move", "read", [ids], { fields: ["product_id"] }) : [];
    const productoDe = (m: Fila) => (Array.isArray(m.product_id) ? (m.product_id as [number])[0] : null);

    let crudos = await leerCrudos((mo.move_raw_ids as number[]) ?? []);
    const previstos = new Set(crudos.map(productoDe));
    const nuevos = usados.filter((u) => u.cantidad > 0 && !previstos.has(u.productoId));
    if (nuevos.length) {
      const aProduccion = await produccion();
      const deStock = idDe(mo.location_src_id);
      if (!deStock) throw new ErrorOdoo("La orden de fabricación no dice de qué almacén consume.");
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
    // Los sobrantes del almacén se consumen lote por lote, no por cantidad.
    const sobranteId = consumidos?.lotes.length ? await productoSobrante(consumidos.material) : null;
    for (const m of crudos) {
      const producto = productoDe(m);
      if (sobranteId !== null && producto === sobranteId && !vistos.has(producto)) {
        vistos.add(producto);
        const { campoLinea } = await campoCantidad();
        const [mov] = await ejecutar<Fila[]>("stock.move", "read", [[m.id]], {
          fields: ["location_id", "location_dest_id"],
        });
        for (const lote of consumidos!.lotes) {
          await ejecutar("stock.move.line", "create", [
            {
              move_id: m.id,
              product_id: sobranteId,
              lot_id: lote,
              location_id: idDe(mov?.location_id),
              location_dest_id: idDe(mov?.location_dest_id),
              [campoLinea]: 1,
              ...(picked ? { picked: true } : {}),
            },
          ]);
        }
        if (picked) await ejecutar("stock.move", "write", [[m.id], { picked: true }]);
        continue;
      }
      // Dos movimientos del mismo material: el primero se lleva todo.
      const cantidad = producto !== null && !vistos.has(producto) ? (cuanto.get(producto) ?? 0) : 0;
      if (producto !== null) vistos.add(producto);
      await ejecutar("stock.move", "write", [[m.id], { [campoMov]: cantidad, ...(picked ? { picked: cantidad > 0 } : {}) }]);
    }

    await ejecutar("mrp.production", "write", [[id], { qty_producing: mo!.product_qty }]);
    if (sobrantes.length) await subproductosALaOrden(id, sobrantes, lotes, "Sobrantes del producto terminado");
    await marcarHecha(id);
    return lotes;
  });
}
