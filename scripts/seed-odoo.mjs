/**
 * Siembra el Odoo de PRUEBAS con productos y deja el seed de Supabase que les
 * corresponde (`supabase/seeds/cotizaciones.sql`).
 *
 *   npm run seed:odoo -- --dry-run      # lee los datos y muestra qué haría
 *   ODOO_SEED_OK=1 npm run seed:odoo    # siembra (lee .env.local)
 *   ODOO_SEED_OK=1 npm run seed:odoo -- --stock   # además, pone stock
 *
 * Productos: del Excel `supabase/seeds/productos.xlsx` (o `productos.csv`) si
 * existe; si no, de `seed-odoo-datos.mjs`. Se puede re-ejecutar: busca por
 * `default_code` y actualiza en vez de duplicar.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CATEGORIAS, CLIENTES, COTIZACIONES, EXTRAS, PRECIOS_ACCESORIOS, planchasDeLaMigracion } from "./seed-odoo-datos.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEEDS = path.join(RAIZ, "supabase/seeds");
const SALIDA_SQL = path.join(SEEDS, "cotizaciones.sql");
const args = new Set(process.argv.slice(2));
const SECO = args.has("--dry-run");
const CON_STOCK = args.has("--stock");

/* ── 1. Productos: Excel o respaldo ─────────────────────────────────────── */

const normal = (s) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

const COLUMNAS = {
  codigo: ["codigo odoo", "codigo", "referencia", "default_code", "sku"],
  nombre: ["nombre del servicio", "nombre", "producto", "name"],
  material: ["material"],
  medida: ["medida"],
  variante: ["variante"],
  detalle: ["detalle"],
  ancho: ["ancho"],
  largo: ["largo"],
  espesor: ["espesor"],
  precio: ["precio", "pvp", "lst_price", "list_price"],
  unidad: ["unidad", "uom"],
  categoria: ["categoria"],
  alerta: ["alerta"],
  nota: ["nota"],
};

function columnas(cabecera) {
  const h = cabecera.map(normal);
  const idx = {};
  for (const [campo, alias] of Object.entries(COLUMNAS)) {
    const exacta = alias.map((a) => h.indexOf(a)).find((i) => i >= 0);
    idx[campo] = exacta ?? h.findIndex((c) => alias.some((a) => c.startsWith(a)));
  }
  if (idx.codigo < 0) throw new Error(`no tiene columna de código (cabecera: ${cabecera.join(" | ")})`);
  if (idx.nombre < 0 && idx.material < 0) throw new Error("no tiene columna de nombre ni de material");
  return idx;
}

/** `-` y vacío son "nada". */
const celda = (v) => {
  const s = String(v ?? "").trim();
  return s === "-" ? "" : s;
};

/** Mayúsculas y sin tildes (la Ñ se queda), como nombra la empresa en Odoo. */
const mayus = (s) => s.toUpperCase().normalize("NFD").replace(/[̀́̈]/g, "").normalize("NFC");

/** Erratas conocidas del Excel, para no llevarlas a Odoo. */
const ERRATAS = [[/\bINTALACION\b/g, "INSTALACION"]];

function categoriaDe(hoja, texto) {
  const t = normal(texto || hoja);
  if (t.startsWith("serv")) return "Servicios";
  if (t.startsWith("acces")) return "Accesorios";
  if (t.startsWith("plancha")) return "Planchas";
  return String(texto || hoja).trim() || "Materiales";
}

function precioEstimado(categoria, material, nombre, ancho, largo, espesor) {
  if (categoria === "Planchas" && ancho && largo && espesor) return Math.round((ancho / 100) * (largo / 100) * espesor * 22);
  if (categoria === "Servicios") return /INSTALACION/.test(nombre) ? 80 : 1;
  const m = normal(material);
  const hit = Object.entries(PRECIOS_ACCESORIOS).find(([k]) => m.startsWith(k));
  return hit ? hit[1] : 10;
}

/** Una fila = un producto. */
function deFilas(filas, hoja, avisos) {
  const [cab, ...resto] = filas;
  const i = columnas(cab);
  const v = (f, campo) => (i[campo] >= 0 ? celda(f[i[campo]]) : "");
  const out = [];
  resto.forEach((f, n) => {
    const codigo = v(f, "codigo");
    if (!f.some((x) => celda(x))) return;
    if (!codigo) return avisos.push(`hoja "${hoja}", fila ${n + 2}: sin código, no se carga`);
    const categoria = categoriaDe(hoja, v(f, "categoria"));
    const [ancho, largo, espesor] = ["ancho", "largo", "espesor"].map((c) => Number(v(f, c)) || 0);
    let nombre = v(f, "nombre");
    if (!nombre) {
      const partes = [v(f, "material"), v(f, "medida"), v(f, "variante"), v(f, "detalle")];
      if (espesor) partes.push(`${espesor}MM`);
      if (ancho && largo) partes.push(`${(ancho / 100).toFixed(2)}X${(largo / 100).toFixed(2)}`);
      nombre = partes.filter(Boolean).join(" ");
    }
    nombre = ERRATAS.reduce((s, [re, bien]) => s.replace(re, bien), mayus(nombre).replace(/\s+/g, " "));
    const precioCelda = v(f, "precio");
    const precio = precioCelda
      ? Number(precioCelda.replace(/[^\d.,-]/g, "").replace(",", ".")) || 0
      : precioEstimado(categoria, v(f, "material"), nombre, ancho, largo, espesor);
    const descripcion = [v(f, "alerta") && `Alerta de stock: ${v(f, "alerta")}`, v(f, "nota")].filter(Boolean).join("\n");
    out.push({
      codigo, nombre, precio, categoria, hoja,
      unidad: v(f, "unidad") || "Unidades",
      servicio: categoria === "Servicios",
      ...(descripcion ? { descripcion } : {}),
    });
  });
  return out;
}

function leerCsv(texto) {
  const sep = (texto.split("\n")[0].match(/;/g) ?? []).length > (texto.split("\n")[0].match(/,/g) ?? []).length ? ";" : ",";
  const filas = [];
  let fila = [], campo = "", comillas = false;
  for (let k = 0; k < texto.length; k++) {
    const c = texto[k];
    if (comillas) {
      if (c === '"' && texto[k + 1] === '"') { campo += '"'; k++; }
      else if (c === '"') comillas = false;
      else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) { fila.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[k + 1] === "\n") k++;
      fila.push(campo); campo = "";
      if (fila.some((x) => x.trim())) filas.push(fila);
      fila = [];
    } else campo += c;
  }
  fila.push(campo);
  if (fila.some((x) => x.trim())) filas.push(fila);
  return filas;
}

async function leerExcel(archivo) {
  const { default: ExcelJS } = await import("exceljs");
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.readFile(archivo);
  const productos = [];
  const avisos = [];
  const hojas = [];
  for (const hoja of libro.worksheets) {
    const filas = [];
    hoja.eachRow((r) => filas.push(r.values.slice(1).map((v) => (v && typeof v === "object" ? v.result ?? v.text ?? "" : v))));
    if (filas.length < 2) continue;
    try {
      const de = deFilas(filas, hoja.name, avisos);
      hojas.push(`${hoja.name}: ${de.length}`);
      productos.push(...de);
    } catch (e) {
      avisos.push(`hoja "${hoja.name}" ignorada: ${e.message}`);
    }
  }
  return { productos, avisos, hojas };
}

async function cargarProductos() {
  const planchasCatalogo = planchasDeLaMigracion(RAIZ);
  const xlsx = path.join(SEEDS, "productos.xlsx");
  const csv = path.join(SEEDS, "productos.csv");
  let productos, fuente, avisos = [], hojas = [];
  if (fs.existsSync(xlsx)) {
    ({ productos, avisos, hojas } = await leerExcel(xlsx));
    fuente = path.relative(RAIZ, xlsx);
  } else if (fs.existsSync(csv)) {
    productos = deFilas(leerCsv(fs.readFileSync(csv, "utf8")), "Materiales", avisos);
    fuente = path.relative(RAIZ, csv);
  } else {
    const porCodigo = new Map([...planchasCatalogo, ...EXTRAS].map((p) => [p.codigo, p]));
    productos = [...porCodigo.values()];
    fuente = null;
  }

  if (fuente) {
    console.log(`Productos leídos de ${fuente}: ${productos.length} (${hojas.join(" · ") || "1 hoja"})`);
    const veces = Object.entries(Object.groupBy(productos, (p) => p.codigo)).filter(([, v]) => v.length > 1);
    for (const [c, v] of veces) {
      avisos.push(`el código ${c} está en ${v.length} filas: se crean ${v.length} productos con el mismo código (${v.map((p) => p.nombre).join(" / ")})`);
    }
    const llaves = Object.entries(Object.groupBy(productos, llave)).filter(([, v]) => v.length > 1);
    for (const [k] of llaves) avisos.push(`fila repetida (mismo código y nombre), se carga una vez: ${k}`);
    productos = [...new Map(productos.map((p) => [llave(p), p])).values()];
    for (const a of avisos) console.warn(`  ! ${a}`);
    const enExcel = new Set(productos.map((p) => p.codigo));
    const faltan = planchasCatalogo.filter((p) => !enExcel.has(p.codigo));
    if (faltan.length) {
      console.warn(`  ! ${faltan.length} códigos del catálogo de cortes no están en el Excel: ${faltan.slice(0, 15).map((p) => p.codigo).join(", ")}${faltan.length > 15 ? "…" : ""}`);
    }
    const catalogo = new Set(planchasCatalogo.map((p) => p.codigo));
    const sueltos = productos.filter((p) => p.categoria === "Planchas" && !catalogo.has(p.codigo));
    if (sueltos.length) console.warn(`  ! ${sueltos.length} planchas del Excel no están en el catálogo de cortes.`);
  } else {
    console.log(`No hay supabase/seeds/productos.xlsx ni .csv: uso los datos de respaldo (${productos.length} productos).`);
  }
  return productos;
}

/** Un producto es su código + su nombre: el Excel repite códigos (ACC001). */
const llave = (p) => `${p.codigo}|${p.nombre}`;

/* ── 2. Odoo por JSON-RPC ───────────────────────────────────────────────── */

let idRpc = 0;
async function rpc(url, service, method, rpcArgs) {
  const res = await fetch(`${url.replace(/\/+$/, "")}/jsonrpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "call", id: ++idRpc, params: { service, method, args: rpcArgs } }),
  });
  if (!res.ok) throw new Error(`Odoo respondió HTTP ${res.status}`);
  const cuerpo = await res.json();
  if (cuerpo.error) throw new Error(cuerpo.error.data?.message ?? cuerpo.error.message);
  return cuerpo.result;
}

async function conectar() {
  const { ODOO_URL: url, ODOO_DB: db, ODOO_USERNAME: user, ODOO_PASSWORD: clave } = process.env;
  if (!url || !db || !user || !clave) throw new Error("Faltan ODOO_URL, ODOO_DB, ODOO_USERNAME u ODOO_PASSWORD.");
  console.log(`Odoo: ${url}  base: ${db}`);
  if (process.env.ODOO_SEED_OK !== "1") {
    throw new Error("Por seguridad no siembro sin ODOO_SEED_OK=1. Revisa que la base de arriba sea la de PRUEBAS.");
  }
  const uid = await rpc(url, "common", "authenticate", [db, user, clave, {}]);
  if (!uid) throw new Error("Odoo rechazó el usuario o la contraseña.");
  const x = (modelo, metodo, a = [], kw = {}) => rpc(url, "object", "execute_kw", [db, uid, clave, modelo, metodo, a, kw]);
  return x;
}

async function sembrarOdoo(x, productos) {
  // Categorías
  const categorias = new Map();
  for (const nombre of new Set([...CATEGORIAS, ...productos.map((p) => p.categoria)])) {
    const [hay] = await x("product.category", "search", [[["name", "=", nombre]]], { limit: 1 });
    categorias.set(nombre, hay ?? (await x("product.category", "create", [{ name: nombre }])));
  }

  // Unidades (si no existe la del Excel, queda la de Odoo por defecto)
  const unidades = new Map();
  const uomDe = async (nombre) => {
    if (!unidades.has(nombre)) {
      let id = null;
      try { [id] = await x("uom.uom", "search", [[["name", "=ilike", nombre]]], { limit: 1 }); } catch { /* sin uom */ }
      unidades.set(nombre, id ?? null);
    }
    return unidades.get(nombre);
  };

  // Tipo de producto: Odoo 17 usa `detailed_type`; 18+ `type` + `is_storable`.
  const campos = Object.keys(await x("product.template", "fields_get", [], { attributes: ["type"] }));
  const tipo = (servicio) =>
    servicio ? (campos.includes("detailed_type") ? { detailed_type: "service" } : { type: "service" })
    : campos.includes("is_storable") ? { type: "consu", is_storable: true }
    : campos.includes("detailed_type") ? { detailed_type: "product" }
    : {};

  const repetidos = new Map();
  for (const p of productos) repetidos.set(p.codigo, (repetidos.get(p.codigo) ?? 0) + 1);

  let creados = 0, actualizados = 0;
  for (const p of productos) {
    const vals = {
      name: p.nombre, default_code: p.codigo, list_price: p.precio, sale_ok: true,
      categ_id: categorias.get(p.categoria), ...tipo(p.servicio),
    };
    const uom = p.unidad !== "Unidades" ? await uomDe(p.unidad) : null;
    if (uom) Object.assign(vals, { uom_id: uom, ...(campos.includes("uom_po_id") ? { uom_po_id: uom } : {}) });
    if (p.descripcion) vals.description = p.descripcion;
    // Código + nombre; si el código es único en el Excel, basta el código (así
    // un producto renombrado en el Excel se actualiza en vez de duplicarse).
    const todos = ["active", "in", [true, false]];
    let [id] = await x("product.template", "search", [[["default_code", "=", p.codigo], ["name", "=", p.nombre], todos]], { limit: 1 });
    if (!id && repetidos.get(p.codigo) === 1) {
      [id] = await x("product.template", "search", [[["default_code", "=", p.codigo], todos]], { limit: 1 });
    }
    if (id) { await x("product.template", "write", [[id], { ...vals, active: true }]); actualizados++; }
    else { await x("product.template", "create", [vals]); creados++; }
  }
  console.log(`Productos: ${creados} creados, ${actualizados} actualizados.`);

  // Las variantes, que es lo que usan la app y Supabase.
  const variantes = new Map();
  const codigos = productos.map((p) => p.codigo);
  for (let i = 0; i < codigos.length; i += 500) {
    const filas = await x("product.product", "search_read", [[["default_code", "in", codigos.slice(i, i + 500)]]],
      { fields: ["default_code", "display_name", "name", "lst_price"], order: "id" });
    // Por código + nombre, y por código solo (el primero) para las cotizaciones.
    for (const f of filas) {
      variantes.set(`${f.default_code}|${f.name}`, f);
      if (!variantes.has(f.default_code)) variantes.set(f.default_code, f);
    }
  }

  if (CON_STOCK) {
    try { await ponerStock(x, productos, variantes); }
    catch (e) { console.warn(`  ! No pude poner stock (¿falta el módulo Inventario?): ${e.message}`); }
  }
  return variantes;
}

async function ponerStock(x, productos, variantes) {
  const [ubicacion] = await x("stock.location", "search", [[["usage", "=", "internal"]]], { limit: 1 });
  if (!ubicacion) return console.warn("  ! Sin ubicación interna: no pongo stock.");
  let n = 0;
  for (const p of productos) {
    const v = variantes.get(llave(p));
    if (!v || p.servicio) continue;
    // Determinista para que re-ejecutar no cambie los números.
    const qty = [...p.codigo].reduce((s, c) => s + c.charCodeAt(0), 0) % 15;
    try {
      const [q] = await x("stock.quant", "search", [[["product_id", "=", v.id], ["location_id", "=", ubicacion]]], { limit: 1 });
      const id = q ?? (await x("stock.quant", "create", [{ product_id: v.id, location_id: ubicacion, inventory_quantity: qty }]));
      if (q) await x("stock.quant", "write", [[q], { inventory_quantity: qty }]);
      await x("stock.quant", "action_apply_inventory", [[id]]);
      n++;
    } catch (e) {
      console.warn(`  ! stock de ${p.codigo}: ${e.message}`);
    }
  }
  console.log(`Stock puesto en ${n} productos.`);
}

async function sembrarClientes(x) {
  const ids = new Map();
  for (const c of CLIENTES) {
    const [hay] = await x("res.partner", "search", [[["name", "=", c.name]]], { limit: 1 });
    const vals = { name: c.name, vat: c.vat, phone: c.phone, is_company: c.is_company };
    ids.set(c.ref, { ...c, id: hay ?? (await x("res.partner", "create", [vals])) });
  }
  return ids;
}

/** sale.order por cotización, buscada por `origin` para no duplicar. */
async function sembrarOrdenes(x, clientes, variantes) {
  const ordenes = new Map();
  for (const cot of COTIZACIONES) {
    if (cot.estado !== "sincronizada" && cot.estado !== "confirmada") continue;
    const [hay] = await x("sale.order", "search_read", [[["origin", "=", cot.ref]]],
      { fields: ["name", "amount_untaxed", "amount_tax", "amount_total", "state"], limit: 1 });
    let orden = hay;
    if (!orden) {
      const lineas = cot.lineas.filter(([c]) => variantes.has(c)).map(([c, qty, desc]) => {
        const v = variantes.get(c);
        return [0, 0, { product_id: v.id, product_uom_qty: qty, price_unit: v.lst_price, ...(desc ? { name: `${v.display_name}\n${desc}` } : {}) }];
      });
      const id = await x("sale.order", "create", [{ partner_id: clientes.get(cot.cliente).id, origin: cot.ref, order_line: lineas }]);
      [orden] = await x("sale.order", "read", [[id]], { fields: ["name", "amount_untaxed", "amount_tax", "amount_total", "state"] });
    }
    if (cot.estado === "confirmada" && (orden.state === "draft" || orden.state === "sent")) {
      await x("sale.order", "action_confirm", [[orden.id]]);
    }
    ordenes.set(cot.ref, orden);
  }
  return ordenes;
}

/* ── 3. El seed de Supabase ─────────────────────────────────────────────── */

const q = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);

function generarSql(clientes, variantes, ordenes) {
  const out = [
    "-- Cotizaciones de ejemplo. GENERADO por scripts/seed-odoo.mjs a partir de lo que",
    "-- devolvió el Odoo de pruebas (ids de clientes, productos y sale.order). No se",
    "-- edita a mano: se vuelve a generar sembrando Odoo.",
    "--",
    "-- Va después de seed.sql (usa a Ana como autora). Se puede correr varias veces:",
    "-- cada cotización se salta si ya existe una con su misma nota de origen.",
    "",
  ];
  for (const cot of COTIZACIONES) {
    const cli = clientes.get(cot.cliente);
    const orden = ordenes.get(cot.ref);
    const lineas = cot.lineas.filter(([c]) => {
      if (!variantes.has(c)) console.warn(`  ! ${cot.ref}: el producto ${c} no está en Odoo, la línea se omite.`);
      return variantes.has(c);
    });
    if (!lineas.length) continue;
    const base = lineas.reduce((s, [c, qty]) => s + qty * variantes.get(c).lst_price, 0);
    const r2 = (n) => Math.round(n * 100) / 100;
    const montos = orden
      ? [orden.amount_untaxed, orden.amount_tax, orden.amount_total]
      : [r2(base), r2(base * 0.18), r2(base * 1.18)];
    const sinc = orden ? "sincronizada" : cot.estado === "error" ? "error" : "pendiente";
    const marca = `[${cot.ref}]`;
    const notas = [marca, cot.notas].filter(Boolean).join(" ");
    out.push(
      `with c as (`,
      `  insert into public.cotizaciones (`,
      `    odoo_partner_id, cliente_nombre, cliente_documento, cliente_telefono,`,
      `    odoo_order_id, odoo_order_name, sincronizacion, error_sincronizacion,`,
      `    monto_sin_impuestos, monto_impuestos, monto_total, notas, confirmada_en_odoo,`,
      `    creado_por, creado_en`,
      `  )`,
      `  select ${cli.id}, ${q(cli.name)}, ${q(cli.vat)}, ${q(cli.phone)},`,
      `    ${orden ? orden.id : "null"}, ${q(orden?.name)}, '${sinc}', ${q(sinc === "error" ? cot.error : null)},`,
      `    ${montos.join(", ")}, ${q(notas)}, ${cot.estado === "confirmada" && orden ? "true" : "false"},`,
      `    (select id from public.usuarios where email = 'ana@plexiacril.test'),`,
      `    now() - interval '${cot.dias} days'`,
      `  where not exists (select 1 from public.cotizaciones where notas like ${q(marca + "%")})`,
      `  returning id`,
      `)`,
      `insert into public.cotizacion_productos (cotizacion_id, posicion, odoo_product_id, producto_nombre, producto_codigo, descripcion, cantidad, precio_unitario)`,
      `select c.id, l.* from c, (values`,
      lineas.map(([c, qty, desc], i) => {
        const v = variantes.get(c);
        const nombre = String(v.display_name ?? v.name).replace(/^\[[^\]]*\]\s*/, "");
        return `  (${i + 1}, ${v.id}, ${q(nombre)}, ${q(c.split("|")[0])}, ${q(desc ?? null)}, ${qty}, ${v.lst_price})`;
      }).join(",\n"),
      `) as l(posicion, odoo_product_id, producto_nombre, producto_codigo, descripcion, cantidad, precio_unitario);`,
      "",
    );
  }
  fs.mkdirSync(SEEDS, { recursive: true });
  fs.writeFileSync(SALIDA_SQL, out.join("\n"));
  console.log(`Seed de Supabase escrito en ${path.relative(RAIZ, SALIDA_SQL)}.`);
}

/* ── main ───────────────────────────────────────────────────────────────── */

const productos = await cargarProductos();
const porCategoria = Object.entries(Object.groupBy(productos, (p) => p.categoria)).map(([k, v]) => `${k}: ${v.length}`);
console.log(`  ${porCategoria.join(" · ")}`);

if (SECO) {
  for (const [cat, lista] of Object.entries(Object.groupBy(productos, (p) => p.categoria))) {
    console.log(`\n  ${cat} (${lista.length})`);
    for (const p of lista.slice(0, 5)) console.log(`    ${p.codigo.padEnd(10)} S/ ${String(p.precio).padStart(5)}  ${p.nombre}`);
    if (lista.length > 5) console.log(`    … y ${lista.length - 5} más`);
  }
  const faltan = COTIZACIONES.flatMap((c) => c.lineas.map(([k]) => k))
    .filter((k) => !productos.some((p) => p.codigo === k || llave(p) === k));
  if (faltan.length) console.warn(`  ! las cotizaciones de ejemplo citan productos que no están: ${[...new Set(faltan)].join(", ")}`);
  console.log(`  … (--dry-run: no me conecto a Odoo ni escribo el SQL)`);
} else {
  const x = await conectar();
  const variantes = await sembrarOdoo(x, productos);
  const clientes = await sembrarClientes(x);
  const ordenes = await sembrarOrdenes(x, clientes, variantes);
  generarSql(clientes, variantes, ordenes);
  console.log("Listo. Para Supabase: `npx supabase db reset` en local, o corre supabase/seeds/cotizaciones.sql en el SQL Editor.");
}
