/**
 * Diagnóstico (solo lectura): ¿qué tipos de documento tiene el Odoo y cuál
 * elegiría la app para un DNI? Sirve cuando crear un cliente con DNI falla con
 * "The RUC number [...] does not seem to be valid".
 *
 *   npm run odoo:tipos-doc      # lee .env.local
 */
const { ODOO_URL, ODOO_DB, ODOO_USERNAME, ODOO_PASSWORD } = process.env;
if (!ODOO_URL || !ODOO_DB || !ODOO_USERNAME || !ODOO_PASSWORD) {
  console.error("Faltan ODOO_URL, ODOO_DB, ODOO_USERNAME u ODOO_PASSWORD (.env.local).");
  process.exit(1);
}

async function rpc(service, method, args) {
  const r = await fetch(`${ODOO_URL.replace(/\/+$/, "")}/jsonrpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "call", id: 1, params: { service, method, args } }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.data?.message ?? j.error.message);
  return j.result;
}

const uid = await rpc("common", "authenticate", [ODOO_DB, ODOO_USERNAME, ODOO_PASSWORD, {}]);
const call = (modelo, metodo, args, kw = {}) =>
  rpc("object", "execute_kw", [ODOO_DB, uid, ODOO_PASSWORD, modelo, metodo, args, kw]);

const MODELO = "l10n_latam.identification.type";
const hay = await call("ir.model", "search_count", [[["model", "=", MODELO]]]);
if (!hay) {
  console.log(`El modelo ${MODELO} NO existe: la localización latinoamericana no está instalada.`);
  process.exit(0);
}

const campos = Object.keys(await call(MODELO, "fields_get", [], { attributes: ["type"] }));
const fields = ["name", "l10n_pe_vat_code", "is_vat", "active", "country_id"].filter((c) => campos.includes(c));
const filas = await call(MODELO, "search_read", [[["active", "in", [true, false]]]], { fields });
console.table(filas.map((f) => ({ ...f, country_id: Array.isArray(f.country_id) ? f.country_id[1] : f.country_id })));

const activas = filas.filter((f) => f.active !== false);
const dni = activas.find((f) => f.l10n_pe_vat_code === "1") ?? activas.find((f) => /DNI/i.test(f.name));
console.log(dni ? `Para un DNI la app usaría: id ${dni.id} "${dni.name}" (is_vat=${dni.is_vat}).` : "No hay un tipo DNI activo.");
