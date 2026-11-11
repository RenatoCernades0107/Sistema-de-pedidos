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
import { CATEGORIAS, CLIENTES, COTIZACIONES, EXTRAS, planchasDeLaMigracion } from "./seed-odoo-datos.mjs";

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
  codigo: ["codigo odoo", "codigo", "referencia", "ref", "default_code", "sku", "cod"],
  nombre: ["nombre", "descripcion", "producto", "name", "detalle"],
  precio: ["precio", "precio venta", "precio de venta", "pvp", "lst_price", "list_price", "precio unitario"],
  categoria: ["categoria", "tipo", "familia", "linea"],
  unidad: ["unidad", "uom", "unidad de medida", "um"],
};

function columnas(cabecera) {
  const h = cabecera.map(normal);
  const idx = {};
  for (const [campo, alias] of Object.entries(COLUMNAS)) {
    idx[campo] = alias.map((a) => h.indexOf(a)).find((i) => i >= 0)
      ?? h.findIndex((c) => alias.some((a) => c.startsWith(a)));
  }
  if (idx.codigo < 0 || idx.nombre < 0) {
    throw new Error(`El Excel necesita columnas de código y nombre. Cabecera leída: ${cabecera.join(" | ")}`);
  }
  return idx;
}

function categoriaDe(texto, codigo) {
  const t = normal(texto);
  if (t.includes("serv") || /^SRV/i.test(codigo)) return "Servicios";
  if (t.includes("acces")) return "Accesorios";
  if (t.includes("plancha")) return "Planchas";
  return texto ? String(texto).trim() : "Materiales";
}

function deFilas(filas) {
  const [cab, ...resto] = filas;
  const i = columnas(cab);
  const out = new Map();
  for (const f of resto) {
    const codigo = String(f[i.codigo] ?? "").trim();
    const nombre = String(f[i.nombre] ?? "").trim();
    if (!codigo || !nombre) continue;
    const precio = Number(String(f[i.precio] ?? "0").replace(/[^\d.,-]/g, "").replace(",", ".")) || 0;
    const categoria = categoriaDe(i.categoria >= 0 ? f[i.categoria] : "", codigo);
    out.set(codigo, {
      codigo, nombre, precio, categoria,
      unidad: (i.unidad >= 0 && String(f[i.unidad] ?? "").trim()) || "Unidades",
      servicio: categoria === "Servicios",
    });
  }
  return [...out.values()];
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
  for (const hoja of libro.worksheets) {
    const filas = [];
    hoja.eachRow((r) => filas.push(r.values.slice(1).map((v) => (v && typeof v === "object" ? v.result ?? v.text ?? "" : v))));
    if (filas.length < 2) continue;
    try {
      productos.push(...deFilas(filas));
    } catch (e) {
      console.warn(`  · hoja "${hoja.name}" ignorada: ${e.message}`);
    }
  }
  return productos;
}

async function cargarProductos() {
  const planchasCatalogo = planchasDeLaMigracion(RAIZ);
  const xlsx = path.join(SEEDS, "productos.xlsx");
  const csv = path.join(SEEDS, "productos.csv");
  let productos, fuente;
  if (fs.existsSync(xlsx)) {
    productos = await leerExcel(xlsx);
    fuente = path.relative(RAIZ, xlsx);
  } else if (fs.existsSync(csv)) {
    productos = deFilas(leerCsv(fs.readFileSync(csv, "utf8")));
    fuente = path.relative(RAIZ, csv);
  } else {
    const porCodigo = new Map([...planchasCatalogo, ...EXTRAS].map((p) => [p.codigo, p]));
    productos = [...porCodigo.values()];
    fuente = null;
  }

  if (fuente) {
    console.log(`Productos leídos de ${fuente}: ${productos.length}`);
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

  let creados = 0, actualizados = 0;
  for (const p of productos) {
    const vals = {
      name: p.nombre, default_code: p.codigo, list_price: p.precio, sale_ok: true,
      categ_id: categorias.get(p.categoria), ...tipo(p.servicio),
    };
    const uom = p.unidad !== "Unidades" ? await uomDe(p.unidad) : null;
    if (uom) Object.assign(vals, { uom_id: uom, ...(campos.includes("uom_po_id") ? { uom_po_id: uom } : {}) });
    const [id] = await x("product.template", "search", [[["default_code", "=", p.codigo], ["active", "in", [true, false]]]], { limit: 1 });
    if (id) { await x("product.template", "write", [[id], { ...vals, active: true }]); actualizados++; }
    else { await x("product.template", "create", [vals]); creados++; }
  }
  console.log(`Productos: ${creados} creados, ${actualizados} actualizados.`);

  // Las variantes, que es lo que usan la app y Supabase.
  const variantes = new Map();
  const codigos = productos.map((p) => p.codigo);
  for (let i = 0; i < codigos.length; i += 500) {
    const filas = await x("product.product", "search_read", [[["default_code", "in", codigos.slice(i, i + 500)]]],
      { fields: ["default_code", "display_name", "name", "lst_price"] });
    for (const f of filas) variantes.set(f.default_code, f);
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
    const v = variantes.get(p.codigo);
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
        return `  (${i + 1}, ${v.id}, ${q(nombre)}, ${q(c)}, ${q(desc ?? null)}, ${qty}, ${v.lst_price})`;
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
  for (const p of productos.slice(0, 10)) console.log(`  ${p.codigo.padEnd(12)} ${p.nombre}  S/ ${p.precio}`);
  console.log(`  … (--dry-run: no me conecto a Odoo ni escribo el SQL)`);
} else {
  const x = await conectar();
  const variantes = await sembrarOdoo(x, productos);
  const clientes = await sembrarClientes(x);
  const ordenes = await sembrarOrdenes(x, clientes, variantes);
  generarSql(clientes, variantes, ordenes);
  console.log("Listo. Para Supabase: `npx supabase db reset` en local, o corre supabase/seeds/cotizaciones.sql en el SQL Editor.");
}
