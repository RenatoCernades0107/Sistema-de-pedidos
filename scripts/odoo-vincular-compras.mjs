/**
 * Las compras que la app ingresó ANTES de usar el módulo Compras de Odoo: eran
 * una recepción suelta (Inventario), sin orden de compra. Este script les crea su
 * orden de compra y deja la recepción que ya está hecha como LA recepción de esa
 * orden, sin mover stock otra vez.
 *
 *   npm run odoo:vincular-compras                      # solo lista: no toca nada
 *   npm run odoo:vincular-compras -- --aplicar --limite 1   # prueba con UNA
 *   npm run odoo:vincular-compras -- --aplicar         # todas
 *   npm run odoo:vincular-compras -- --juntar ING-00002,ING-00003 --aplicar
 *       # esas recepciones, en UNA sola orden de compra (mismo proveedor y almacén)
 *
 * Qué hace con cada recepción (origen "App Plexiacril ING-00001", ya validada):
 *   1. Crea la orden de compra con el mismo proveedor, productos, cantidades,
 *      costos y la guía o factura de referencia, y la confirma.
 *   2. Odoo arma una recepción NUEVA para esa orden: se cancela (no se recibe).
 *   3. Cada movimiento de la recepción vieja se enlaza a su línea de compra
 *      (`purchase_line_id`). Así Odoo cuenta lo recibido y la orden queda lista
 *      para facturar.
 * El stock y la valoración no cambian: solo se agrega el enlace. Se puede repetir:
 * una recepción ya enlazada se salta, y una orden a medias se retoma.
 *
 * Lee ODOO_URL, ODOO_DB, ODOO_USERNAME y ODOO_PASSWORD de .env.prod (no de
 * .env.local, que es el Odoo de desarrollo): crea ese archivo con los datos del
 * Odoo de producción; git lo ignora. Si no existe, el comando falla sin tocar nada.
 * Corre primero sin --aplicar, luego con --limite 1, y mira
 * esa compra en Odoo (Compras → Pedidos) antes de seguir con las demás.
 */
const { ODOO_URL, ODOO_DB, ODOO_USERNAME, ODOO_PASSWORD } = process.env;
if (!ODOO_URL || !ODOO_DB || !ODOO_USERNAME || !ODOO_PASSWORD) {
  console.error("Faltan ODOO_URL, ODOO_DB, ODOO_USERNAME u ODOO_PASSWORD (.env.prod).");
  process.exit(1);
}

const args = process.argv.slice(2);
const aplicar = args.includes("--aplicar");
const iLimite = args.indexOf("--limite");
const limite = iLimite >= 0 ? Number(args[iLimite + 1]) : Infinity;
if (iLimite >= 0 && !(limite > 0)) {
  console.error("--limite necesita un número mayor que cero.");
  process.exit(1);
}

const iJuntar = args.indexOf("--juntar");
const juntar = iJuntar >= 0 ? (args[iJuntar + 1] ?? "").split(",").map((x) => x.trim()).filter(Boolean) : null;
if (juntar && (juntar.length < 2 || new Set(juntar).size !== juntar.length)) {
  console.error("--juntar necesita al menos dos códigos distintos, separados por coma: --juntar ING-00002,ING-00003");
  process.exit(1);
}

const URL_RPC = `${ODOO_URL.trim().replace(/\/+$/, "")}/jsonrpc`;

async function rpc(service, method, params) {
  const r = await fetch(URL_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "call", id: 1, params: { service, method, args: params } }),
  });
  const texto = await r.text();
  let j;
  try {
    j = JSON.parse(texto);
  } catch {
    console.error(
      `Odoo no contestó JSON en ${URL_RPC} (HTTP ${r.status}).\n` +
        `Empieza con: ${texto.slice(0, 80).replace(/\s+/g, " ")}\n` +
        "Revisa ODOO_URL en .env.prod: debe ser solo el origen (https://empresa.odoo.com), sin /odoo ni /web.",
    );
    process.exit(1);
  }
  if (j.error) throw new Error(j.error.data?.message ?? j.error.message ?? "Error de Odoo");
  return j.result;
}

const uid = await rpc("common", "authenticate", [ODOO_DB, ODOO_USERNAME, ODOO_PASSWORD, {}]);
if (!uid) {
  console.error("Odoo no aceptó el usuario o la contraseña de .env.prod.");
  process.exit(1);
}

const ejecutar = (modelo, metodo, a = [], kw = {}) =>
  rpc("object", "execute_kw", [ODOO_DB, uid, ODOO_PASSWORD, modelo, metodo, a, kw]);

const camposDe = new Map();
async function tiene(modelo, campo) {
  if (!camposDe.has(modelo)) camposDe.set(modelo, new Set(Object.keys(await ejecutar(modelo, "fields_get", [], { attributes: ["type"] }))));
  return camposDe.get(modelo).has(campo);
}

const PREFIJO_ORIGEN = "App Plexiacril";
const id = (v) => (Array.isArray(v) ? v[0] : v || null);

/* ── Qué hay que vincular ───────────────────────────────────────────────── */

// Se pregunta por los campos de purchase.order y no por ir.model: ese modelo solo lo ve un administrador.
const hayCompras = await ejecutar("purchase.order", "fields_get", [], { attributes: ["type"] }).then(
  () => true,
  (e) => {
    if (/doesn't exist|does not exist|KeyError/i.test(e.message)) return false;
    throw e;
  },
);
if (!hayCompras) {
  console.error("Odoo no tiene instalada la app Compras (Aplicaciones → Compras). Instálala y vuelve a correr esto.");
  process.exit(1);
}

const conEnlace = await tiene("stock.move", "purchase_line_id");
if (!conEnlace) {
  console.error("Los movimientos de este Odoo no tienen purchase_line_id: falta el módulo purchase_stock (Compras + Inventario).");
  process.exit(1);
}

// Lo que cambia entre versiones de Odoo: la recepción puede no tener `partner_ref`, y la
// cantidad hecha de un movimiento es `quantity` (desde la 17) o `quantity_done` (antes).
const conRef = await tiene("stock.picking", "partner_ref");
const campoCantidad = (await tiene("stock.move", "picked")) ? "quantity" : "quantity_done";

const recepciones = await ejecutar(
  "stock.picking",
  "search_read",
  [[["picking_type_code", "=", "incoming"], ["state", "=", "done"], ["origin", "=like", "App Plexiacril ING-%"]]],
  { fields: ["name", "origin", "partner_id", "picking_type_id", "date_done", ...(conRef ? ["partner_ref"] : [])], order: "id" },
);

const pendientes = [];
for (const p of recepciones) {
  const movs = await ejecutar("stock.move", "search_read", [[["picking_id", "=", p.id], ["state", "=", "done"]]], {
    fields: ["product_id", campoCantidad, "price_unit", "purchase_line_id"],
    order: "id",
  });
  const hechos = movs.filter((m) => Number(m[campoCantidad]) > 0).map((m) => ({ ...m, cantidad: Number(m[campoCantidad]) }));
  if (hechos.length && hechos.some((m) => !id(m.purchase_line_id))) pendientes.push({ origen: p.origin, ps: [p], movs: hechos });
}

console.log(`Recepciones de compras de la app: ${recepciones.length}. Sin orden de compra: ${pendientes.length}.`);
const resumen = ({ ps, movs }) => {
  const total = movs.reduce((t, m) => t + m.cantidad * Number(m.price_unit || 0), 0);
  return `${ps.map((p) => `${p.origin}  ${p.name}`).join(" + ")}  ${ps[0].partner_id?.[1] ?? "(sin proveedor)"}  ${movs.length} línea(s)  costo total ${total.toFixed(2)}`;
};
for (const g of pendientes) console.log(`  ${resumen(g)}`);

// Con --juntar, solo esas recepciones, todas en una orden.
let porVincular = pendientes;
if (juntar) {
  const elegidas = juntar.map((codigo) => ({ codigo, g: pendientes.find((x) => x.origen === `${PREFIJO_ORIGEN} ${codigo}`) }));
  const faltan = elegidas.filter((e) => !e.g).map((e) => e.codigo);
  if (faltan.length) {
    console.error(`\nNo hay compra pendiente de vincular para: ${faltan.join(", ")} (no existe, o ya tiene orden de compra).`);
    process.exit(1);
  }
  const ps = elegidas.flatMap((e) => e.g.ps);
  const grupo = {
    origen: `${PREFIJO_ORIGEN} ${juntar.join(" + ")}`,
    ps,
    movs: elegidas.flatMap((e) => e.g.movs),
  };
  console.log(`\nSe juntarían en una sola orden:\n  ${resumen(grupo)}`);
  porVincular = [grupo];
}
if (!pendientes.length) process.exit(0);
if (!aplicar) {
  console.log("\nNo se tocó nada. Para vincular: npm run odoo:vincular-compras -- --aplicar --limite 1");
  process.exit(0);
}

/* ── Vincular ───────────────────────────────────────────────────────────── */

// La unidad de la línea de compra se llama distinto según la versión.
const campoUom = (await tiene("purchase.order.line", "product_uom"))
  ? "product_uom"
  : (await tiene("purchase.order.line", "product_uom_id"))
    ? "product_uom_id"
    : null;

async function vincular({ origen, ps, movs }) {
  const [p] = ps;
  if (!id(p.partner_id)) throw new Error("la recepción no tiene proveedor");
  if (ps.some((x) => id(x.partner_id) !== id(p.partner_id))) throw new Error("las recepciones son de proveedores distintos");
  if (ps.some((x) => id(x.picking_type_id) !== id(p.picking_type_id))) {
    throw new Error("las recepciones son de almacenes distintos: una orden de compra recibe en un solo almacén");
  }

  // Una orden que ya existe con este origen (una corrida anterior que se cortó) se retoma.
  let [orden] = await ejecutar("purchase.order", "search_read", [[["origin", "=", origen]]], { fields: ["state", "order_line", "picking_ids"], limit: 1 });
  if (orden?.state === "cancel") throw new Error(`su orden de compra está cancelada en Odoo (id ${orden.id})`);

  if (!orden) {
    const productos = await ejecutar("product.product", "read", [[...new Set(movs.map((m) => id(m.product_id)))]], { fields: ["display_name", "uom_id"] });
    const datos = new Map(productos.map((x) => [x.id, x]));
    const refs = [...new Set(ps.map((x) => x.partner_ref).filter(Boolean))];
    const fecha = ps.map((x) => x.date_done).filter(Boolean).sort().at(-1);
    const lineas = movs.map((m) => {
      const prod = datos.get(id(m.product_id));
      return [0, 0, {
        product_id: id(m.product_id),
        name: prod?.display_name || "Producto",
        product_qty: m.cantidad,
        price_unit: Number(m.price_unit || 0),
        ...(campoUom && prod?.uom_id ? { [campoUom]: id(prod.uom_id) } : {}),
      }];
    });
    const ordenId = await ejecutar("purchase.order", "create", [{
      partner_id: id(p.partner_id),
      origin: origen,
      picking_type_id: id(p.picking_type_id),
      ...(refs.length ? { partner_ref: refs.join(", ") } : {}),
      ...(fecha ? { date_order: fecha } : {}),
      order_line: lineas,
    }]);
    [orden] = await ejecutar("purchase.order", "read", [[ordenId]], { fields: ["state", "order_line", "picking_ids"] });
  }

  if (["draft", "sent"].includes(orden.state)) {
    await ejecutar("purchase.order", "button_confirm", [[orden.id]]);
    [orden] = await ejecutar("purchase.order", "read", [[orden.id]], { fields: ["state", "order_line", "picking_ids"] });
  }
  if (!["purchase", "done"].includes(orden.state)) {
    throw new Error(`su orden de compra espera aprobación en Odoo (id ${orden.id}); apruébala y repite el script`);
  }

  // Cada movimiento viejo toma una línea de compra de su mismo producto que nadie use todavía.
  const lineas = await ejecutar("purchase.order.line", "search_read", [[["order_id", "=", orden.id]]], { fields: ["product_id"], order: "id" });
  const usadas = new Set(movs.map((m) => id(m.purchase_line_id)).filter(Boolean));
  for (const m of movs) {
    if (id(m.purchase_line_id)) continue;
    const linea = lineas.find((l) => id(l.product_id) === id(m.product_id) && !usadas.has(l.id));
    if (!linea) throw new Error(`no hay línea de compra para el producto ${m.product_id?.[1] ?? id(m.product_id)}`);
    usadas.add(linea.id);
    await ejecutar("stock.move", "write", [[m.id], { purchase_line_id: linea.id }]);
  }

  // La recepción nueva que armó Odoo ya no hace falta: lo recibido es lo de la vieja.
  const nuevas = await ejecutar("stock.picking", "read", [orden.picking_ids ?? []], { fields: ["state"] });
  for (const n of nuevas.filter((x) => !ps.some((r) => r.id === x.id) && !["done", "cancel"].includes(x.state))) {
    await ejecutar("stock.picking", "action_cancel", [[n.id]]);
  }

  // Comprobación: cada línea debe quedar recibida por lo que se recibió.
  const revisadas = await ejecutar("purchase.order.line", "read", [lineas.map((l) => l.id)], { fields: ["product_qty", "qty_received"] });
  const mal = revisadas.filter((l) => Number(l.qty_received) !== Number(l.product_qty));
  if (mal.length) throw new Error(`la orden ${orden.id} quedó con líneas sin recibir completas (${mal.map((l) => l.id).join(", ")})`);
  return orden.id;
}

let hechas = 0;
let fallidas = 0;
for (const c of porVincular.slice(0, limite)) {
  try {
    const orden = await vincular(c);
    hechas++;
    console.log(`  ✔ ${c.origen} → orden de compra ${orden}`);
  } catch (e) {
    fallidas++;
    console.error(`  ✘ ${c.origen}: ${e.message}`);
  }
}
console.log(`\nVinculadas: ${hechas}. Con error: ${fallidas}. Sin intentar: ${Math.max(0, porVincular.length - limite)}.`);
process.exit(fallidas ? 1 : 0);
