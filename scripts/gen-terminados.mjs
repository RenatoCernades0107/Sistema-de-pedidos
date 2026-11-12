/**
 * Genera la migración con los datos del catálogo de productos terminados a
 * partir del Excel de la empresa.
 *
 *   node scripts/gen-terminados.mjs
 *
 * Lee `supabase/seeds/productos_terminados.xlsx` (el modelo normalizado: una
 * hoja por tabla) y escribe `supabase/migrations/20261113000200_terminados_datos.sql`.
 * Solo sirve para la carga inicial: después el catálogo se mantiene desde
 * /configuracion, y volver a generar no actualiza una base ya migrada.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRADA = path.join(RAIZ, "supabase/seeds/productos_terminados.xlsx");
const SALIDA = path.join(RAIZ, "supabase/migrations/20261113000200_terminados_datos.sql");

/* ── Leer ───────────────────────────────────────────────────────────────── */

const valor = (c) => {
  let v = c?.value;
  if (v && typeof v === "object") {
    if ("result" in v) v = v.result;
    else if ("richText" in v) v = v.richText.map((r) => r.text).join("");
    else if ("text" in v) v = v.text;
    else if ("hyperlink" in v) v = v.hyperlink;
  }
  return v === null || v === undefined ? "" : String(v).trim();
};

const libro = new ExcelJS.Workbook();
await libro.xlsx.readFile(ENTRADA);

/** Las filas de una hoja como objetos, con la cabecera de claves. */
function hoja(nombre) {
  const ws = libro.getWorksheet(nombre);
  if (!ws) throw new Error(`El Excel no tiene la hoja "${nombre}".`);
  const cabecera = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => (cabecera[i] = valor(c)));
  const filas = [];
  ws.eachRow((fila, n) => {
    if (n === 1) return;
    const o = {};
    cabecera.forEach((k, i) => k && (o[k] = valor(fila.getCell(i))));
    if (Object.values(o).some(Boolean)) filas.push(o);
  });
  return filas;
}

const tipos = hoja("tipos_producto");
const productos = hoja("productos");
const medidas = hoja("medidas");
const espesores = hoja("espesores");
const segmentos = hoja("segmentos_mercado");
const materiales = hoja("materiales");
const colores = hoja("colores_acrilico");
const OPCIONES = [
  ["personalizacion", "personalizaciones", "producto_personalizacion", "id_personalizacion"],
  ["acabado", "acabados", "producto_acabado", "id_acabado"],
  ["complemento", "complementos", "producto_complemento", "id_complemento"],
];

/* ── La forma de cada producto ──────────────────────────────────────────── */

const tipoDe = new Map(tipos.map((t) => [t.id_tipo, t.codigo_tipo]));

/**
 * Cómo se estima el material, a partir del tipo y de cómo viene su primera
 * medida. Es un punto de partida: se corrige producto por producto en
 * /configuracion.
 */
function geometriaDe(p) {
  const tipo = tipoDe.get(p.id_tipo);
  const m = medidas.find((x) => x.codigo_producto === p.codigo);
  if (!m) return "manual";
  if (tipo === "LET") return "letras";
  if (m.diametro_cm) return "cilindro";
  if (!m.medida_1_cm || !m.medida_2_cm) return "manual";
  const tres = !!m.medida_3_cm;
  switch (tipo) {
    case "CAJ":
    case "ANF":
      return tres ? "caja_cerrada" : "manual";
    case "DSP":
    case "ALZ":
      return tres ? "caja_abierta" : "lamina";
    case "PAF":
    case "TAR":
      return tres ? "lamina_plegada" : "lamina";
    case "LTR":
      return "lamina";
    default:
      return "manual";
  }
}

/* ── Escribir ───────────────────────────────────────────────────────────── */

const t = (v) => (v === "" || v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const n = (v) => (v === "" || v === null || v === undefined || Number.isNaN(Number(v)) ? "null" : String(Number(v)));
const b = (v) => (/^s[ií]$/i.test(v) ? "true" : "false");

const valores = (filas) => filas.map((f) => `    (${f.join(", ")})`).join(",\n");

function insertar(tabla, columnas, filas) {
  if (!filas.length) return "";
  return `insert into public.${tabla} (${columnas.join(", ")}) values\n${valores(filas)};\n`;
}

const nombrePorId = (lista, id) => new Map(lista.map((x) => [x[id], x.nombre]));
const partes = [];

partes.push(
  insertar(
    "pt_tipos",
    ["codigo", "nombre", "orden"],
    tipos.map((x) => [t(x.codigo_tipo), t(x.nombre), n(x.id_tipo)]),
  ),
  insertar(
    "pt_productos",
    ["codigo", "codigo_original", "tipo", "nombre", "usos", "a_medida", "contacto_alimentario", "imagen_url", "notas", "geometria"],
    productos.map((p) => [
      t(p.codigo),
      t(p.codigo_original),
      t(tipoDe.get(p.id_tipo)),
      t(p.nombre),
      t(p.usos_referenciales),
      b(p.a_medida),
      t(p.apto_contacto_alimentario),
      // Las búsquedas de Google Imágenes no son la foto del producto.
      t(/google\.[a-z.]+\/search/.test(p.url_imagen_referencial) ? "" : p.url_imagen_referencial),
      t(p.notas),
      `${t(geometriaDe(p))}::public.pt_geometria`,
    ]),
  ),
  insertar(
    "pt_medidas",
    ["producto", "orden", "medida_1_cm", "medida_2_cm", "medida_3_cm", "diametro_cm", "altura_cm", "altura_max_cm", "formato", "estimado", "nota"],
    medidas.map((m) => [
      t(m.codigo_producto),
      n(m.orden),
      n(m.medida_1_cm),
      n(m.medida_2_cm),
      n(m.medida_3_cm),
      n(m.diametro_cm),
      n(m.altura_cm),
      n(m.altura_max_cm),
      t(m.formato),
      b(m.estimado),
      t(m.nota),
    ]),
  ),
  insertar(
    "pt_espesores",
    ["producto", "orden", "espesor_min_mm", "espesor_max_mm", "aplicacion", "material", "estimado", "nota"],
    espesores.map((e) => [
      t(e.codigo_producto),
      n(e.orden),
      n(e.espesor_min_mm),
      n(e.espesor_max_mm || e.espesor_min_mm),
      t(e.aplicacion),
      t(e.material),
      b(e.estimado),
      t(e.nota),
    ]),
  ),
  insertar("pt_colores", ["nombre"], colores.map((c) => [t(c.nombre)])),
  insertar("pt_materiales", ["nombre", "categoria"], materiales.map((m) => [t(m.nombre), t(m.categoria)])),
  insertar("pt_segmentos", ["nombre", "sector"], segmentos.map((s) => [t(s.nombre), t(s.sector)])),
);

for (const [clase, catalogo] of OPCIONES) {
  partes.push(
    insertar(
      "pt_opciones",
      ["clase", "nombre"],
      hoja(catalogo).map((o) => [`${t(clase)}::public.pt_clase_opcion`, t(o.nombre)]),
    ),
  );
}

/* Las relaciones se unen por nombre: los ids de la base los pone la base. */

const colorDe = nombrePorId(colores, "id_color");
partes.push(`insert into public.pt_producto_color (producto, color_id)
select d.producto, c.id
from (values
${valores(hoja("producto_color").map((r) => [t(r.codigo_producto), t(colorDe.get(r.id_color))]))}
) as d (producto, color)
join public.pt_colores c on c.nombre = d.color;
`);

for (const [clase, catalogo, relacion, id] of OPCIONES) {
  const nombres = nombrePorId(hoja(catalogo), id);
  // Un mismo producto puede repetir la opción con otro detalle: se queda una.
  const vistas = new Map();
  for (const r of hoja(relacion)) {
    const clave = `${r.codigo_producto}|${r[id]}`;
    const previa = vistas.get(clave);
    if (previa) {
      if (r.detalle_original && !previa.detalle.includes(r.detalle_original)) previa.detalle += ` · ${r.detalle_original}`;
      continue;
    }
    vistas.set(clave, {
      producto: r.codigo_producto,
      nombre: nombres.get(r[id]),
      // Solo los complementos dicen si son opcionales; lo demás siempre se elige.
      opcional: clase === "complemento" ? /^s[ií]$/i.test(r.opcional) : true,
      detalle: r.detalle_original ?? "",
    });
  }
  partes.push(`insert into public.pt_producto_opcion (producto, opcion_id, opcional, detalle)
select d.producto, o.id, d.opcional, d.detalle
from (values
${valores([...vistas.values()].map((r) => [t(r.producto), t(r.nombre), String(r.opcional), t(r.detalle)]))}
) as d (producto, nombre, opcional, detalle)
join public.pt_opciones o on o.clase = '${clase}' and o.nombre = d.nombre;
`);
}

const materialDe = nombrePorId(materiales, "id_material");
partes.push(`insert into public.pt_producto_material (producto, material_id, componente, opcional, especificacion)
select d.producto, m.id, d.componente, d.opcional, d.especificacion
from (values
${valores(
  hoja("producto_material").map((r) => [
    t(r.codigo_producto),
    t(materialDe.get(r.id_material)),
    t(r.componente),
    b(r.opcional),
    t(r.especificacion),
  ]),
)}
) as d (producto, material, componente, opcional, especificacion)
join public.pt_materiales m on m.nombre = d.material;
`);

const segmentoDe = nombrePorId(segmentos, "id_segmento");
partes.push(`insert into public.pt_producto_segmento (producto, segmento_id)
select distinct d.producto, s.id
from (values
${valores(hoja("producto_segmento").map((r) => [t(r.codigo_producto), t(segmentoDe.get(r.id_segmento))]))}
) as d (producto, segmento)
join public.pt_segmentos s on s.nombre = d.segmento;
`);

const cabecera = `-- Productos terminados: los datos del catálogo.
--
-- GENERADO por \`scripts/gen-terminados.mjs\` desde
-- \`supabase/seeds/productos_terminados.xlsx\` (${productos.length} productos en ${tipos.length} tipos).
-- No se edita a mano: el catálogo se mantiene desde /configuracion.
--
-- La forma de cada producto (\`geometria\`) sale del tipo y de su primera medida;
-- el factor de fabricación queda en 1 y el extra de cada opción en 0, hasta que
-- Administración los ponga.

`;

fs.writeFileSync(SALIDA, cabecera + partes.filter(Boolean).join("\n"));

const cuenta = productos.reduce((m, p) => {
  const g = geometriaDe(p);
  return m.set(g, (m.get(g) ?? 0) + 1);
}, new Map());
console.log(`${path.relative(RAIZ, SALIDA)}: ${productos.length} productos, ${medidas.length} medidas, ${espesores.length} espesores`);
console.log("geometría:", Object.fromEntries(cuenta));
