/**
 * Los sobrantes en Odoo.
 *
 * Un sobrante es un **lote** del producto "Sobrante" de su material, con una
 * unidad en stock y sus medidas en dos campos propios del lote, `x_largo` y
 * `x_ancho`. Así Odoo sabe cuántos hay y de qué tamaño, y cada pieza física
 * tiene su código (el del lote) para la etiqueta.
 *
 * Lo que la app crea la primera vez que hace falta, y después reutiliza:
 *   - los dos campos del lote (pide un usuario de Odoo con permiso de
 *     administración para crear campos);
 *   - el producto "Sobrante" de cada material, almacenable y con lotes.
 *
 * Cambia entre versiones, y por eso se detecta: el modelo del lote
 * (`stock.lot` desde la 16, `stock.production.lot` antes) y cómo se dice
 * "almacenable" (`is_storable` desde la 18, `detailed_type` en la 15-17).
 */

import {
  camposExistentes,
  ejecutar,
  ErrorOdoo,
  idDe,
  modeloExiste,
  nombreDe,
  olvidarCampos,
  registrarReinicio,
  texto,
} from "./rpc";

type Fila = Record<string, unknown>;

/** El prefijo del código del producto Sobrante: SOB-F7E024 es el sobrante del F7E024. */
export const PREFIJO_PRODUCTO = "SOB-";

/* ── Lo que se aprende de este Odoo ────────────────────────────────────────── */

let modeloLote: Promise<string> | null = null;
let camposLote: Promise<void> | null = null;
let ubicacion: Promise<number> | null = null;
const productos = new Map<string, Promise<number>>();

export function olvidarSobrantes() {
  modeloLote = null;
  camposLote = null;
  ubicacion = null;
  productos.clear();
  olvidarCampos("stock.lot");
  olvidarCampos("stock.production.lot");
}

registrarReinicio(olvidarSobrantes);

/** Si un error de Odoo dice que algo de lo aprendido ya no existe (un campo, un producto). */
export const esConocimientoViejo = (e: unknown) =>
  e instanceof ErrorOdoo && /ValueError|MissingError/.test(e.tipo ?? "");

/**
 * Lo aprendido de Odoo (el producto Sobrante, los campos del lote) puede quedar
 * viejo: alguien borró el producto, o el campo. Si Odoo responde que algo no
 * existe, se olvida todo y se intenta una vez más, que lo vuelve a crear.
 */
export async function conLoAprendidoAlDia<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!esConocimientoViejo(e)) throw e;
    olvidarSobrantes();
    return fn();
  }
}

/** Que un fallo no quede guardado: la siguiente llamada lo vuelve a intentar. */
function recordar<T>(p: Promise<T>, olvidar: () => void): Promise<T> {
  p.catch(olvidar);
  return p;
}

export function modeloDeLote(): Promise<string> {
  modeloLote ??= recordar(
    modeloExiste("stock.lot").then((existe) => (existe ? "stock.lot" : "stock.production.lot")),
    () => (modeloLote = null),
  );
  return modeloLote;
}

const CAMPOS_MEDIDA = [
  { name: "x_largo", field_description: "Largo (cm)" },
  { name: "x_ancho", field_description: "Ancho (cm)" },
];

/** Crea `x_largo` y `x_ancho` en el lote si este Odoo todavía no los tiene. */
export function asegurarCamposDeLote(): Promise<void> {
  camposLote ??= recordar(
    (async () => {
      const modelo = await modeloDeLote();
      const tiene = new Set(await camposExistentes(modelo, CAMPOS_MEDIDA.map((c) => c.name)));
      const faltan = CAMPOS_MEDIDA.filter((c) => !tiene.has(c.name));
      if (faltan.length === 0) return;

      const [idModelo] = await ejecutar<number[]>("ir.model", "search", [[["model", "=", modelo]]], { limit: 1 });
      if (!idModelo) throw new ErrorOdoo(`Este Odoo no tiene el modelo de lotes (${modelo}).`);
      try {
        for (const c of faltan) {
          await ejecutar("ir.model.fields", "create", [
            { ...c, model_id: idModelo, ttype: "float", state: "manual" },
          ]);
        }
      } catch (e) {
        if (e instanceof ErrorOdoo && e.tipo?.includes("AccessError")) {
          throw new ErrorOdoo(
            "Faltan los campos de medida del lote (x_largo, x_ancho) y el usuario de Odoo no puede crearlos. " +
              "Créalos una vez con un administrador de Odoo, o dale ese permiso al usuario de la app.",
            e.tipo,
          );
        }
        throw e;
      }
      // `camposExistentes` recordaba el modelo sin estos campos.
      olvidarCampos(modelo);
    })(),
    () => (camposLote = null),
  );
  return camposLote;
}

/** Dónde vive el stock: la ubicación del primer almacén. */
export function ubicacionDeStock(): Promise<number> {
  ubicacion ??= recordar(
    (async () => {
      const almacenes = await ejecutar<Fila[]>("stock.warehouse", "search_read", [[]], {
        fields: ["lot_stock_id"],
        limit: 1,
      });
      const id = idDe(almacenes[0]?.lot_stock_id);
      if (id) return id;
      const [interna] = await ejecutar<number[]>("stock.location", "search", [[["usage", "=", "internal"]]], {
        limit: 1,
      });
      if (!interna) throw new ErrorOdoo("Odoo no tiene un almacén donde guardar los sobrantes.");
      return interna;
    })(),
    () => (ubicacion = null),
  );
  return ubicacion;
}

/** "Almacenable", como lo diga esta versión. */
async function valoresAlmacenable(): Promise<Record<string, unknown>> {
  const [storable, detailed] = await Promise.all([
    camposExistentes("product.template", ["is_storable"]),
    camposExistentes("product.template", ["detailed_type"]),
  ]);
  if (storable.length) return { type: "consu", is_storable: true };
  if (detailed.length) return { detailed_type: "product" };
  return { type: "product" };
}

export interface MaterialDeSobrante {
  /** El código de la plancha de referencia del grupo (F7E024): el producto es SOB-F7E024. */
  codigoBase: string;
  /** "SOBRANTE ACRILICO ECO CRISTAL 3MM". */
  nombre: string;
}

/**
 * El producto Sobrante de un material (`product.product`). Lo crea si no está:
 * almacenable, con lotes, ni para vender ni para comprar.
 */
export function productoSobrante(m: MaterialDeSobrante): Promise<number> {
  const codigo = `${PREFIJO_PRODUCTO}${m.codigoBase}`;
  let p = productos.get(codigo);
  if (!p) {
    p = recordar(
      (async () => {
        const buscar = () =>
          ejecutar<number[]>("product.product", "search", [[["default_code", "=", codigo]]], { limit: 1 });
        const [existente] = await buscar();
        if (existente) return existente;

        await ejecutar("product.template", "create", [
          {
            name: m.nombre,
            default_code: codigo,
            tracking: "lot",
            sale_ok: false,
            purchase_ok: false,
            ...(await valoresAlmacenable()),
          },
        ]);
        const [creado] = await buscar();
        if (!creado) throw new ErrorOdoo("Odoo creó el producto Sobrante pero no lo devolvió.");
        return creado;
      })(),
      () => productos.delete(codigo),
    );
    productos.set(codigo, p);
  }
  return p;
}

export interface LoteNuevo {
  material: MaterialDeSobrante;
  /** SOB-00042. */
  nombre: string;
  largo: number;
  ancho: number;
  /** La ubicación en palabras y, si lo hay, el color. Va a la nota del lote. */
  nota: string | null;
}

/**
 * Crea el lote de un sobrante con una unidad en stock. Se puede repetir: si el
 * lote ya existe (un intento anterior que se cortó a medias), lo reutiliza, y
 * solo pone stock si todavía no lo tiene.
 */
export function crearLoteSobrante(l: LoteNuevo): Promise<number> {
  return conLoAprendidoAlDia(() => crearLote(l));
}

async function crearLote(l: LoteNuevo): Promise<number> {
  await asegurarCamposDeLote();
  const [modelo, productoId, ubicacionId] = await Promise.all([
    modeloDeLote(),
    productoSobrante(l.material),
    ubicacionDeStock(),
  ]);

  const [previo] = await ejecutar<number[]>(
    modelo,
    "search",
    [[["name", "=", l.nombre], ["product_id", "=", productoId]]],
    { limit: 1 },
  );
  const valores = { x_largo: l.largo, x_ancho: l.ancho, ...(l.nota ? { note: l.nota } : {}) };
  let loteId = previo;
  if (loteId) await ejecutar(modelo, "write", [[loteId], valores]);
  else loteId = await ejecutar<number>(modelo, "create", [{ name: l.nombre, product_id: productoId, ...valores }]);

  const quants = await ejecutar<Fila[]>(
    "stock.quant",
    "search_read",
    [[["lot_id", "=", loteId], ["location_id", "=", ubicacionId]]],
    { fields: ["quantity"], limit: 1 },
  );
  if (Number(quants[0]?.quantity ?? 0) >= 1) return loteId;

  const contexto = { context: { inventory_mode: true } };
  const quantId = quants[0]
    ? (quants[0].id as number)
    : await ejecutar<number>(
        "stock.quant",
        "create",
        [{ product_id: productoId, location_id: ubicacionId, lot_id: loteId, inventory_quantity: 1 }],
        contexto,
      );
  if (quants[0]) await ejecutar("stock.quant", "write", [[quantId], { inventory_quantity: 1 }], contexto);
  await ejecutar("stock.quant", "action_apply_inventory", [[quantId]], contexto);
  return loteId;
}

/** Cambia la nota del lote: la ubicación se mueve más que la pieza. */
export async function anotarLote(loteId: number, nota: string | null): Promise<void> {
  const modelo = await modeloDeLote();
  await ejecutar(modelo, "write", [[loteId], { note: nota ?? false }]);
}

export interface LoteEnStock {
  loteId: number;
  nombre: string;
  /** El código del producto Sobrante: SOB-F7E024. */
  codigoProducto: string;
  largo: number | null;
  ancho: number | null;
  nota: string | null;
}

/**
 * Los sobrantes que Odoo tiene en stock: los lotes de productos Sobrante con
 * existencias en alguna ubicación interna.
 */
export function lotesEnStock(): Promise<LoteEnStock[]> {
  return conLoAprendidoAlDia(leerLotesEnStock);
}

async function leerLotesEnStock(): Promise<LoteEnStock[]> {
  await asegurarCamposDeLote();
  const modelo = await modeloDeLote();

  const productosSob = await ejecutar<Fila[]>(
    "product.product",
    "search_read",
    [[["default_code", "=like", `${PREFIJO_PRODUCTO}%`]]],
    { fields: ["default_code"] },
  );
  if (productosSob.length === 0) return [];
  const codigoDe = new Map(productosSob.map((p) => [p.id as number, texto(p.default_code) ?? ""]));

  const quants = await ejecutar<Fila[]>(
    "stock.quant",
    "search_read",
    [[["product_id", "in", [...codigoDe.keys()]], ["location_id.usage", "=", "internal"], ["quantity", ">", 0]]],
    { fields: ["lot_id", "product_id"] },
  );
  const lotes = [...new Set(quants.map((q) => idDe(q.lot_id)).filter((id): id is number => !!id))];
  if (lotes.length === 0) return [];

  const filas = await ejecutar<Fila[]>(modelo, "read", [lotes], {
    fields: ["name", "product_id", "x_largo", "x_ancho", "note"],
  });
  const medida = (v: unknown) => (typeof v === "number" && v > 0 ? v : null);
  return filas.map((f) => ({
    loteId: f.id as number,
    nombre: texto(f.name) ?? nombreDe(f.product_id) ?? `#${f.id}`,
    codigoProducto: codigoDe.get(idDe(f.product_id) ?? 0) ?? "",
    largo: medida(f.x_largo),
    ancho: medida(f.x_ancho),
    nota: texto(typeof f.note === "string" ? f.note.replace(/<[^>]+>/g, " ") : null),
  }));
}
