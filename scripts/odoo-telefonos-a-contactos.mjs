/**
 * Las empresas de Odoo que tienen teléfono o correo pero ninguna persona de
 * contacto: les crea una, "Contacto principal", con ese teléfono y ese correo.
 *
 *   npm run odoo:telefonos-a-contactos                      # solo lista: no toca nada
 *   npm run odoo:telefonos-a-contactos -- --aplicar         # crea los contactos
 *   npm run odoo:telefonos-a-contactos -- --aplicar --limite 20
 *
 * Es no destructivo: COPIA el teléfono y el correo al contacto; la empresa los
 * conserva (la app los usa de respaldo mientras la empresa no tenga contactos
 * con teléfono). Se puede repetir: una empresa que ya tiene contactos se salta.
 * El nombre "Contacto principal" es un marcador: cámbialo en Odoo por el de la
 * persona real.
 *
 * Lee ODOO_URL, ODOO_DB, ODOO_USERNAME y ODOO_PASSWORD de .env.local. Ojo: eso es
 * el Odoo de producción; corre primero sin --aplicar y mira la lista.
 */
const { ODOO_URL, ODOO_DB, ODOO_USERNAME, ODOO_PASSWORD } = process.env;
if (!ODOO_URL || !ODOO_DB || !ODOO_USERNAME || !ODOO_PASSWORD) {
  console.error("Faltan ODOO_URL, ODOO_DB, ODOO_USERNAME u ODOO_PASSWORD (.env.local).");
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
    // Una página HTML en vez de JSON: casi siempre es la URL equivocada.
    console.error(
      `Odoo no contestó JSON en ${URL_RPC} (HTTP ${r.status}${r.redirected ? `, redirigido a ${r.url}` : ""}).\n` +
        `Empieza con: ${texto.slice(0, 80).replace(/\s+/g, " ")}\n` +
        "Revisa ODOO_URL en .env.local: debe ser solo el origen (https://empresa.odoo.com), sin /odoo ni /web.",
    );
    process.exit(1);
  }
  if (j.error) throw new Error(j.error.data?.message ?? j.error.message);
  return j.result;
}

const uid = await rpc("common", "authenticate", [ODOO_DB, ODOO_USERNAME, ODOO_PASSWORD, {}]);
const call = (modelo, metodo, a, kw = {}) =>
  rpc("object", "execute_kw", [ODOO_DB, uid, ODOO_PASSWORD, modelo, metodo, a, kw]);

const MODELO = "res.partner";
const campos = Object.keys(await call(MODELO, "fields_get", [], { attributes: ["type"] }));
const tiene = (c) => campos.includes(c);
console.log(`Campos de ${MODELO}: function=${tiene("function")} mobile=${tiene("mobile")} type=${tiene("type")}`);
if (!tiene("parent_id")) {
  console.error("res.partner no tiene parent_id: este Odoo no sirve para esto.");
  process.exit(1);
}

const contactoDe = (e) => ({ phone: e.phone || e.mobile || false, email: e.email || false });
const conDato = (e) => !!(e.phone || e.mobile || e.email);

const empresas = await call(
  MODELO,
  "search_read",
  [[["is_company", "=", true], ["parent_id", "=", false]]],
  { fields: ["name", "vat", "phone", "email", ...(tiene("mobile") ? ["mobile"] : [])], order: "id" },
);

const conDatos = empresas.filter(conDato);
const idsConDatos = conDatos.map((e) => e.id);
// Las que ya tienen una persona de contacto: no se tocan.
const hijos = idsConDatos.length
  ? await call(MODELO, "search_read", [[["parent_id", "in", idsConDatos], ...(tiene("type") ? [["type", "=", "contact"]] : [])]], {
      fields: ["parent_id"],
    })
  : [];
const yaTienen = new Set(hijos.map((h) => h.parent_id[0]));
const pendientes = conDatos.filter((e) => !yaTienen.has(e.id)).slice(0, limite);

console.log(
  `${empresas.length} empresas · ${conDatos.length} con teléfono o correo · ` +
    `${yaTienen.size} ya tienen contactos · ${pendientes.length} por migrar${aplicar ? "" : " (simulacro)"}`,
);
console.table(pendientes.map((e) => ({ id: e.id, empresa: e.name, vat: e.vat || "", ...contactoDe(e) })));

if (!aplicar) {
  console.log("No se cambió nada. Para crear los contactos: agrega --aplicar.");
  process.exit(0);
}

let creados = 0;
for (const e of pendientes) {
  try {
    const valores = { name: "Contacto principal", parent_id: e.id, is_company: false, ...(tiene("type") ? { type: "contact" } : {}) };
    const { phone, email } = contactoDe(e);
    if (phone) valores.phone = phone;
    if (email) valores.email = email;
    await call(MODELO, "create", [valores]);
    creados++;
  } catch (err) {
    console.error(`  ✗ ${e.name} (${e.id}): ${err.message}`);
  }
}
console.log(`Listo: ${creados} contactos creados de ${pendientes.length}.`);
