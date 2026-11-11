/**
 * Datos del seed de productos para el Odoo de PRUEBAS.
 *
 * La fuente buena es el Excel de la empresa (`supabase/seeds/productos.xlsx` o
 * `.csv`): si está, manda. Esto es el respaldo para que el seed funcione sin él:
 *   - las planchas, sacadas de la migración del catálogo de cortes (los mismos
 *     `codigo_odoo` que busca la app), con un precio estimado;
 *   - materiales, accesorios y servicios inventados pero verosímiles.
 */
import fs from "node:fs";
import path from "node:path";

export const CATEGORIAS = ["Planchas", "Materiales", "Accesorios", "Servicios"];

const MIGRACION = "supabase/migrations/20261110000100_cortes_catalogo.sql";

/** Las filas del `values` de la migración: (material, variante, detalle, espesor, ancho, largo, código, …). */
export function planchasDeLaMigracion(raiz) {
  const sql = fs.readFileSync(path.join(raiz, MIGRACION), "utf8");
  const fila = /^\s*\('((?:[^']|'')*)', '((?:[^']|'')*)', '((?:[^']|'')*)', ([\d.]+), ([\d.]+), ([\d.]+), '((?:[^']|'')*)'/gm;
  const vistos = new Map();
  for (const m of sql.matchAll(fila)) {
    const [, material, variante, detalle, esp, ancho, largo, codigo] = m.map((s) => s?.replace(/''/g, "'"));
    if (vistos.has(codigo)) continue; // sku compartido: un producto, varias filas
    const e = Number(esp);
    const a = Number(ancho) / 100;
    const l = Number(largo) / 100;
    const nombre = [material, variante, detalle, `${e}MM`, `${a.toFixed(2)}X${l.toFixed(2)}`]
      .filter(Boolean)
      .join(" ")
      .toUpperCase()
      .normalize("NFD").replace(/\u0301/g, "").normalize("NFC"); // ACRILICO, como en Odoo
    // ~S/ 22 por m² y mm de espesor: solo para que haya precios con sentido.
    const precio = Math.round(a * l * e * 22);
    vistos.set(codigo, { codigo, nombre, precio, categoria: "Planchas", unidad: "Unidades", servicio: false });
  }
  return [...vistos.values()];
}

const p = (codigo, nombre, precio, categoria, unidad = "Unidades") => ({
  codigo, nombre, precio, categoria, unidad, servicio: categoria === "Servicios",
});

export const EXTRAS = [
  // Materiales sueltos (mismos códigos que el Odoo falso de las pruebas)
  p("AC-002", "ACRILICO F8 CRISTAL 2MM", 85, "Materiales"),
  p("AC-003", "ACRILICO F8 CRISTAL 3MM", 120, "Materiales"),
  p("AC-005", "ACRILICO F8 CRISTAL 5MM", 190, "Materiales"),
  p("AC-008", "ACRILICO F8 CRISTAL 8MM", 300, "Materiales"),
  p("AC-010", "ACRILICO F8 CRISTAL 10MM", 375, "Materiales"),
  p("AC-103", "ACRILICO BRONCE 3MM", 135, "Materiales"),
  p("AC-203", "ACRILICO HUMO 3MM", 135, "Materiales"),
  p("AC-303", "ACRILICO ESPEJO PLATA 3MM", 210, "Materiales"),
  p("PVC-003", "PVC ESPUMADO BLANCO 3MM", 45, "Materiales"),
  p("PVC-005", "PVC ESPUMADO BLANCO 5MM", 65, "Materiales"),
  p("PVC-010", "PVC ESPUMADO BLANCO 10MM", 95, "Materiales"),
  p("MDF-003", "MDF CRUDO 3MM 1.22X2.44", 38, "Materiales"),
  p("MDF-005", "MDF CRUDO 5.5MM 1.22X2.44", 55, "Materiales"),
  p("PC-006", "POLICARBONATO ALVEOLAR CRISTAL 6MM", 160, "Materiales"),
  p("PC-004", "POLICARBONATO COMPACTO CRISTAL 4MM", 420, "Materiales"),
  // Accesorios
  p("ACC-SEP-19", "SEPARADOR DE ACERO 19X19MM", 4.5, "Accesorios"),
  p("ACC-SEP-25", "SEPARADOR DE ACERO 25X25MM", 6, "Accesorios"),
  p("ACC-SEP-50", "SEPARADOR DE ACERO 19X50MM", 8, "Accesorios"),
  p("ACC-TOR-08", "TORNILLO AUTORROSCANTE 8X1\" (CIENTO)", 12, "Accesorios"),
  p("ACC-TAR-06", "TARUGO 6MM (CIENTO)", 6, "Accesorios"),
  p("ACC-BIS-01", "BISAGRA PARA ACRILICO CROMADA", 9.5, "Accesorios"),
  p("ACC-JAL-01", "JALADOR ACRILICO CRISTAL 10CM", 7, "Accesorios"),
  p("ACC-PEG-01", "PEGAMENTO PARA ACRILICO 1/4 GL", 38, "Accesorios"),
  p("ACC-PEG-02", "PEGAMENTO PARA ACRILICO JERINGA 30ML", 12, "Accesorios"),
  p("ACC-CIN-01", "CINTA DOBLE CONTACTO VHB 19MM X 33M", 55, "Accesorios"),
  p("ACC-LED-01", "CINTA LED 12V BLANCO FRIO (METRO)", 8, "Accesorios", "m"),
  p("ACC-LED-02", "FUENTE 12V 5A", 35, "Accesorios"),
  p("ACC-SOP-01", "SOPORTE PORTA AFICHE ALUMINIO", 18, "Accesorios"),
  p("ACC-CAB-01", "KIT CABLE ACERO COLGANTE 1.5M", 22, "Accesorios"),
  // Servicios
  p("SRV001", "SERVICIO DE CORTE MANUAL", 1, "Servicios"),
  p("SRV002", "SERVICIO DE CORTE LASER", 1, "Servicios"),
  p("SRV003", "SERVICIO DE GRABADO LASER", 1, "Servicios"),
  p("SRV004", "SERVICIO DE DOBLADO TERMICO", 5, "Servicios"),
  p("SRV005", "SERVICIO DE PULIDO DE CANTOS (METRO)", 6, "Servicios"),
  p("SRV006", "SERVICIO DE INSTALACION", 80, "Servicios"),
];

/** Clientes de prueba: las cotizaciones de ejemplo necesitan un `res.partner`. */
export const CLIENTES = [
  { ref: "SEED-CLI-1", name: "SEED Publicidad Lima SAC", vat: "20512345671", phone: "01 444 5566", is_company: true },
  { ref: "SEED-CLI-2", name: "SEED María Torres Huamán", vat: "41234567", phone: "988 112 233", is_company: false },
  { ref: "SEED-CLI-3", name: "SEED Constructora Sur EIRL", vat: "20456789013", phone: "054 22 3344", is_company: true },
];

/**
 * Cotizaciones de ejemplo para Supabase. Las líneas citan productos por código;
 * si un código no está en Odoo, la línea se salta con un aviso.
 * `estado`: `sincronizada` (con sale.order en Odoo), `confirmada` (además
 * confirmada), `pendiente` o `error` (solo en Supabase).
 */
export const COTIZACIONES = [
  { ref: "SEED-COT-1", cliente: "SEED-CLI-1", estado: "sincronizada", dias: 6, notas: "Letrero recepción",
    lineas: [["F7E024", 2, "Corte a 60x40 cm"], ["ACC032", 8], ["SRV002", 45]] },
  { ref: "SEED-COT-2", cliente: "SEED-CLI-2", estado: "confirmada", dias: 5, notas: "Repisa de superficie sólida",
    lineas: [["SS001", 1, "Repisa 80x25 cm"], ["PEG003", 1], ["SRV001", 4]] },
  { ref: "SEED-COT-3", cliente: "SEED-CLI-3", estado: "sincronizada", dias: 4, notas: "Vitrinas",
    lineas: [["F7E029", 3], ["ACC003", 6], ["ACC038", 3], ["SRV004", 1]] },
  { ref: "SEED-COT-4", cliente: "SEED-CLI-1", estado: "pendiente", dias: 2, notas: "Exhibidor giratorio",
    lineas: [["F7E024", 1], ["ACC035", 1], ["ACC001|TORNILLOS 6MM CRISTAL", 12], ["SRV002", 30]] },
  { ref: "SEED-COT-5", cliente: "SEED-CLI-2", estado: "error", dias: 1, notas: null,
    error: "Odoo no respondió (dato de prueba).",
    lineas: [["SS002", 1, "Mesa 120x60"], ["PEG002", 1]] },
  { ref: "SEED-COT-6", cliente: "SEED-CLI-3", estado: "confirmada", dias: 0, notas: "Señalética",
    lineas: [["F7E024", 2], ["ACC033", 4], ["ACC017", 2], ["SRV002", 60]] },
];

/** Precio de prueba por material de accesorio (el Excel no trae precios). */
export const PRECIOS_ACCESORIOS = {
  "bisagras con tornillos": 12,
  "bisagras": 8,
  "tornillos mariposa": 4,
  "tornillos": 3,
  "barras": 25,
  "tubos": 45,
  "perfil": 18,
  "triangulo": 15,
  "soportes": 6,
  "clavos": 5,
  "sistema giratorio": 35,
  "sujetadores": 20,
  "chapas": 15,
  "manijas": 7,
  "cerrojos": 9,
  "dobladoras": 120,
  "dispensador": 60,
  "mixer": 2,
  "adhesivo": 45,
};
